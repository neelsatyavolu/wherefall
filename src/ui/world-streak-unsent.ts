import { z } from 'zod';
import type { BegunStreak, StreakRound } from '../game/world-streak.ts';

/**
 * Finishes of the background country streak that did not reach the server: the network was down
 * as the streak ended, or the server was busy. A run counts once and its token does not expire, so
 * the same finish can be sent again later without harm, and the account's best streak still learns
 * of it. They are kept in this browser until the server has answered.
 */

/** The finish of one streak: its run, and every round played, the losing one last. */
export interface UnsentFinish {
  readonly begun: BegunStreak;
  readonly rounds: readonly StreakRound[];
}

/** How many are kept at most; the oldest make way. */
export const MAX_UNSENT = 5;
/** How long one is kept: after two weeks the account it belongs to is taken not to be coming back to this browser. */
export const KEEP_UNSENT_MS = 14 * 86_400_000;

const KEY = 'plonk.world-streak.unsent';

const keptSchema = z.array(
  z.object({
    begun: z.object({ run: z.string().min(1), at: z.number() }),
    rounds: z.array(z.object({ id: z.string(), answer: z.string().nullable() })).min(1),
    /** when this browser first kept it (ms since 1970) */
    since: z.number(),
  }),
);

type Kept = z.infer<typeof keptSchema>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** Storage can be missing or blocked: then nothing is kept, and a finish that fails is lost as it was before. */
export function createUnsentStore(storage: () => Storage, now: () => number = () => Date.now()) {
  const kept = (): Kept => {
    try {
      const parsed = keptSchema.safeParse(JSON.parse(storage().getItem(KEY) ?? '[]'));
      return parsed.success ? parsed.data.filter((each) => now() - each.since <= KEEP_UNSENT_MS) : [];
    } catch {
      return [];
    }
  };
  const keep = (list: Kept): void => {
    try {
      storage().setItem(KEY, JSON.stringify(list));
    } catch {
      // nowhere to keep it
    }
  };
  const without = (run: string): Kept => kept().filter((each) => each.begun.run !== run);
  return {
    /** The finishes still to send, oldest first. */
    read: (): UnsentFinish[] => kept().map(({ begun, rounds }) => ({ begun, rounds })),
    /** Keeps a finish for later. A run is kept once, however often it fails. */
    add(finish: UnsentFinish): void {
      // one that fails again is as old as it was: the two weeks are counted from the first time
      const since = kept().find((each) => each.begun.run === finish.begun.run)?.since ?? now();
      keep([...without(finish.begun.run), { begun: finish.begun, rounds: [...finish.rounds], since }].slice(-MAX_UNSENT));
    },
    /** The server has answered for this run: there is nothing more to send. */
    remove(run: string): void {
      const rest = without(run);
      if (rest.length !== kept().length) {
        keep(rest);
      }
    },
  };
}

export type UnsentStore = ReturnType<typeof createUnsentStore>;

export const unsentFinishes = createUnsentStore(() => window.localStorage);
