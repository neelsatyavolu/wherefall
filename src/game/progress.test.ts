import { describe, expect, it } from 'vitest';
import { levelForXp, levelProgress, xpForLevel } from './progress.ts';

describe('levels', () => {
  it('is floor(sqrt(xp / 250)) + 1', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(249)).toBe(1);
    expect(levelForXp(250)).toBe(2);
    expect(levelForXp(999)).toBe(2);
    expect(levelForXp(1000)).toBe(3);
    expect(levelForXp(25_000)).toBe(11);
  });

  it('knows the XP a level starts at', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(250);
    expect(xpForLevel(3)).toBe(1000);
    for (const level of [1, 2, 5, 12, 40]) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
      expect(levelForXp(xpForLevel(level + 1) - 1)).toBe(level);
    }
  });
});

describe('levelProgress', () => {
  it('says how far into the level the player is', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, span: 250, toNext: 250, fraction: 0 });
    expect(levelProgress(625)).toEqual({ level: 2, into: 375, span: 750, toNext: 375, fraction: 0.5 });
    expect(levelProgress(999).toNext).toBe(1);
  });

  it('treats anything that is not a positive amount as none', () => {
    expect(levelProgress(-5).level).toBe(1);
    expect(levelProgress(Number.NaN).fraction).toBe(0);
  });
});
