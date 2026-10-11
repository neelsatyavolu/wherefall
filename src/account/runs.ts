import { z } from 'zod';
import type { GuesserKind } from '../game/guesser.ts';
import { REFUSALS, call, getAccount, post, type AccountState, type Result } from './client.ts';

/**
 * Runs of the country streak, Country Guesser and Continent Guesser. A run is begun on the server
 * before it is played and finished with what was played: the place of each round and what the
 * player chose. The server counts it; a count sent by the browser is no longer taken.
 */

const GAMES = '/api/games';

export const RUN_KINDS = ['streak', 'country', 'continent'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** A finish is refused (`REFUSALS.runTooSoon`) when it arrives sooner than this after its start for each round it sends. */
export const RUN_ROUND_MS = 2000;
/** The most rounds a finish may send: a streak ends at 500 right answers or on the round after; a guesser run is ten. */
export const RUN_LIMITS = { streak: 501, guesser: 10 } as const;

/** One round of a run: the place shown, by its id in either place list, and what the player chose. */
export interface RunRound {
  id: string;
  /** a two-letter country code for the streak and Country Guesser, a continent for Continent Guesser; null for no answer */
  answer: string | null;
}

const startedSchema = z.object({ run: z.string().min(1) });
const streakSchema = z.object({
  /** the account's best streak after this run */
  bestStreak: z.number(),
  /** this run as the server counted it: the rounds from the first up to the first wrong one */
  streak: z.number(),
  xpEarned: z.number(),
  /** true when the day's 20,000 XP from playing alone was reached: `xpEarned` is what was left */
  xpCapped: z.boolean(),
});
const guesserSchema = z.object({
  /** the account's best score of this kind after this run: right answers × 1000 */
  best: z.number(),
  /** how many of this run's answers the server counted right */
  correct: z.number(),
  xpEarned: z.number(),
  xpCapped: z.boolean(),
});

export type StreakResult = z.infer<typeof streakSchema>;
export type GuesserResult = z.infer<typeof guesserSchema>;

type Reply<T> = Promise<Result<T>>;

/**
 * Begins a run for the signed-in player. The answer is an opaque token to finish the run with.
 * 120 an hour, then 429 "Too many runs started in the last hour. Try again later.".
 */
export function startRun(kind: RunKind, fetchFn: typeof fetch = fetch): Reply<{ run: string }> {
  return call(fetchFn, GAMES, startedSchema, post({ action: 'start', kind }));
}

/**
 * Finishes a country streak with every round played, the losing one last (1 to 501 rounds).
 * `inPlay` marks the streak counted behind ordinary world games: it sets the best streak and pays
 * no XP. Finishing the same run again answers with the first result and no XP.
 */
export function finishStreak(run: string, rounds: readonly RunRound[], inPlay = false, fetchFn: typeof fetch = fetch): Reply<StreakResult> {
  return call(fetchFn, GAMES, streakSchema, post({ kind: 'streak', run, rounds, ...(inPlay ? { inPlay: true } : {}) }));
}

/** Finishes a Country Guesser or Continent Guesser run with its rounds (1 to 10). */
export function finishGuesserRun(kind: GuesserKind, run: string, rounds: readonly RunRound[], fetchFn: typeof fetch = fetch): Reply<GuesserResult> {
  return call(fetchFn, GAMES, guesserSchema, post({ kind, run, rounds }));
}

/** A run begun on the server as its game began: what the game keeps, to finish the run with. */
export interface BegunRun<K extends RunKind = RunKind> {
  readonly kind: K;
  /**
   * The run's token and when this browser had it. A refusal when there is no run to finish:
   * `REFUSALS.signIn` for a visitor and `REFUSALS.guests` for a guest (neither is asked for one),
   * else whatever stopped the start.
   */
  readonly started: Reply<{ run: string; at: number }>;
}

export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const REAL_CLOCK: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

interface BeginDeps extends Clock {
  account: () => Reply<AccountState>;
  start: (kind: RunKind) => Reply<{ run: string }>;
}

/**
 * Begins a run as its game begins, so the server knows how long it took. Only an account has runs:
 * a visitor and a guest play without one, and are not asked.
 */
export function beginRun<K extends RunKind>(kind: K, deps: Partial<BeginDeps> = {}): BegunRun<K> {
  const { account, start, now }: BeginDeps = { ...REAL_CLOCK, account: () => getAccount(), start: (which) => startRun(which), ...deps };
  const begin = async (): Reply<{ run: string; at: number }> => {
    const who = await account();
    if (!who.ok) {
      return who;
    }
    if (!who.data.account) {
      return { ok: false, error: who.data.guest === null ? REFUSALS.signIn : REFUSALS.guests };
    }
    const started = await start(kind);
    return started.ok ? { ok: true, data: { run: started.data.run, at: now() } } : started;
  };
  return { kind, started: begin() };
}

/** What is added to the wait before a refused finish is sent again, so the second is not a hair early too. */
const RETRY_MARGIN_MS = 500;

/**
 * Sends the finish of a begun run. A player quicker than two seconds a round is refused by the
 * server as "sooner than it could have been played": that finish is sent once more when the time
 * the server asks for has passed, so a quick player waits a few seconds and is not turned away.
 * Nothing is sent when the run was never begun: the answer is why.
 */
async function finishBegun<T>(begun: BegunRun, rounds: number, { now, sleep }: Clock, finish: (run: string) => Reply<T>): Reply<T> {
  const started = await begun.started;
  if (!started.ok) {
    return started;
  }
  const { run, at } = started.data;
  const first = await finish(run);
  if (first.ok || first.error !== REFUSALS.runTooSoon) {
    return first;
  }
  await sleep(Math.max(0, at + rounds * RUN_ROUND_MS - now()) + RETRY_MARGIN_MS);
  return finish(run);
}

/** Finishes a streak begun with `beginRun('streak')`. */
export function finishBegunStreak(
  begun: BegunRun<'streak'>,
  rounds: readonly RunRound[],
  inPlay = false,
  clock: Clock = REAL_CLOCK,
  fetchFn: typeof fetch = fetch,
): Reply<StreakResult> {
  return finishBegun(begun, rounds.length, clock, (run) => finishStreak(run, rounds, inPlay, fetchFn));
}

/** Finishes a guesser run begun with `beginRun(kind)`. */
export function finishBegunGuesser(begun: BegunRun<GuesserKind>, rounds: readonly RunRound[], clock: Clock = REAL_CLOCK, fetchFn: typeof fetch = fetch): Reply<GuesserResult> {
  return finishBegun(begun, rounds.length, clock, (run) => finishGuesserRun(begun.kind, run, rounds, fetchFn));
}
