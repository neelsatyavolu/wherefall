import { describe, expect, it } from 'vitest';
import { dailyStreak } from './streak.js';

const TODAY = '2027-01-15';
const DAY_MS = 86_400_000;

/** The day `ago` days before today. */
const day = (ago: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) - ago * DAY_MS).toISOString().slice(0, 10);
/** Every day from `from` days ago to `to` days ago, both included. */
const span = (from: number, to: number): string[] => Array.from({ length: from - to + 1 }, (_unused, index) => day(from - index));
const streak = (...played: string[]) => dailyStreak(played, TODAY);

describe('dailyStreak', () => {
  it('is nothing before the first result', () => {
    expect(streak()).toEqual({ current: 0, best: 0, atRisk: false });
  });

  it('counts the days in a row ending today', () => {
    expect(streak(day(0))).toEqual({ current: 1, best: 1, atRisk: false });
    expect(streak(...span(2, 0))).toEqual({ current: 3, best: 3, atRisk: false });
  });

  it('counts back from yesterday while today is not played yet, and says the streak is at risk', () => {
    expect(streak(day(1))).toEqual({ current: 1, best: 1, atRisk: true });
    expect(streak(...span(4, 1))).toEqual({ current: 4, best: 4, atRisk: true });
  });

  it('is over, and not at risk, when neither today nor yesterday was played and there is no day to bridge', () => {
    expect(streak(...span(4, 2))).toEqual({ current: 0, best: 3, atRisk: false });
    expect(streak(...span(9, 3))).toEqual({ current: 0, best: 7, atRisk: false });
  });

  it('bridges one missed day when it is the only one in the seven days ending at the next played day', () => {
    // Five days played, one missed, then yesterday and today.
    expect(streak(...span(7, 3), day(1), day(0))).toEqual({ current: 7, best: 7, atRisk: false });
    // The same with the missed day right before today.
    expect(streak(...span(6, 2), day(0))).toEqual({ current: 6, best: 6, atRisk: false });
  });

  it('does not bridge a missed day with another day missing in those seven', () => {
    // Only four days played before the missed one: the fifth day back is missing too.
    expect(streak(...span(5, 2), day(0))).toEqual({ current: 1, best: 4, atRisk: false });
    // Played, missed, played, missed, played: the second missed day has the first in its seven days.
    expect(streak(...span(9, 5), day(3), day(1))).toEqual({ current: 1, best: 6, atRisk: true });
  });

  it('never bridges two missed days in a row', () => {
    expect(streak(...span(10, 3), day(0))).toEqual({ current: 1, best: 8, atRisk: false });
  });

  it('allows one bridged day in every seven, again and again', () => {
    expect(streak(...span(12, 8), ...span(6, 2), day(0))).toEqual({ current: 11, best: 11, atRisk: false });
  });

  it('keeps a streak at risk across a missed yesterday that playing today would bridge', () => {
    expect(streak(...span(6, 2))).toEqual({ current: 5, best: 5, atRisk: true });
    // One day short of the five that a bridge needs.
    expect(streak(...span(5, 2))).toEqual({ current: 0, best: 4, atRisk: false });
  });

  it('remembers the longest streak when the current one is shorter', () => {
    expect(streak(...span(30, 21), day(1), day(0))).toEqual({ current: 2, best: 10, atRisk: false });
  });

  it('takes the days in any order, counts a day given twice once, and ignores days after today', () => {
    expect(streak(day(0), day(2), day(1), day(1), day(-1), day(-2))).toEqual({ current: 3, best: 3, atRisk: false });
  });

  it('counts across the end of a month and of a year', () => {
    expect(dailyStreak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01')).toEqual({ current: 3, best: 3, atRisk: false });
    expect(dailyStreak(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01')).toEqual({ current: 3, best: 3, atRisk: false });
  });
});
