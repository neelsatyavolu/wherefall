import { describe, expect, it } from 'vitest';
import type { DailyEntry, DailyState } from './client.ts';
import { aboveAverage, againstAverage, clockParts, distributionBars, historyCells, indicatorState, ownRowOutside, remainingMs, standingOfGame, streakStatus, viewed } from './view.ts';
import { EMPTY, begun, withResult } from './visitor-store.ts';

const streak = (current: number, atRisk: boolean, best = current) => ({ current, best, atRisk });

describe('streakStatus', () => {
  it('is none without a streak', () => {
    expect(streakStatus(streak(0, false), 'open')).toBe('none');
    expect(streakStatus(streak(0, true), 'open')).toBe('none');
  });

  it('is at risk until today is played', () => {
    expect(streakStatus(streak(4, true), 'open')).toBe('atRisk');
  });

  it('is spent when today was begun and cannot be finished', () => {
    expect(streakStatus(streak(4, true), 'started')).toBe('spent');
  });

  it('is kept once today counts', () => {
    expect(streakStatus(streak(5, false), 'done')).toBe('kept');
  });
});

describe('indicatorState', () => {
  it('is one of three: not played, streak at risk, done', () => {
    expect(indicatorState('open', streak(0, false))).toBe('open');
    expect(indicatorState('open', streak(3, true))).toBe('atRisk');
    expect(indicatorState('done', streak(4, false))).toBe('done');
  });

  it('counts an attempt that was begun as done: there is nothing left to play today', () => {
    expect(indicatorState('started', streak(3, true))).toBe('done');
  });

  it('has no streak to lose where there is none', () => {
    expect(indicatorState('open', streak(0, true))).toBe('open');
  });
});

describe('remainingMs', () => {
  const NOW = '2026-10-11T18:00:00.000Z';
  const NEXT = '2026-10-12T00:00:00.000Z';

  it("counts from the server's clock, less the time since it answered", () => {
    expect(remainingMs(NEXT, NOW, 0)).toBe(6 * 3_600_000);
    expect(remainingMs(NEXT, NOW, 90_000)).toBe(6 * 3_600_000 - 90_000);
  });

  it('stops at nothing', () => {
    expect(remainingMs(NEXT, NOW, 7 * 3_600_000)).toBe(0);
  });

  it('is null for times it cannot read', () => {
    expect(remainingMs('soon', NOW, 0)).toBeNull();
  });
});

