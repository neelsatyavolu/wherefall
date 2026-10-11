import type { DailyState } from '../daily/client.ts';
import { clockParts, streakStatus, type DistributionBar, type HistoryCell, type StreakStatus } from '../daily/view.ts';
import { shareText } from '../game/share.ts';
import { formatNumber, language, t, tn } from '../i18n/index.ts';

/** What the daily says in words, in the language in use. No DOM here, so it is tested as text. */

const utcDate = (date: string, options: Intl.DateTimeFormatOptions): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat(language(), { ...options, timeZone: 'UTC' }).format(parsed);
};

/** "2026-10-11" as "October 11, 2026". The day is a UTC day, so it is written as one. */
export const dayName = (date: string): string => utcDate(date, { month: 'long', day: 'numeric', year: 'numeric' });
/** "October 11": for a label that is read out. */
const dayInWords = (date: string): string => utcDate(date, { month: 'long', day: 'numeric' });
/** "10/11": for a cell of the history strip, which is narrow. */
export const dayInDigits = (date: string): string => utcDate(date, { month: 'numeric', day: 'numeric' });

/** A whole percent as the language writes it: 50%, 50 %. */
export const percent = (value: number): string => new Intl.NumberFormat(language(), { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);

/** "Beat 50% of players", or nothing where nobody was beaten (which is also what the server says while nobody else has played). */
export const beatLine = (beat: number | null): string => (beat !== null && beat > 0 ? t('daily.beat', { share: percent(beat) }) : '');

/** A difference with its sign, as the language writes one: +320, -1,180. */
const signed = (value: number): string => new Intl.NumberFormat(language(), { signDisplay: 'exceptZero' }).format(value);

/**
 * How far a round was from the day's average for it, in words: the sign and the number for a
 * glance, "above" or "below" so that neither has to be worked out, and no colour to lean on.
 */
export function averageWords(diff: number): string {
  if (diff === 0) {
    return t('daily.average.level');
  }
  return t(diff > 0 ? 'daily.average.above' : 'daily.average.below', { points: signed(diff) });
}

const STREAK_NOTES: Record<Exclude<StreakStatus, 'none'>, 'daily.streak.atRisk' | 'daily.streak.spent' | 'daily.streak.kept'> = {
  atRisk: 'daily.streak.atRisk',
  spent: 'daily.streak.spent',
  kept: 'daily.streak.kept',
};

export interface StreakWords {
  /** "5 days" */
  current: string;
  /** "Best: 12 days" */
  best: string;
  /** true while today could still break the streak: it is then marked "at risk" */
  atRisk: boolean;
  /** one sentence on where the streak stands; empty when there is nothing to say */
  note: string;
}

export function streakWords(streak: DailyState['streak'], state: DailyState['state']): StreakWords {
  const status = streakStatus(streak, state);
  const none = state === 'open' ? t('daily.streak.start') : '';
  return {
    current: tn('daily.days', streak.current),
    best: t('daily.streak.best', { days: tn('daily.days', streak.best) }),
    atRisk: status === 'atRisk' || status === 'spent',
    note: status === 'none' ? none : t(STREAK_NOTES[status]),
  };
}

const two = (value: number) => String(value).padStart(2, '0');

/** What is left until the next daily, as 05:59:58. */
export function countdownText(ms: number): string {
  const { hours, minutes, seconds } = clockParts(ms);
  return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

/** One bar of the day's scores, for a pointer resting on it and for a screen reader. */
export const barLabel = (bar: DistributionBar): string => tn('daily.distribution.bar', bar.count, { from: formatNumber(bar.from), to: formatNumber(bar.to) });

/** One day of the history strip, in full. */
export function cellLabel(cell: HistoryCell): string {
  if (cell.score !== null) {
    const score = formatNumber(cell.score);
    return cell.today ? t('daily.history.todayPlayed', { score }) : t('daily.history.played', { date: dayInWords(cell.date), score });
  }
  return cell.today ? t('daily.history.open') : t('daily.history.missed', { date: dayInWords(cell.date) });
}

export interface SharedDaily {
  /** UTC day, YYYY-MM-DD */
  date: string;
  score: number;
  maxScore: number;
  /** the score of each round */
  rounds: readonly number[];
  /** whole percent of the day's other players who scored lower; null when it is not known (a visitor) */
  beat: number | null;
}

/** The text "Share result" copies for a daily: the date, the score, the share of players beaten, a square a round, and the link. */
export function dailyShareText(result: SharedDaily, url: string): string {
  return shareText({
    title: t('daily.share.title', { date: dayName(result.date) }),
    score: result.score,
    maxScore: result.maxScore,
    roundScores: result.rounds,
    extra: [beatLine(result.beat)],
    url,
    formatNumber,
  });
}

/** Where the daily is played: what a shared result links to. */
export const dailyUrl = (): string => `${location.origin}${location.pathname}#daily`;
