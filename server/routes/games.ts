import { z } from 'zod';
import { SIGN_IN_FIRST, noAccount, playerIn } from '../account/identity.js';
import { communitySlugOf, runFinishSchema, runStartSchema, savedGameSchema, type RunFinish, type RunStart, type SavedGame } from '../account/input.js';
import { isTodaysDaily } from '../daily/daily.js';
import { checkedGame } from '../games/check.js';
import { RUN_ROUND_MS, countRun, runToken, startedRun } from '../games/runs.js';
import { gameFor, gameHistoryFor, saveRun, saveGame as storeGame, type DailyRefusal } from '../db/games.js';
import { locationsOf } from '../db/maps.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { fail, ok, readBody, sameOrigin } from '../http.js';
import { isDailyDraw } from '../places/daily.js';
import type { Context } from '../serve.js';

const INVALID_GAME = 'That game could not be saved: its details are not valid.';
const NOT_ON_MAP = 'That game could not be saved: its places are not on its map.';
const NOT_TODAYS = "That game could not be saved as a daily challenge: it is not today's.";
const NOT_TODAYS_PLACES = "Those are not today's places.";
const DAILY_REFUSALS: Record<DailyRefusal, string> = {
  unstarted: 'Start the daily before you finish it.',
  'too-soon': 'That daily finished sooner than it could have been played.',
};
const RUN_NOT_STARTED_HERE = 'That run was not started here.';
const RUN_PLACES_UNKNOWN = 'That run could not be saved: its places are not known.';
const RUN_TOO_SOON = 'That run finished sooner than it could have been played.';
// One answer for a game that does not exist and for someone else's.
const NO_SUCH_GAME = 'That game does not exist, or it is not yours.';

const HOUR_MS = 60 * 60_000;
// Far more than anyone plays, and enough to stop one account filling the database.
const SAVES_PER_ACCOUNT = 60;
// A run is begun for every streak and every guesser game, and for the streak counted behind ordinary games.
const RUN_STARTS_PER_ACCOUNT = 120;

export const GAMES_PER_PAGE = 20;
const MAX_PAGE = 10_000;

const bodySchema = z.union([runStartSchema, runFinishSchema, savedGameSchema]);

/** The first page is 1. A page of 0 is the first too. */
const pageSchema = z.coerce.number().int().min(0).max(MAX_PAGE);

/** Begins a run, and answers with the token it is to be finished with. */
async function beginRun(body: RunStart, userId: string, { db, now, secret }: Context): Promise<Response> {
  if (!(await hitRateLimit(db, `runs-start:${userId}`, RUN_STARTS_PER_ACCOUNT, HOUR_MS, now))) {
    return fail('Too many runs started in the last hour. Try again later.', 429);
  }
  return ok({ run: runToken(userId, body.kind, now, secret) }, 201);
}

/**
 * Records a finished run, counted by the server from its rounds, and answers
 * with what it came to and the account's best of its kind: a streak's as
 * `bestStreak`, in countries; a guesser's as `best`, in points.
 */
async function finishRun(body: RunFinish, userId: string, { db, now, secret }: Context): Promise<Response> {
  const started = startedRun(body.run, secret);
  if (!started || started.userId !== userId || started.kind !== body.kind) {
    return fail(RUN_NOT_STARTED_HERE, 400);
  }
  const count = countRun(body);
  if (count === null) {
    return fail(RUN_PLACES_UNKNOWN, 400);
  }
  if (now - started.startedAt < body.rounds.length * RUN_ROUND_MS) {
    return fail(RUN_TOO_SOON, 409);
  }
  // The streak counted behind ordinary games earns nothing of its own: those games paid their XP.
  const paid = !(body.kind === 'streak' && body.inPlay === true);
  const saved = await saveRun(db, userId, { kind: body.kind, id: started.id, count, paid }, now);
  if (!saved) {
    return fail(SIGN_IN_FIRST, 401);
  }
  const { best, xpEarned, xpCapped } = saved;
  return ok(body.kind === 'streak' ? { bestStreak: best, streak: saved.count, xpEarned, xpCapped } : { best, correct: saved.count, xpEarned, xpCapped });
}

/**
 * Stores a finished game as the server reckons it, not as the browser
 * reports it: on places the server knows to be on the game's map, scored by
 * the server. A daily challenge has also to be today's, on the day's own
 * places, and begun long enough ago to have been played.
 */
async function storePlayed(body: SavedGame, userId: string, { db, now }: Context): Promise<Response> {
  const isDaily = body.daily !== undefined;
  if (isDaily && !isTodaysDaily(body, now)) {
    return fail(NOT_TODAYS, 400);
  }
  const slug = communitySlugOf(body.map);
  const played = checkedGame(body, slug === null ? null : await locationsOf(db, slug));
  // A daily's places have one thing to be, the day's own, and places the server does not know are not that either.
  if (isDaily && !(played && played.list !== null && isDailyDraw(played.places, played.list, body.seed))) {
    return fail(NOT_TODAYS_PLACES, 400);
  }
  if (!played) {
    return fail(NOT_ON_MAP, 400);
  }
  const saved = await storeGame(db, userId, played.game, now);
  if (saved === null) {
    return fail(SIGN_IN_FIRST, 401);
  }
  if (typeof saved === 'string') {
    return fail(DAILY_REFUSALS[saved], 409);
  }
  return ok({ ...saved.game, xpEarned: saved.xpEarned, xpCapped: saved.xpCapped }, saved.created ? 201 : 200);
}

/**
 * For the signed-in player: saves one finished game, begins a run of the
 * country streak, Country Guesser or Continent Guesser (`{ action: 'start',
 * kind }`), or records a finished one. 201 for a new game or a run begun,
 * 200 for a finished run, and for a repeat of a game just saved or of a
 * daily challenge already played that day.
 */
export async function saveGame(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  const { userId } = player;
  const { db, now } = context;
  const body = await readBody(request, bodySchema);
  // Beginning a run saves nothing, and has a limit of its own.
  if (body && 'action' in body) {
    return beginRun(body, userId, context);
  }
  if (!(await hitRateLimit(db, `games-save:${userId}`, SAVES_PER_ACCOUNT, HOUR_MS, now))) {
    return fail('Too many games saved in the last hour. Try again later.', 429);
  }
  if (!body) {
    return fail(INVALID_GAME, 400);
  }
  return 'kind' in body ? finishRun(body, userId, context) : storePlayed(body, userId, context);
}

/** One of the signed-in player's own games, played alone or online, with its rounds, for the history view. */
export async function game(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  const { userId } = player;
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get('id'));
  const found = id.success ? await gameFor(context.db, userId, id.data) : null;
  return found ? ok(found) : fail(NO_SUCH_GAME, 404);
}

/** A page of everything the signed-in player has played, in every mode, newest first. */
export async function gameHistory(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  const { userId } = player;
  const asked = pageSchema.safeParse(new URL(request.url).searchParams.get('page'));
  if (!asked.success) {
    return fail('Ask for your games by page.', 400);
  }
  const page = Math.max(1, asked.data);
  const found = await gameHistoryFor(context.db, userId, GAMES_PER_PAGE, (page - 1) * GAMES_PER_PAGE);
  return ok({ games: found.slice(0, GAMES_PER_PAGE), page, more: found.length > GAMES_PER_PAGE });
}

/** `?id=` is one game with its rounds; `?page=` is a page of the history list. */
export async function gamesGet(request: Request, context: Context): Promise<Response> {
  const params = new URL(request.url).searchParams;
  return params.has('page') && !params.has('id') ? gameHistory(request, context) : game(request, context);
}