describe('clockParts', () => {
  it('splits what is left into hours, minutes and seconds, a started second counting whole', () => {
    expect(clockParts(6 * 3_600_000)).toEqual({ hours: 6, minutes: 0, seconds: 0 });
    expect(clockParts(3_723_400)).toEqual({ hours: 1, minutes: 2, seconds: 4 });
    expect(clockParts(999)).toEqual({ hours: 0, minutes: 0, seconds: 1 });
    expect(clockParts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('distributionBars', () => {
  const COUNTS = [0, 1, 0, 4, 8, 2, 0, 0, 1, 0];

  it('makes ten bars over tenths of 15,000, the last one reaching the most', () => {
    const bars = distributionBars(COUNTS, null);
    expect(bars).toHaveLength(10);
    expect(bars[0]).toMatchObject({ from: 0, to: 1499, count: 0 });
    expect(bars[3]).toMatchObject({ from: 4500, to: 5999, count: 4 });
    expect(bars[9]).toMatchObject({ from: 13_500, to: 15_000, count: 0 });
  });

  it('sizes each bar against the tallest', () => {
    const bars = distributionBars(COUNTS, null);
    expect(bars[4]!.share).toBe(1);
    expect(bars[3]!.share).toBe(0.5);
    expect(bars[0]!.share).toBe(0);
  });

  it("marks the bar the player's own score falls in, and no other", () => {
    expect(distributionBars(COUNTS, 11_250).map((bar) => bar.own)).toEqual([false, false, false, false, false, false, false, true, false, false]);
    expect(distributionBars(COUNTS, 15_000)[9]!.own).toBe(true);
    expect(distributionBars(COUNTS, 0)[0]!.own).toBe(true);
    expect(distributionBars(COUNTS, null).some((bar) => bar.own)).toBe(false);
  });

  it('has flat bars while nobody has played', () => {
    expect(distributionBars(Array.from({ length: 10 }, () => 0), null).every((bar) => bar.share === 0)).toBe(true);
  });
});

describe('historyCells', () => {
  const HISTORY = [
    { date: '2026-10-09', score: 9000 },
    { date: '2026-10-10', score: null },
    { date: '2026-10-11', score: null },
  ];

  it('makes a cell a day: played with its score, missed, and today still open', () => {
    expect(historyCells(HISTORY, '2026-10-11')).toEqual([
      { date: '2026-10-09', score: 9000, state: 'played', today: false },
      { date: '2026-10-10', score: null, state: 'missed', today: false },
      { date: '2026-10-11', score: null, state: 'open', today: true },
    ]);
  });

  it('shows today as played once it is', () => {
    const cells = historyCells([...HISTORY.slice(0, 2), { date: '2026-10-11', score: 11_250 }], '2026-10-11');
    expect(cells[2]).toEqual({ date: '2026-10-11', score: 11_250, state: 'played', today: true });
  });

  it('is empty for a visitor with nothing kept', () => {
    expect(historyCells([], '2026-10-11')).toEqual([]);
  });
});

describe('ownRowOutside', () => {
  const entries: DailyEntry[] = [
    { rank: 1, username: 'sam', country: 'GB', score: 13_000 },
    { rank: 2, username: 'neel', country: null, score: 11_250 },
  ];
  const yours = { score: 11_250, rank: 2 };

  it('is nothing when the player is on the page showing', () => {
    expect(ownRowOutside(entries, { username: 'neel', country: null }, yours)).toBeNull();
  });

  it("is the player's own row when the page does not have it", () => {
    expect(ownRowOutside([entries[0]!], { username: 'neel', country: 'IN' }, { score: 4000, rank: 37 })).toEqual({ rank: 37, username: 'neel', country: 'IN', score: 4000 });
  });

  it('is nothing for a visitor, or a player with no result', () => {
    expect(ownRowOutside(entries, null, yours)).toBeNull();
    expect(ownRowOutside(entries, { username: 'ana', country: null }, null)).toBeNull();
  });
});

describe('viewed', () => {
  const daily = (change: Partial<DailyState> = {}): DailyState => ({
    date: '2026-10-11',
    seed: 'daily20261011',
    settings: { map: 'world', mode: 'move', timeLimit: 180, rounds: 3 },
    serverNow: '2026-10-11T18:00:00.000Z',
    nextAt: '2026-10-12T00:00:00.000Z',
    state: 'open',
    yours: null,
    streak: { current: 0, best: 0, atRisk: false },
    records: null,
    history: [],
    leaderboard: { entries: [], page: 1, more: false },
    distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ...change,
  });
  const round = (score: number) => ({ id: `p${score}`, lng: 2, lat: 48, guessLng: null, guessLat: null, country: 'FR', distanceKm: 10, score });
  const played = withResult(EMPTY, { daily: '2026-10-11', rounds: [round(5000), round(4000), round(3000)] });

  it("goes by the server for an account, whatever this browser kept", () => {
    const yours = { score: 9000, maxScore: 15_000, rounds: [3000, 3000, 3000], rank: 4, beat: 60, averages: [2500, 3200, 3000], personalBest: true };
    expect(viewed(daily({ state: 'done', yours }), true, played)).toMatchObject({ state: 'done', standing: yours });
    expect(viewed(daily(), true, played)).toMatchObject({ state: 'open', standing: null, history: [] });
    expect(viewed(daily({ state: 'started' }), true, EMPTY).state).toBe('started');
  });

  it("goes by this browser for a visitor: open, begun, or done with the result that was kept", () => {
    expect(viewed(daily(), false, EMPTY)).toEqual({ state: 'open', standing: null, history: [], claimable: true });
    expect(viewed(daily(), false, begun(EMPTY, '2026-10-11')).state).toBe('started');
    const done = viewed(daily(), false, played);
    expect(done.state).toBe('done');
    expect(done.standing).toEqual({ score: 12_000, maxScore: 15_000, rounds: [5000, 4000, 3000], rank: null, beat: null, averages: null, personalBest: false });
    expect(done.history).toHaveLength(14);
    expect(done.history[13]).toEqual({ date: '2026-10-11', score: 12_000 });
  });

  it('does not open a new day on an attempt begun the day before', () => {
    expect(viewed(daily({ date: '2026-10-12' }), false, begun(EMPTY, '2026-10-11')).state).toBe('open');
  });

  it("says whether a visitor's result can still move to an account: only one begun with a token, on places it names", () => {
    const withToken = withResult(begun(EMPTY, '2026-10-11', 'daily.token'), { daily: '2026-10-11', rounds: [round(5000), round(4000), round(3000)] });
    expect(viewed(daily(), false, withToken).claimable).toBe(true);
    // kept before a start gave a token: shown as it was, and never offered
    expect(viewed(daily(), false, played).claimable).toBe(false);
    // nothing kept, and an account's own result, have nothing to be turned away
    expect(viewed(daily(), false, EMPTY).claimable).toBe(true);
    expect(viewed(daily({ state: 'done' }), true, played).claimable).toBe(true);
  });

  it('never marks a visitor’s result a personal best, nor sets it against an average: only the server knows either', () => {
    const { standing } = viewed(daily(), false, played);
    expect(standing?.personalBest).toBe(false);
    expect(againstAverage(standing!)).toBeNull();
  });
});

describe('againstAverage', () => {
  it('lists each round with its score and how far it was from the average, counted from 1', () => {
    expect(againstAverage({ rounds: [4800, 3950, 2500], averages: [3900, 4100, 2500] })).toEqual([
      { round: 1, score: 4800, diff: 900 },
      { round: 2, score: 3950, diff: -150 },
      { round: 3, score: 2500, diff: 0 },
    ]);
  });

  it('is nothing below five finishers, so nothing is drawn for it: no rows and no empty column', () => {
    expect(againstAverage({ rounds: [4800, 3950, 2500], averages: null })).toBeNull();
    expect(againstAverage({ rounds: [4800, 3950, 2500], averages: [3900] })).toBeNull();
  });
});

describe('standingOfGame', () => {
  const yours = { score: 11_250, maxScore: 15_000, rounds: [4800, 3950, 2500], rank: 2, beat: 50, averages: [3900, 4100, 2500], personalBest: true };

  it('is the result on the leaderboard when it is the game just played: its personal best and its averages may be shown', () => {
    expect(standingOfGame(yours, 11_250)).toBe(yours);
    expect(standingOfGame(yours, 11_250)?.personalBest).toBe(true);
  });

  it('is nothing when an earlier result is the one that stands, or none is known', () => {
    expect(standingOfGame(yours, 9000)).toBeNull();
    expect(standingOfGame(null, 11_250)).toBeNull();
  });

  it('shows no personal best the server did not call one', () => {
    expect(standingOfGame({ ...yours, personalBest: false }, 11_250)?.personalBest).toBe(false);
  });
});

describe('aboveAverage', () => {
  it("is each round's score less the day's average for that round", () => {
    expect(aboveAverage({ rounds: [4800, 3950, 2500], averages: [3900, 4100, 2500] })).toEqual([900, -150, 0]);
  });

  it('is nothing until the day has averages: fewer than five players have finished, or the viewer is a visitor', () => {
    expect(aboveAverage({ rounds: [4800, 3950, 2500], averages: null })).toBeNull();
  });

  it('is nothing when the averages are not one a round', () => {
    expect(aboveAverage({ rounds: [4800, 3950, 2500], averages: [3900, 4100] })).toBeNull();
  });
});
