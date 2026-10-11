import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, ROUND_COUNTS, isTimeLimit, nearestTimeLimit, parseChallenge, toSearch } from './settings.ts';

describe('parseChallenge', () => {
  it('returns null when the link carries no seed', () => {
    expect(parseChallenge('')).toBeNull();
    expect(parseChallenge('?map=europe')).toBeNull();
  });

  it('reads a full challenge link', () => {
    expect(parseChallenge('?map=europe&seed=ab12cd34&t=60&mode=nmpz&n=10')).toEqual({
      map: 'europe',
      seed: 'ab12cd34',
      timeLimit: 60,
      mode: 'nmpz',
      rounds: 10,
    });
  });

  it('falls back to defaults for anything it does not recognise', () => {
    expect(parseChallenge('?seed=ab12cd34&map=mars&t=7&mode=fly&n=4')).toEqual({
      ...DEFAULT_OPTIONS,
      seed: 'ab12cd34',
    });
  });

  it('ignores a seed with unsafe characters', () => {
    expect(parseChallenge('?seed=<script>')).toBeNull();
  });
});

describe('toSearch', () => {
  it('round-trips through parseChallenge', () => {
    const settings = { map: 'americas', seed: 'zz99yy88', timeLimit: 120, mode: 'no-move', rounds: 3 } as const;
    expect(parseChallenge(toSearch(settings))).toEqual(settings);
  });
});

describe('country maps in a challenge link', () => {
  it('reads a country map and writes it back', () => {
    const challenge = parseChallenge('?map=country%3AFR&seed=ab12cd34&t=0&mode=move&n=5');
    expect(challenge?.map).toBe('country:FR');
    expect(parseChallenge(toSearch(challenge!))).toEqual(challenge);
  });

  it('reads the africa map', () => {
    expect(parseChallenge('?map=africa&seed=ab12cd34')?.map).toBe('africa');
  });

  it('falls back to the world for a map that is not one', () => {
    expect(parseChallenge('?map=country:france&seed=ab12cd34')?.map).toBe(DEFAULT_OPTIONS.map);
  });
});

describe('the time for a round', () => {
  it('is off, or 10 to 300 seconds in steps of 10', () => {
    expect([0, 10, 90, 150, 300].every(isTimeLimit)).toBe(true);
    expect([5, 15, 310, -10, 12.5, Number.NaN].some(isTimeLimit)).toBe(false);
  });

  it('reads every such time from a link, and the three older choices still open', () => {
    for (const seconds of [0, 10, 30, 60, 90, 120, 250, 300]) {
      expect(parseChallenge(`?seed=ab12cd34&t=${seconds}`)?.timeLimit).toBe(seconds);
    }
  });

  it('falls back to no limit for a time that is not one', () => {
    for (const value of ['5', '45', '310', '1e2', '-30', '60.5', ' 60', '']) {
      expect(parseChallenge(`?seed=ab12cd34&t=${encodeURIComponent(value)}`)?.timeLimit).toBe(0);
    }
  });

  it('round-trips a new time through a link', () => {
    const settings = { map: 'world', seed: 'zz99yy88', timeLimit: 170, mode: 'move', rounds: 5 } as const;
    expect(toSearch(settings)).toContain('t=170');
    expect(parseChallenge(toSearch(settings))).toEqual(settings);
  });

  it('snaps any number of seconds to the nearest allowed time', () => {
    expect(nearestTimeLimit(0)).toBe(0);
    expect(nearestTimeLimit(4)).toBe(0);
    expect(nearestTimeLimit(5)).toBe(10);
    expect(nearestTimeLimit(64)).toBe(60);
    expect(nearestTimeLimit(999)).toBe(300);
    expect(nearestTimeLimit(-20)).toBe(0);
    expect(nearestTimeLimit(Number.NaN)).toBe(0);
  });
});

describe('the number of rounds', () => {
  it('stays 3, 5 or 10, with 5 the default', () => {
    expect(ROUND_COUNTS).toEqual([3, 5, 10]);
    expect(DEFAULT_OPTIONS.rounds).toBe(5);
    expect(parseChallenge('?seed=ab12cd34&n=7')?.rounds).toBe(5);
  });
});
