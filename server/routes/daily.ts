import { z } from 'zod';
import { SIGN_IN_FIRST, noAccount, playerIn } from '../account/identity.js';
import { CLAIM_DAYS, claimDailies } from '../daily/claim.js';
import { DAILY_SETTINGS, dailyDate, dailySeed, nextDailyAt } from '../daily/daily.js';
import { DISTRIBUTION_BANDS, DISTRIBUTION_BAND_WIDTH, VISITOR, ownDaily, type OwnDaily } from '../daily/view.js';
import { beginDaily, dailiesOf, dailyDistribution, dailyLeaderboard, dailyStanding } from '../db/daily.js';
import { utcDay } from '../db/progress.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { countViewer, viewersUsed } from '../db/viewers.js';
import { DEFAULT_GOOGLE_VIEWERS_PER_DAY } from '../env.js';
import { clientIp, fail, hashIp, ok, readBody, sameOrigin } from '../http.js';
import type { Context } from '../serve.js';

export const LEADERBOARD_PER_PAGE = 20;
/** The board stops here, however many played. */
export const LEADERBOARD_SIZE = 100;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

// One browser asks once a game, and a class of forty behind a school's one address asks forty times a game.
// This is that class playing six games in the hour: it stops a flood, and nobody playing.
const VIEWERS_PER_ADDRESS = 240;
// How many of a day's Google viewers one address can have: a class of forty, each with one.
const VIEWERS_PER_ADDRESS_PER_DAY = 40;
// A page asks once when the daily begins. This leaves room for reloads and no more.
const STARTS_PER_ACCOUNT = 30;
const TOO_MANY_STARTS = 'Too many dailies started in the last hour. Try again later.';
// A browser claims once, right after its account is made.
const CLAIMS_PER_ACCOUNT = 10;

const NOT_AN_ACTION = 'That is not something that can be asked here.';

const DAILY_ACTIONS = ['viewer', 'start', 'claim'] as const;
/** Enough of a body to tell which action was meant. */
const actionSchema = z.looseObject({ action: z.enum(DAILY_ACTIONS) });
/** What is in each result is looked at one by one: a result that cannot be taken is skipped, not refused. */
const claimSchema = z.object({ results: z.array(z.unknown()).min(1).max(CLAIM_DAYS) });

/** The first page is 1, and so is a page that is missing or is not one. */
const pageSchema = z.coerce.number().int().min(1);

/** One page of the day's board, its rows numbered by their place on the whole board. */
async function boardPage({ db }: Context, date: string, page: number) {
  const offset = (page - 1) * LEADERBOARD_PER_PAGE;
  // One more than the page holds says whether another follows, but never past the end of the board.
  const wanted = Math.min(LEADERBOARD_PER_PAGE + 1, LEADERBOARD_SIZE - offset);
  const rows = wanted > 0 ? await dailyLeaderboard(db, date, wanted, offset) : [];
  const entries = rows.slice(0, LEADERBOARD_PER_PAGE).map((row, index) => ({ rank: offset + index + 1, ...row }));
  return { entries, page, more: rows.length > LEADERBOARD_PER_PAGE };
}

/** What the asker is told about their own dailies. A guest has none, like a visitor. */
async function own(request: Request, context: Context, date: string): Promise<OwnDaily> {
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return VISITOR;
  }
  const { userId } = player;
  const [mine, standing] = await Promise.all([dailiesOf(context.db, userId, date), dailyStanding(context.db, userId, date)]);
  return ownDaily({ ...mine, standing }, date, context.now);
}

/**
 * Today's daily challenge: its seed and settings, a page of its leaderboard
 * and how its scores are spread. Open to visitors; a signed-in player also
 * gets their own result, streak, records and last two weeks.
 */
