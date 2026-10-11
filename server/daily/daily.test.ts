import { describe, expect, it } from 'vitest';
import { savedGameSchema, type SavedGame } from '../account/input.js';
import { DAILY_MAX_SCORE, DAILY_MIN_MS, DAILY_SETTINGS, dailyDate, dailySeed, daysAgo, isTodaysDaily, lastDays, nextDailyAt } from './daily.js';

const NOON = Date.UTC(2026, 9, 11, 12);
// Whether a game is today's daily is asked of its date, seed and settings only: which places it is on is asked elsewhere.
const ROUND = { id: 'a-place', lng: 2.35, lat: 48.85, guessLng: 2.4, guessLat: 48.9 };

const game = (change: Partial<SavedGame> = {}): SavedGame => ({
  map: 'world',
  mode: 'move',
  timeLimit: 60,
  seed: 'daily20261011',
  rounds: [ROUND, ROUND, ROUND],
  daily: '2026-10-11',
  ...change,
});

describe('dailyDate', () => {
  it('is the UTC day, changing at midnight UTC', () => {
    expect(dailyDate(NOON)).toBe('2026-10-11');
    expect(dailyDate(Date.UTC(2026, 9, 11, 23, 59, 59, 999))).toBe('2026-10-11');
    expect(dailyDate(Date.UTC(2026, 9, 12))).toBe('2026-10-12');
  });
});

describe('dailySeed', () => {
  it('is derived from the date, differs from day to day, and is a seed the game accepts', () => {
    expect(dailySeed('2026-10-11')).toBe('daily20261011');
    expect(dailySeed('2026-10-12')).not.toBe(dailySeed('2026-10-11'));
    expect(savedGameSchema.shape.seed.safeParse(dailySeed('2026-10-11')).success).toBe(true);
  });
});

describe('DAILY_SETTINGS', () => {
  it('is the whole world, moving, a minute a round, three rounds, 15,000 at most', () => {
    expect(DAILY_SETTINGS).toEqual({ map: 'world', mode: 'move', timeLimit: 60, rounds: 3 });
    expect(DAILY_MAX_SCORE).toBe(15_000);
  });
});

describe('DAILY_MIN_MS', () => {
  it('is six seconds: two for each of the three rounds', () => {
    expect(DAILY_MIN_MS).toBe(6000);
  });
});

describe('nextDailyAt', () => {
  it('is the coming midnight UTC, a whole day on when it is asked at midnight', () => {
    expect(nextDailyAt(NOON)).toBe(Date.UTC(2026, 9, 12));
    expect(nextDailyAt(Date.UTC(2026, 9, 11, 23, 59, 59, 999))).toBe(Date.UTC(2026, 9, 12));
    expect(nextDailyAt(Date.UTC(2026, 9, 12))).toBe(Date.UTC(2026, 9, 13));
  });
});

describe('lastDays', () => {
  it('is that many days, oldest first, ending today', () => {
    expect(lastDays(NOON, 3)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(lastDays(Date.UTC(2027, 0, 1, 0, 0, 1), 2)).toEqual(['2026-12-31', '2027-01-01']);
    expect(lastDays(NOON, 14)).toHaveLength(14);
  });
});

describe('daysAgo', () => {
  it('counts whole UTC days back from today, whatever the time of day', () => {
    expect(daysAgo('2026-10-11', NOON)).toBe(0);
    expect(daysAgo('2026-10-10', Date.UTC(2026, 9, 11, 0, 0, 1))).toBe(1);
    expect(daysAgo('2026-09-27', Date.UTC(2026, 9, 11, 23, 59))).toBe(14);
    expect(daysAgo('2026-10-12', NOON)).toBe(-1);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', 'yesterday', ''])('is null for %s, which is not a day', (date) => {
    expect(daysAgo(date, NOON)).toBeNull();
  });
});

describe('isTodaysDaily', () => {
  it("accepts today's daily played on its seed and settings", () => {
    expect(isTodaysDaily(game(), NOON)).toBe(true);
  });

  it.each([
    ["yesterday's date", { daily: '2026-10-10', seed: 'daily20261010' }],
    ["tomorrow's date", { daily: '2026-10-12', seed: 'daily20261012' }],
    ['no date', { daily: undefined }],
    ['another seed', { seed: 'abc' }],
    ['another map', { map: 'europe' as const }],
    ['another mode', { mode: 'nmpz' as const }],
    ['no time limit', { timeLimit: 0 }],
    ['the two minutes a round it used to be', { timeLimit: 120 }],
    ['fewer rounds', { rounds: [ROUND, ROUND] }],
    ['the five rounds it used to be', { rounds: [ROUND, ROUND, ROUND, ROUND, ROUND] }],
  ])('refuses %s', (_name, change) => {
    expect(isTodaysDaily(game(change), NOON)).toBe(false);
  });

  it('refuses a game that was today when it started but is posted after midnight UTC', () => {
    expect(isTodaysDaily(game(), Date.UTC(2026, 9, 12, 0, 0, 1))).toBe(false);
  });
});
