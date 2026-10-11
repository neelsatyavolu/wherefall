import type { DailyResult, Standing } from '../db/daily.js';
import { DAILY_MAX_SCORE, lastDays } from './daily.js';
import { dailyStreak, type DailyStreak } from './streak.js';

/** How many days the strip of past results covers, today included. */
export const HISTORY_DAYS = 14;
/** The day's results are counted in this many bands of equal width. */
export const DISTRIBUTION_BANDS = 10;
export const DISTRIBUTION_BAND_WIDTH = DAILY_MAX_SCORE / DISTRIBUTION_BANDS;

export interface DailyRecords {
  played: number;
  best: number;
  average: number;
}

/** A round's average is shown once this many players have finished the day's daily. */
export const AVERAGES_FROM_PLAYERS = 5;

export interface OwnResult {
  score: number;
  maxScore: number;
  rounds: number[];
  rank: number;
  beat: number;
  /** The day's mean score for each round, rounded. Null until enough players have finished. */
  averages: number[] | null;
  /** True when this total is higher than every earlier daily of the account. False for its first. */
  personalBest: boolean;
}

export interface OwnDaily {
  state: 'open' | 'started' | 'done';
  yours: OwnResult | null;
  streak: DailyStreak;
  records: DailyRecords | null;
  history: Array<{ date: string; score: number | null }>;
}

/** What someone with no account is told about themselves. */
export const VISITOR: OwnDaily = { state: 'open', yours: null, streak: { current: 0, best: 0, atRisk: false }, records: null, history: [] };

/** The whole percent of the day's other players who scored lower, rounded down. Nothing while there is nobody else. */
export const percentBeaten = (lower: number, others: number): number => (others === 0 ? 0 : Math.floor((100 * lower) / others));

/**
 * How many dailies were played, the best and the average. Only results out
 * of today's maximum are counted: the daily was once five rounds, and a
 * score out of 25,000 does not compare.
 */
export function recordsOf(results: readonly DailyResult[]): DailyRecords {
  const scores = results.filter((result) => result.maxScore === DAILY_MAX_SCORE).map((result) => result.score);
  if (scores.length === 0) {
    return { played: 0, best: 0, average: 0 };
  }
  const total = scores.reduce((sum, score) => sum + score, 0);
  return { played: scores.length, best: Math.max(...scores), average: Math.round(total / scores.length) };
}

interface Own {
  results: readonly DailyResult[];
  /** Whether today's attempt has been begun. */
  begun: boolean;
  /** Where today's result stands, or null when today is not played. */
  standing: Standing | null;
}

/** What an account is told about its own dailies: today's, the streak, the records and the last two weeks. */
export function ownDaily({ results, begun, standing }: Own, today: string, now: number): OwnDaily {
  const byDate = new Map(results.map((result) => [result.date, result]));
  const yours = standing
    ? {
        score: standing.score,
        maxScore: standing.maxScore,
        rounds: standing.rounds,
        rank: standing.rank,
        beat: percentBeaten(standing.lower, standing.others),
        averages: standing.finished >= AVERAGES_FROM_PLAYERS ? standing.averages : null,
        personalBest: standing.personalBest,
      }
    : null;
  return {
    state: yours ? 'done' : begun ? 'started' : 'open',
    yours,
    streak: dailyStreak([...byDate.keys()], today),
    records: recordsOf(results),
    history: lastDays(now, HISTORY_DAYS).map((date) => ({ date, score: byDate.get(date)?.score ?? null })),
  };
}