export async function daily(request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const date = dailyDate(now);
  const asked = pageSchema.safeParse(new URL(request.url).searchParams.get('page') ?? '1');
  const [leaderboard, distribution] = await Promise.all([
    boardPage(context, date, asked.success ? asked.data : 1),
    dailyDistribution(db, date, DISTRIBUTION_BAND_WIDTH, DISTRIBUTION_BANDS),
  ]);
  return ok({
    date,
    seed: dailySeed(date),
    settings: DAILY_SETTINGS,
    serverNow: new Date(now).toISOString(),
    nextAt: new Date(nextDailyAt(now)).toISOString(),
    ...(await own(request, context, date)),
    leaderboard,
    distribution,
  });
}

/** The share of a day's viewers that anyone may have. The rest is kept for signed-in accounts. */
const openViewers = (limit: number): number => Math.floor((limit * 2) / 3);

/**
 * Asked by a browser before it makes a Google Street View viewer, which is
 * what Google charges for. Says whether the day has one for it, and counts
 * it when it has: `google` is false once the address has had its forty of the
 * day, once the day's allowance is gone, and for a visitor or a guest once
 * two thirds of it are. The browser then uses open imagery for that game.
 * Open to visitors.
 */
async function viewer(request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const address = hashIp(clientIp(request), context.secret);
  if (!(await hitRateLimit(db, `viewer:${address}`, VIEWERS_PER_ADDRESS, HOUR_MS, now))) {
    return fail('Too many games started from this network in the last hour. Try again later.', 429);
  }
  const limit = context.viewersPerDay ?? DEFAULT_GOOGLE_VIEWERS_PER_DAY;
  const day = utcDay(now);
  // The day is in the key, so the count starts again at midnight UTC and not a day after the address first asked.
  const withinAddress = await hitRateLimit(db, `viewer-day:${day}:${address}`, VIEWERS_PER_ADDRESS_PER_DAY, DAY_MS, now);
  const player = withinAddress ? await playerIn(request, context) : null;
  const ceiling = player && !player.guest ? limit : openViewers(limit);
  const given = withinAddress ? await countViewer(db, day, ceiling) : null;
  return ok({ google: given !== null, usedToday: Math.min(given ?? (await viewersUsed(db, day)), limit), limit });
}

/**
 * Marks today's one attempt as begun, so that a fresh page knows not to
 * start the daily again, and so that its result can be told from one that
 * was never played. Says `done` instead when today already has a result.
 */
async function start(userId: string, { db, now }: Context): Promise<Response> {
  if (!(await hitRateLimit(db, `daily-start:${userId}`, STARTS_PER_ACCOUNT, HOUR_MS, now))) {
    return fail(TOO_MANY_STARTS, 429);
  }
  const begun = await beginDaily(db, userId, dailyDate(now), now);
  // A session can outlive its account.
  return begun ? ok({ state: begun.done ? 'done' : 'started', token: null }) : fail(SIGN_IN_FIRST, 401);
}

/** Saves the daily results a new account's player made before they had it. */
async function claim(body: unknown, userId: string, { db, now, secret }: Context): Promise<Response> {
  if (!(await hitRateLimit(db, `daily-claim:${userId}`, CLAIMS_PER_ACCOUNT, HOUR_MS, now))) {
    return fail('Too many claims in the last hour. Try again later.', 429);
  }
  const input = claimSchema.safeParse(body);
  if (!input.success) {
    return fail(`A claim holds 1 to ${CLAIM_DAYS} results.`, 400);
  }
  const claimed = await claimDailies(db, userId, input.data.results, now, secret);
  return claimed.ok ? ok(claimed.data) : fail(claimed.error, claimed.status);
}

/** Asking for a Google viewer, which anyone may; and beginning the daily or claiming a visitor's results, which need an account: `{ action, ... }`. */
export async function dailyPost(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const body = await readBody(request, actionSchema);
  if (!body) {
    return fail(NOT_AN_ACTION, 400);
  }
  if (body.action === 'viewer') {
    return viewer(request, context);
  }
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  return body.action === 'start' ? start(player.userId, context) : claim(body, player.userId, context);
}
