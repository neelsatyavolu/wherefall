import { afterEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../i18n/index.ts';
import { MAX_ROUND_SCORE, WORLD_SCALE_KM, formatDistance, scoreForDistance } from './scoring.ts';

describe('scoreForDistance', () => {
  it('gives the maximum for a perfect guess', () => {
    expect(scoreForDistance(0, WORLD_SCALE_KM)).toBe(MAX_ROUND_SCORE);
  });

  it('scores the world on a scale of 20,000 km', () => {
    expect(WORLD_SCALE_KM).toBe(20_000);
  });

  it('gives the maximum inside 30 metres even on a small map', () => {
    expect(scoreForDistance(0.03, 50)).toBe(MAX_ROUND_SCORE);
    expect(scoreForDistance(0.031, 50)).toBeLessThan(MAX_ROUND_SCORE);
  });

  it('gives the maximum to a score that works out above 4,997', () => {
    // 1 km on the world scale works out at 4,998
    expect(Math.round(5000 * Math.exp(-10 / WORLD_SCALE_KM))).toBe(4998);
    expect(scoreForDistance(1, WORLD_SCALE_KM)).toBe(MAX_ROUND_SCORE);
    // 4,997 itself is left as it is
    expect(scoreForDistance(1.3, WORLD_SCALE_KM)).toBe(4997);
  });

  it('follows the exponential curve', () => {
    // one tenth of the scale away leaves 1/e of the points
    expect(scoreForDistance(WORLD_SCALE_KM / 10, WORLD_SCALE_KM)).toBe(Math.round(5000 / Math.E));
  });

  it('falls to zero on the other side of the world', () => {
    expect(scoreForDistance(20_015, WORLD_SCALE_KM)).toBe(0);
  });

  it('never rises as the guess gets worse', () => {
    let last = MAX_ROUND_SCORE;
    for (let km = 0; km < 20000; km += 250) {
      const score = scoreForDistance(km, WORLD_SCALE_KM);
      expect(score).toBeLessThanOrEqual(last);
      last = score;
    }
  });

  it('is harsher on a smaller map', () => {
    expect(scoreForDistance(500, 3000)).toBeLessThan(scoreForDistance(500, WORLD_SCALE_KM));
  });

  it('rejects impossible input', () => {
    expect(() => scoreForDistance(-1, WORLD_SCALE_KM)).toThrow();
    expect(() => scoreForDistance(10, 0)).toThrow();
  });
});

describe('formatDistance', () => {
  it('uses metres under a kilometre', () => {
    expect(formatDistance(0.3421)).toBe('342 m');
  });

  it('keeps one decimal under 100 km', () => {
    expect(formatDistance(12.44)).toBe('12.4 km');
  });

  it('groups thousands for long distances', () => {
    expect(formatDistance(12044.6)).toBe('12,045 km');
  });
});

describe('formatDistance in miles', () => {
  it('converts kilometres', () => {
    expect(formatDistance(1609.344, 'mi')).toBe('1,000 mi');
    expect(formatDistance(16.09344, 'mi')).toBe('10.0 mi');
  });

  it('uses feet under a mile', () => {
    expect(formatDistance(0.3048, 'mi')).toBe('1,000 ft');
  });

  it('is unchanged in kilometres', () => {
    expect(formatDistance(12.44, 'km')).toBe('12.4 km');
  });
});

describe('formatDistance in another language', () => {
  afterEach(() => useLanguage('en'));

  it('writes the units and the number as Russian does', async () => {
    await useLanguage('ru');
    expect(formatDistance(0.3421)).toBe('342 м');
    expect(formatDistance(12.44)).toBe('12,4 км');
    expect(formatDistance(12044.6).replace(/\s/g, ' ')).toBe('12 045 км');
    expect(formatDistance(16.09344, 'mi')).toBe('10,0 ми');
    expect(formatDistance(0.03048, 'mi')).toBe('100 фт');
  });

  it('keeps km and m in German, with a decimal comma', async () => {
    await useLanguage('de');
    expect(formatDistance(12.44)).toBe('12,4 km');
    expect(formatDistance(0.3421)).toBe('342 m');
  });
});
