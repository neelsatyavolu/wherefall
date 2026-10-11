import { DAILY_MAX_SCORE, type DailyEntry, type DailyState } from './client.ts';
import { attemptOn, historyOf, isClaimable, resultOn, scoreOf, type Attempt, type KeptDailies } from './visitor-store.ts';

/** What the daily pane shows, worked out from what the server sent: no text and no DOM here. */

type Streak = DailyState['streak'];
type State = DailyState['state'];

/**
 * `none`: no streak to speak of. `atRisk`: playing today keeps it. `spent`: today's one attempt was
 * begun and left, so today cannot count. `kept`: today is played.
 */
export type StreakStatus = 'none' | 'atRisk' | 'spent' | 'kept';

export function streakStatus(streak: Streak, state: State): StreakStatus {
  if (streak.current === 0) {
    return 'none';
  }
  if (!streak.atRisk) {
    return 'kept';
  }
  return state === 'open' ? 'atRisk' : 'spent';
}

/** What the Daily item in the sidebar says: not played, streak at risk, or nothing left to play today. */
export type IndicatorState = 'open' | 'atRisk' | 'done';

export function indicatorState(state: State, streak: Streak): IndicatorState {
  if (state !== 'open') {
    return 'done';
  }
  return streak.atRisk && streak.current > 0 ? 'atRisk' : 'open';
}

/**
 * How long until the next daily opens: the server's two times give what was left when it answered,
 * and `sinceMs` is how long ago that was by this browser's clock. Null when the times cannot be read.
 */
export function remainingMs(nextAt: string, serverNow: string, sinceMs: number): number | null {
  const left = Date.parse(nextAt) - Date.parse(serverNow);
  return Number.isNaN(left) ? null : Math.max(0, left - sinceMs);
}

const SECOND_MS = 1000;

/** What is left as hours, minutes and seconds; a second that has started counts whole, so it reads 0:00:00 only at the end. */
export function clockParts(ms: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.ceil(Math.max(0, ms) / SECOND_MS);
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export interface DistributionBar {
  /** the lowest and the highest score that fall in this bar */
  from: number;
  to: number;
  /** how many of today's results do */
  count: number;
  /** the bar's height against the tallest, 0 to 1 */
  share: number;
  /** true for the one bar the player's own score is in */
  own: boolean;
}

/** The day's results as bars over equal stretches of the maximum (ten of 1,500 points); the last one takes the maximum itself. */
export function distributionBars(counts: readonly number[], ownScore: number | null, maxScore: number = DAILY_MAX_SCORE): DistributionBar[] {
  const width = maxScore / counts.length;
  const tallest = Math.max(0, ...counts);
  const ownBar = ownScore === null ? -1 : Math.min(counts.length - 1, Math.floor(ownScore / width));
  return counts.map((count, index) => ({
    from: index * width,
    to: index === counts.length - 1 ? maxScore : (index + 1) * width - 1,
    count,
    share: tallest === 0 ? 0 : count / tallest,
    own: index === ownBar,
  }));
}

export interface HistoryCell {
  /** UTC day, YYYY-MM-DD */
  date: string;
  score: number | null;
  /** `open` is today while it is not played */
  state: 'played' | 'missed' | 'open';
  today: boolean;
}

/** The history strip: a cell a day, oldest first. */
export function historyCells(history: DailyState['history'], today: string): HistoryCell[] {
  return history.map(({ date, score }) => ({ date, score, state: score !== null ? 'played' : date === today ? 'open' : 'missed', today: date === today }));
}

/**
 * The player's own row for under a page of the leaderboard that does not have them on it. Null for
 * a visitor, a player with no result, or a page the player is on.
 */
export function ownRowOutside(
  entries: readonly DailyEntry[],
  player: { username: string; country: string | null } | null,
  yours: { score: number; rank: number } | null,
): DailyEntry | null {
  if (!player || !yours || entries.some((entry) => entry.username === player.username)) {
    return null;
  }
  return { rank: yours.rank, username: player.username, country: player.country, score: yours.score };
}

/** The viewer's own result: as the server ranks it for an account, or as this browser kept it for a visitor (no rank, nobody beaten). */
export interface Standing {
  score: number;
  maxScore: number;
  /** the score of each round */
  rounds: number[];
  rank: number | null;
  beat: number | null;
  /** the day's mean score for each round; null until five players have finished, and for a visitor */
  averages: number[] | null;
  /** true when the total beats every earlier daily of the account; never for a visitor */
  personalBest: boolean;
}

/**
 * How far above (or, negative, below) the day's average each round of a result was. Null while the
 * day has no averages yet, or when they are not one a round.
 */
export function aboveAverage(standing: Pick<Standing, 'rounds' | 'averages'>): number[] | null {
  const { rounds, averages } = standing;
  return averages !== null && averages.length === rounds.length ? rounds.map((score, index) => score - averages[index]!) : null;
}

/** One round of a result beside the day's average for it. */
export interface RoundAgainstAverage {
  /** counted from 1 */
  round: number;
  score: number;
  /** how far above the average the round was; negative for below */
  diff: number;
}

/** A result round by round against the day's averages. Null while there are none: nothing is then drawn for it. */
export function againstAverage(standing: Pick<Standing, 'rounds' | 'averages'>): RoundAgainstAverage[] | null {
  const above = aboveAverage(standing);
  return above === null ? null : above.map((diff, index) => ({ round: index + 1, score: standing.rounds[index]!, diff }));
}

/**
 * The result on the leaderboard, when it is that of a game of `score` points just played: what that
 * game's summary may say of it. Null when an earlier result is the one that stands, or none is known.
 */
export function standingOfGame<T extends { score: number }>(yours: T | null, score: number): T | null {
  return yours !== null && yours.score === score ? yours : null;
}

/** What the daily is to the one looking at it. */
export interface Viewed {
  state: Attempt;
  standing: Standing | null;
  history: DailyState['history'];
  /** false for a visitor's result that no account can take over: one kept before a start was answered with a token */
  claimable: boolean;
}

/**
 * Where the viewer's one attempt stands and what came of it. An account is told by the server. For
 * anyone else the server knows nothing (it says `open`), so the attempt and its result are the ones
 * kept in this browser.
 */
export function viewed(daily: DailyState, signedIn: boolean, kept: KeptDailies): Viewed {
  if (signedIn || daily.state !== 'open') {
    return { state: daily.state, standing: daily.yours, history: daily.history, claimable: true };
  }
  const result = resultOn(kept, daily.date);
  return {
    claimable: result === null || isClaimable(result),
    state: attemptOn(kept, daily.date),
    standing: result
      ? { score: scoreOf(result), maxScore: DAILY_MAX_SCORE, rounds: result.rounds.map((round) => round.score), rank: null, beat: null, averages: null, personalBest: false }
      : null,
    history: kept.results.length > 0 ? historyOf(kept, daily.date) : [],
  };
}
