import { describe, expect, it } from 'vitest';
import { STREAK_XP, leagueFor, levelFor, xpForScores, xpForStreak } from './progress.js';

describe('xpForScores', () => {
  it('is a fiftieth of each round, rounded, so a perfect round is worth 100', () => {
    expect(xpForScores([5000])).toBe(100);
    expect(xpForScores([0])).toBe(0);
    expect(xpForScores([24])).toBe(0);
    expect(xpForScores([25])).toBe(1);
    expect(xpForScores([4974])).toBe(99);
    expect(xpForScores([4975])).toBe(100);
  });

  it('rounds each round on its own before adding them up', () => {
    expect(xpForScores([25, 25, 25])).toBe(3);
    expect(xpForScores([5000, 2500, 1234, 0, 20])).toBe(100 + 50 + 25 + 0 + 0);
    expect(xpForScores([])).toBe(0);
  });
});

describe('xpForStreak', () => {
  it('is 20 for each country got right', () => {
    expect(STREAK_XP).toBe(20);
    expect(xpForStreak(0)).toBe(0);
    expect(xpForStreak(7)).toBe(140);
  });
});

describe('levelFor', () => {
  it.each([
    [0, 1],
    [249, 1],
    [250, 2],
    [999, 2],
    [1000, 3],
    [2249, 3],
    [2250, 4],
    [25_000, 11],
  ])('puts %i xp at level %i', (xp, level) => {
    expect(levelFor(xp)).toBe(level);
  });
});

describe('leagueFor', () => {
  it.each([
    [100, 'Trekker'],
    [500, 'Trekker'],
    [799, 'Trekker'],
    [800, 'Explorer'],
    [999, 'Explorer'],
    [1000, 'Voyager'],
    [1299, 'Voyager'],
    [1300, 'Nomad'],
    [1799, 'Nomad'],
    [1800, 'Legend'],
    [2600, 'Legend'],
  ])('puts a rating of %i in %s', (rating, league) => {
    expect(leagueFor(rating)).toBe(league);
  });
});
