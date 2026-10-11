import { describe, expect, it } from 'vitest';
import { MIN_RATING, START_RATING, expectedScore, kFor, rate, repeatFactor } from './elo.js';

const fresh = (rating: number) => ({ rating, games: 0 });

describe('expectedScore', () => {
  it('is even between equals and favours the higher rating, on a 340 scale', () => {
    expect(expectedScore(500, 500)).toBe(0.5);
    expect(expectedScore(840, 500)).toBeCloseTo(10 / 11, 10);
    expect(expectedScore(500, 840) + expectedScore(840, 500)).toBeCloseTo(1, 10);
  });
});

describe('kFor', () => {
  it.each([
    [0, 500, 40],
    [29, 500, 40],
    [30, 500, 20],
    [99, 500, 20],
    [100, 500, 10],
    [0, 899, 40],
    [0, 900, 20],
    [0, 999, 20],
    [0, 1000, 10],
    [50, 950, 20],
    [50, 1200, 10],
    [200, 950, 10],
  ])('after %i rated games at %i it is %i', (games, rating, k) => {
    expect(kFor({ rating, games })).toBe(k);
  });
});

describe('rate', () => {
  it('starts new accounts at 500 and lets nobody fall below 100', () => {
    expect([START_RATING, MIN_RATING]).toEqual([500, 100]);
    expect(rate(fresh(MIN_RATING), fresh(MIN_RATING), 0)).toEqual([MIN_RATING, MIN_RATING + 20]);
  });

  it('moves two new, equal players 20 points each way', () => {
    expect(rate(fresh(500), fresh(500), 1)).toEqual([520, 480]);
    expect(rate(fresh(500), fresh(500), 0)).toEqual([480, 520]);
  });

  it('leaves equal players where they were after a draw, and moves unequal ones towards each other', () => {
    expect(rate(fresh(500), fresh(500), 0.5)).toEqual([500, 500]);
    expect(rate(fresh(670), fresh(500), 0.5)).toEqual([660, 510]);
  });

  it('moves each player by their own K', () => {
    // A regular (K 10) beats a newcomer (K 40): the regular gains little, the newcomer loses a lot.
    expect(rate({ rating: 500, games: 150 }, fresh(500), 1)).toEqual([505, 480]);
    // Near the top the winner's K is capped at 10, whatever their games.
    expect(rate(fresh(1000), fresh(1000), 1)).toEqual([1005, 995]);
    expect(rate(fresh(900), fresh(900), 0)).toEqual([890, 910]);
  });

  it('moves a win and a loss by at least 1 between players less than 400 apart', () => {
    // 890 against 500 expects to win all but a sliver, and at K 10 rounding alone would give 0.
    expect(rate({ rating: 890, games: 200 }, { rating: 500, games: 200 }, 1)).toEqual([891, 499]);
    expect(rate({ rating: 899, games: 200 }, { rating: 500, games: 200 }, 1)).toEqual([900, 499]);
  });

  it('moves nothing for a win that rounds to nothing once the winner was 400 or more above the loser', () => {
    // Beating someone that far below proves nothing, and paying 1 a time is how a rating is farmed.
    expect(rate({ rating: 1800, games: 200 }, fresh(500), 1)).toEqual([1800, 500]);
    expect(rate({ rating: 1800, games: 200 }, { rating: 1400, games: 200 }, 1)).toEqual([1801, 1399]);
    expect(rate({ rating: 2600, games: 200 }, { rating: 1400, games: 200 }, 1)).toEqual([2600, 1400]);
    expect(rate(fresh(500), { rating: 1800, games: 200 }, 0)).toEqual([500, 1800]);
    // The upset still counts in full.
    expect(rate({ rating: 1800, games: 200 }, fresh(500), 0)).toEqual([1790, 540]);
    // And a favourite whose win still rounds to something is paid it.
    expect(rate(fresh(900), fresh(500), 1)[0]).toBeGreaterThan(900);
  });

  it('pays the first three wins over the same opponent in a day in full, then three quarters, a half, a quarter, and nothing', () => {
    const gains = [1, 2, 3, 4, 5, 6, 7, 8].map((nth) => rate(fresh(500), fresh(500), 1, nth)[0] - 500);
    expect(gains).toEqual([20, 20, 20, 15, 10, 5, 0, 0]);
  });

  it('trims the loser\u2019s loss by the same factor, whichever of the two won', () => {
    const losses = [1, 2, 3, 4, 5, 6, 7, 8].map((nth) => rate(fresh(500), fresh(500), 1, nth)[1] - 500);
    expect(losses).toEqual([-20, -20, -20, -15, -10, -5, 0, 0]);
    expect(rate(fresh(500), fresh(500), 0, 5)).toEqual([490, 510]);
    expect(rate(fresh(500), fresh(500), 0, 7)).toEqual([500, 500]);
  });

  it('keeps the least change of 1 while a repeat win pays at all, and drops it when it pays nothing', () => {
    const [regular, other] = [{ rating: 890, games: 200 }, { rating: 500, games: 200 }];
    expect([4, 5, 6].map((nth) => rate(regular, other, 1, nth))).toEqual([[891, 499], [891, 499], [891, 499]]);
    expect(rate(regular, other, 1, 7)).toEqual([890, 500]);
  });

  it('does not trim a draw', () => {
    expect(rate(fresh(600), fresh(500), 0.5, 7)).toEqual(rate(fresh(600), fresh(500), 0.5, 1));
  });
});

describe('repeatFactor', () => {
  it('is 1 for the first three wins, then 0.75, 0.5, 0.25, and 0 from the seventh', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(repeatFactor)).toEqual([1, 1, 1, 0.75, 0.5, 0.25, 0, 0]);
  });
});
