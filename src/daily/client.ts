import { z } from 'zod';
import { call, countrySchema, post, type Result, type SavedRound } from '../account/client.ts';
import type { Challenge } from '../game/settings.ts';

const DAILY = '/api/daily';

/** The daily is three rounds of at most 5000 points. */
export const DAILY_MAX_SCORE = 15_000;
/** Rows on one page of the day's leaderboard, which holds the top hundred. */
export const DAILY_PER_PAGE = 20;
/** The most stored results a new account can claim at once, and the days they may go back. */
export const MAX_CLAIMED_RESULTS = 14;

const dailySchema = z.object({
  /** UTC, YYYY-MM-DD */
  date: z.string(),
  /** derived from the date, so everyone gets the same places */
  seed: z.string(),
  settings: z.object({ map: z.literal('world'), mode: z.literal('move'), timeLimit: z.literal(180), rounds: z.literal(3) }),
  /** ISO 8601; what `nextAt` is counted down against */
  serverNow: z.string(),
  /** the next UTC midnight, when the next daily opens */
  nextAt: z.string(),
  /** `open` for a visitor and until the one attempt is begun; `started` until its result is saved; then `done` */
  state: z.enum(['open', 'started', 'done']),
  /** null for a visitor, or a player who has not finished today's */
  yours: z
    .object({
      score: z.number(),
      /** as stored with the result */
      maxScore: z.number(),
      /** the score of each round */
      rounds: z.array(z.number()),
      rank: z.number(),
      /** whole percent of today's other players who scored lower; 0 while nobody else has played */
      beat: z.number(),
      /** the day's mean score for each round, rounded, the player's own result included; null until five players have finished */
      averages: z.array(z.number()).nullable(),
      /** true when this total is higher than every earlier daily of the account; false for its first */
      personalBest: z.boolean(),
    })
    .nullable(),
  /** days in a row with a result; `atRisk` when today is not played yet. Zeros and false for a visitor */
  streak: z.object({ current: z.number(), best: z.number(), atRisk: z.boolean() }),
  /** over every daily of three rounds the account has played; null for a visitor or a guest */
  records: z.object({ played: z.number(), best: z.number(), average: z.number() }).nullable(),
  /** the last 14 days, oldest first, today last; a null score is a day not played. Empty for a visitor */
  history: z.array(z.object({ date: z.string(), score: z.number().nullable() })),
  /** today's top hundred, 20 to a page */
  leaderboard: z.object({
    entries: z.array(z.object({ rank: z.number(), username: z.string(), country: countrySchema, score: z.number() })),
    page: z.number(),
    more: z.boolean(),
  }),
  /** how many of today's results fall in each tenth of the maximum: 0 to 1499, 1500 to 2999, and so on */
  distribution: z.array(z.number()).length(10),
});

const startedSchema = z.object({
  state: z.enum(['started', 'done']),
  /** null for an account, whose attempt the server marks; for anyone else a note of when the start was, to keep with the result */
  token: z.string().nullable(),
});
const claimedSchema = z.object({ claimed: z.array(z.string()) });

export type DailyState = z.infer<typeof dailySchema>;
export type DailyResult = NonNullable<DailyState['yours']>;
export type DailyEntry = DailyState['leaderboard']['entries'][number];

export type DailyStart = z.infer<typeof startedSchema>;

/**
 * One daily a visitor played and kept in the browser, as a new account claims it: its day, the
 * token the visitor's `start` of that day was answered with, and its rounds as a saved game holds
 * them. The server takes a result only when the token was made on that same UTC day and the three
 * places are that day's.
 */
export interface StoredDaily {
  /** UTC day, YYYY-MM-DD */
  daily: string;
  token: string;
  rounds: SavedRound[];
}

type Reply<T> = Promise<Result<T>>;

/**
 * Today's challenge with a page of its leaderboard (pages count from 1; five at most). Works without
 * a session; every part that is about the asker is empty for a visitor.
 */
export function getDaily(page = 1, fetchFn: typeof fetch = fetch): Reply<DailyState> {
  return call(fetchFn, page === 1 ? DAILY : `${DAILY}?page=${encodeURIComponent(String(page))}`, dailySchema);
}

/** The daily as a game to play: a normal local game with the day's seed and settings. */
export function dailyChallenge(daily: DailyState): Challenge {
  return { ...daily.settings, seed: daily.seed };
}

/**
 * Begins today's one attempt, which has to be sent before the daily is played. For an account the
 * server marks the attempt: the answer is `started`, or `done` when a result is already in, with no
 * token, and the daily must not be started afresh from then on, even from a new page. An account's
 * result is refused unless this was sent today (`REFUSALS.dailyUnstarted`) and at least six seconds
 * before (`REFUSALS.dailyTooSoon`). A visitor or a guest is answered `started` with a token to
 * keep with the result, which a new account's claim has to carry.
 */
export function startDaily(fetchFn: typeof fetch = fetch): Reply<DailyStart> {
  return call(fetchFn, DAILY, startedSchema, post({ action: 'start' }));
}

/**
 * Hands a new account the dailies its player finished as a visitor (1 to 14 of them), each with
 * the token of its start. Only on the day the account is made. The answer lists the days that were
 * taken; a result that cannot be taken is skipped, not refused.
 */
export function claimDaily(results: readonly StoredDaily[], fetchFn: typeof fetch = fetch): Reply<{ claimed: string[] }> {
  return call(fetchFn, DAILY, claimedSchema, post({ action: 'claim', results }));
}

const viewerSchema = z.object({ google: z.boolean(), usedToday: z.number(), limit: z.number() });

/**
 * Asks whether a Google Street View viewer may be made. The server counts them per day and says no
 * once the day's free allowance is used, so the site never runs up a bill; also to an address that
 * has had its forty of the day, and to a visitor or a guest once two thirds of the day's are used. Whatever the
 * reason, `google: false` means the same thing: this game is played on open imagery. Asked once per game.
 */
export function askViewer(fetchFn: typeof fetch = fetch): Reply<z.infer<typeof viewerSchema>> {
  return call(fetchFn, DAILY, viewerSchema, post({ action: 'viewer' }));
}
