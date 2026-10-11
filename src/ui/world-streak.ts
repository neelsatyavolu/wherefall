import type { LngLat } from '../game/geo.ts';
import type { RoundResult } from '../game/session.ts';
import { NO_STREAK, afterRound, answerOf, lengthOf, tidy, withRun, type BegunStreak, type StreakRound, type WorldStreak } from '../game/world-streak.ts';
import { loadCountryFinder } from './country-finder.ts';
import { unsentFinishes, type UnsentFinish, type UnsentStore } from './world-streak-unsent.ts';

/**
 * The background country streak of ordinary play (rules in `game/world-streak.ts`), kept in this
 * browser so it runs on from one world game to the next. An account's streak is a run on the
 * server, through `StreakRuns`: begun when the streak's first round is played, and finished when
 * the streak ends, with the rounds that made it.
 */

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Finder = (point: LngLat) => string | null;

const KEY = 'plonk.world-streak';

/** Storage can be missing or blocked: the streak then starts from nothing on every read, and nothing is lost but the count. */
export function createStreakStore(storage: () => Storage) {
  return {
    read(): WorldStreak {
      try {
        return tidy(JSON.parse(storage().getItem(KEY) ?? 'null'));
      } catch {
        return NO_STREAK;
      }
    },
    write(state: WorldStreak): void {
      try {
        storage().setItem(KEY, JSON.stringify(state));
      } catch {
        // nowhere to keep it: the streak lasts as long as storage lets it
      }
    },
  };
}

export type StreakStore = ReturnType<typeof createStreakStore>;

export const worldStreakStore = createStreakStore(() => window.localStorage);

/**
 * What became of a finish. `done`: the server has answered for good, by taking it or by a refusal
 * no later try can mend. `later`: it did not get through (no network, a busy server, a session that
 * has ended) and is worth sending again, which a run allows: it counts once however often it is finished.
 */
export type FinishOutcome = 'done' | 'later';

/** How a streak is a run on the server. `ui/world-streak-runs.ts` is the one made of the account's own calls. */
export interface StreakRuns {
  /** Begins a run for a streak whose first round was just played. Resolves to it, or to null when there is none to have (a visitor, a guest, a start that failed). */
  begin: () => Promise<BegunStreak | null>;
  /** Finishes the run of a streak that ended, with every round played, the losing one last. */
  finish: (begun: BegunStreak, rounds: readonly StreakRound[]) => Promise<FinishOutcome>;
}

/** What a round did to the streak, for the round's result to say. */
export interface StreakNews {
  /** the streak now */
  streak: number;
  /** how long the streak was that this round ended; 0 when it ended none */
  ended: number;
}

export interface StreakTracker {
  /** Judges a finished round. Resolves to what to say about it, or null when the borders could not be loaded and nothing was counted. */
  round: (result: RoundResult) => Promise<StreakNews | null>;
}

/**
 * Counts one game's rounds into the streak. Rounds are judged in the order they were played,
 * whenever the borders arrive, and what a result says never waits for the server: a run is begun
 * after its streak's first round is judged and before the next one is, and finished on its own.
 * A finish that does not get through is kept (`unsent`) and sent again as the next game begins,
 * so the account's best streak still learns of it.
 */
export function trackWorldStreak(
  runs: StreakRuns,
  store: StreakStore = worldStreakStore,
  finder: () => Promise<Finder> = loadCountryFinder,
  unsent: UnsentStore = unsentFinishes,
): StreakTracker {
  const borders: Promise<Finder | null> = finder().catch(() => null);
  let queue: Promise<unknown> = Promise.resolve();
  /** finishes go to the server one at a time, apart from the rounds: what is kept for later is never changed by two at once */
  let sending: Promise<unknown> = Promise.resolve();

  /** Sends a finish, and keeps it for another time unless the server has answered for good. Nothing waits on it. */
  const send = (finish: UnsentFinish): void => {
    sending = sending.then(async () => {
      const outcome = await runs.finish(finish.begun, finish.rounds).catch((): FinishOutcome => 'later');
      if (outcome === 'later') {
        unsent.add(finish);
      } else {
        unsent.remove(finish.begun.run);
      }
    });
  };
  // what an earlier game could not deliver is tried again as this one begins
  unsent.read().forEach(send);

  /** One thing at a time, so two rounds never read the same streak. */
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const done = queue.then(task);
    queue = done.catch(() => undefined);
    return done;
  };

  const begin = async (): Promise<void> => {
    const begun = await runs.begin().catch(() => null);
    if (begun) {
      store.write(withRun(store.read(), begun));
    }
  };

  return {
    round: (result) =>
      inTurn(async () => {
        const find = await borders;
        if (!find) {
          return null;
        }
        const played = { id: result.location.id, answer: answerOf(result.guess, find) };
        const judged = afterRound(store.read(), played, result.location.country);
        store.write(judged.state);
        if (judged.begins) {
          void inTurn(begin);
        }
        if (judged.finish) {
          // nothing waits on this: the streak is over either way, and a finish that fails is sent again another time
          send(judged.finish);
        }
        return { streak: lengthOf(judged.state), ended: judged.ended };
      }),
  };
}
