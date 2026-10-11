import type { LngLat } from './geo.ts';
import { MAX_STREAK } from './streak.ts';

/**
 * The country streak that ordinary play keeps in the background: every round of a singleplayer
 * game on the world map whose guess lands in the right country adds one, and a miss (another
 * country, the sea, no guess) starts it again. It runs on from one game to the next. For an
 * account it is a run on the server as the Country streak mode's is: begun when the streak's first
 * round is played, finished when the streak ends with the rounds that made it, the losing one
 * last. All of it is here as pure functions; where it is kept and who is told is `ui/world-streak.ts`.
 */

/** One round as a run's finish sends it: the place shown, by its id in the list, and the country the guess was in (null for none). */
export interface StreakRound {
  readonly id: string;
  readonly answer: string | null;
}

/** A run begun on the server for a streak: its token, and when this browser had it (ms since 1970). */
export interface BegunStreak {
  readonly run: string;
  readonly at: number;
}

export interface WorldStreak {
  /** the rounds of the streak so far, oldest first: as many as it is long */
  readonly rounds: readonly StreakRound[];
  /** the run begun for it; null when it has none (a visitor's streak, or a start that failed) */
  readonly begun: BegunStreak | null;
}

export const NO_STREAK: WorldStreak = { rounds: [], begun: null };

/** a streak this long or longer is worth saying so when it is lost */
export const WORTH_MOURNING = 2;

export const lengthOf = (state: WorldStreak): number => state.rounds.length;

/** What a round did to the streak. */
export interface Judged {
  readonly state: WorldStreak;
  /** how long the streak was that this round ended; 0 when it ended none */
  readonly ended: number;
  /** true when this round is a streak's first: a run is to be begun for it */
  readonly begins: boolean;
  /** the run of the streak that ended, to be finished with these rounds; null when no streak ended, or it had no run */
  readonly finish: { readonly begun: BegunStreak; readonly rounds: readonly StreakRound[] } | null;
}

/** The country a guess is in, by the same lookup the Country streak mode uses; null for the sea and for no guess. */
export function answerOf(guess: LngLat | null, find: (point: LngLat) => string | null): string | null {
  return guess === null ? null : find(guess);
}

/** The streak after a round at a place in `country`: one longer when the answer is that country, begun again for anything else. */
export function afterRound(state: WorldStreak, round: StreakRound, country: string): Judged {
  const finishWith = (rounds: readonly StreakRound[]) => (state.begun ? { begun: state.begun, rounds } : null);
  if (round.answer !== country) {
    const ended = state.rounds.length;
    return { state: NO_STREAK, ended, begins: false, finish: ended > 0 ? finishWith([...state.rounds, round]) : null };
  }
  const rounds = [...state.rounds, round];
  if (rounds.length >= MAX_STREAK) {
    // the longest streak the server takes: it ends here unbeaten, and the next right country begins another
    return { state: NO_STREAK, ended: rounds.length, begins: false, finish: finishWith(rounds) };
  }
  return { state: { ...state, rounds }, ended: 0, begins: state.rounds.length === 0, finish: null };
}

/** The streak with the run begun for it. A streak that has one keeps it; one that ended while the run was on its way has none to give it to. */
export function withRun(state: WorldStreak, begun: BegunStreak): WorldStreak {
  return state.rounds.length > 0 && state.begun === null ? { ...state, begun } : state;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isRound = (value: unknown): value is StreakRound => isRecord(value) && typeof value.id === 'string' && (value.answer === null || typeof value.answer === 'string');
const isBegun = (value: unknown): value is BegunStreak => isRecord(value) && typeof value.run === 'string' && value.run.length > 0 && typeof value.at === 'number';

/** What a browser had stored, as a streak: anything that is not one counts as none. */
export function tidy(stored: unknown): WorldStreak {
  if (!isRecord(stored) || !Array.isArray(stored.rounds) || stored.rounds.length === 0 || stored.rounds.length >= MAX_STREAK || !stored.rounds.every(isRound)) {
    return NO_STREAK;
  }
  const rounds = stored.rounds.map(({ id, answer }) => ({ id, answer }));
  return { rounds, begun: isBegun(stored.begun) ? { run: stored.begun.run, at: stored.begun.at } : null };
}
