import { z } from 'zod';
import type { SavedRound } from '../account/client.ts';
import { MAX_CLAIMED_RESULTS, type StoredDaily } from './client.ts';

/**
 * A visitor's dailies, kept in this browser: for someone with no account the one attempt a day is
 * counted here, and so are their results, each with the token the server answered its start with,
 * so that the account they make can take them over (`claimDaily`).
 */

/** How many days of results are kept, today included: as far back as an account can claim, and as the history strip shows. */
export const KEPT_DAYS = 14;

const DAY_MS = 86_400_000;

const roundSchema = z.object({
  /** the place's id. A result kept before places were sent by id has none: it is still shown, and cannot be claimed */
  id: z.string().optional(),
  country: z.string(),
  distanceKm: z.number().nullable(),
  score: z.number(),
  lng: z.number().optional(),
  lat: z.number().optional(),
  guessLng: z.number().nullable().optional(),
  guessLat: z.number().nullable().optional(),
  hinted: z.boolean().optional(),
});

const keptSchema = z.object({
  /** the UTC day an attempt was begun; the attempt is spent from then, finished or not */
  started: z.string().nullable(),
  /** what the server answered that start with; null when it could not be asked, and in what a browser kept before starts had tokens */
  token: z.string().nullable().default(null),
  /** one result a day, oldest first, each with the token of its start */
  results: z.array(z.object({ daily: z.string(), token: z.string().nullable().default(null), rounds: z.array(roundSchema) })),
  /** the account these results were last offered to and what it answered; it is not asked twice. `failed` until the player has been told */
  claim: z.object({ by: z.string(), final: z.boolean(), failed: z.boolean() }).nullable(),
});

export type KeptDailies = z.infer<typeof keptSchema>;
/** One day's result as this browser keeps it. */
export type KeptDaily = KeptDailies['results'][number];
export type Attempt = 'open' | 'started' | 'done';

export const EMPTY: KeptDailies = { started: null, token: null, results: [], claim: null };

/** The UTC day `days` before `day` (YYYY-MM-DD). */
export const dayBefore = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/** The first of the `KEPT_DAYS` days that end on `today`. */
const oldestKept = (today: string) => dayBefore(today, KEPT_DAYS - 1);

export const scoreOf = (result: { rounds: ReadonlyArray<{ score: number }> }): number => result.rounds.reduce((total, round) => total + round.score, 0);

export const resultOn = (kept: KeptDailies, day: string): KeptDaily | null => kept.results.find((result) => result.daily === day) ?? null;

/** Where the visitor's one attempt at a day's daily stands. */
export function attemptOn(kept: KeptDailies, day: string): Attempt {
  if (resultOn(kept, day)) {
    return 'done';
  }
  return kept.started === day ? 'started' : 'open';
}

/** The day's one attempt is begun. `token` is what the server answered the start with: without one the result can be played and kept, and never claimed. */
export const begun = (kept: KeptDailies, day: string, token: string | null = null): KeptDailies => ({ ...kept, started: day, token });

/**
 * A finished daily is kept, with the token of the start it was begun with: the first result of a
 * day stays, and only the last `KEPT_DAYS` days are held. Something new to offer, so an account
 * that was asked before may be asked again.
 */
export function withResult(kept: KeptDailies, result: { daily: string; rounds: SavedRound[] }): KeptDailies {
  if (resultOn(kept, result.daily)) {
    return kept;
  }
  const token = kept.started === result.daily ? kept.token : null;
  const results = [...kept.results, { ...result, token }].sort((a, b) => a.daily.localeCompare(b.daily));
  const newest = results[results.length - 1]!.daily;
  return { ...kept, results: results.filter((each) => each.daily >= oldestKept(newest)), claim: null };
}

/** Without the days an account has taken over. */
export const withoutDays = (kept: KeptDailies, days: readonly string[]): KeptDailies => ({ ...kept, results: kept.results.filter((result) => !days.includes(result.daily)) });

/** A kept round as a claim sends it, or null for one kept before rounds named their place. */
function claimedRound(round: KeptDaily['rounds'][number]): SavedRound | null {
  const { id, lng, lat } = round;
  if (id === undefined || lng === undefined || lat === undefined) {
    return null;
  }
  return { ...round, id, lng, lat, guessLng: round.guessLng ?? null, guessLat: round.guessLat ?? null };
}

/** A kept result as a claim sends it, or null when the server could not take it: begun without a token, or kept before this was asked. */
function claimed(result: KeptDaily): StoredDaily | null {
  const rounds = result.rounds.map(claimedRound);
  return result.token !== null && rounds.every((round) => round !== null) ? { daily: result.daily, token: result.token, rounds } : null;
}

/** True for a kept result an account made later can be offered: begun with a token, on places it names. */
export const isClaimable = (result: KeptDaily): boolean => claimed(result) !== null;

/** What a new account can be offered today: results of the last 14 days that the server can take, 14 at most. */
export const claimable = (kept: KeptDailies, today: string): StoredDaily[] =>
  kept.results
    .filter((result) => result.daily >= oldestKept(today) && result.daily <= today)
    .map(claimed)
    .filter((result) => result !== null)
    .slice(-MAX_CLAIMED_RESULTS);

/** The last 14 days as the server gives an account its history: oldest first, today last, no score for a day not played. */
export function historyOf(kept: KeptDailies, today: string): Array<{ date: string; score: number | null }> {
  return Array.from({ length: KEPT_DAYS }, (_, index) => {
    const date = dayBefore(today, KEPT_DAYS - 1 - index);
    const result = resultOn(kept, date);
    return { date, score: result ? scoreOf(result) : null };
  });
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const KEY = 'plonk.daily';

/** Storage can be missing, blocked or full: then nothing is kept, and the daily is played as if for the first time. */
export function createVisitorStore(storage: () => Storage) {
  const read = (): KeptDailies => {
    try {
      const parsed = keptSchema.safeParse(JSON.parse(storage().getItem(KEY) ?? 'null'));
      return parsed.success ? parsed.data : EMPTY;
    } catch {
      return EMPTY;
    }
  };
  return {
    read,
    /** Changes what is kept and returns the new state, which is what counts for this page even when it could not be stored. */
    update(change: (kept: KeptDailies) => KeptDailies): KeptDailies {
      const next = change(read());
      try {
        storage().setItem(KEY, JSON.stringify(next));
      } catch {
        // nowhere to keep it: the result is on screen now and gone with the page
      }
      return next;
    },
  };
}

export type VisitorStore = ReturnType<typeof createVisitorStore>;

export const visitorDailies = createVisitorStore(() => window.localStorage);
