import { describe, expect, it } from 'vitest';
import { createRng, pickDistinct, randomSeed } from './rng.ts';

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng('paris');
    const b = createRng('paris');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng('paris')()).not.toBe(createRng('tokyo')());
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('pickDistinct', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('returns the requested number of distinct items', () => {
    const picked = pickDistinct(items, 5, createRng('s'));
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
  });

  it('is deterministic for a seed and leaves the input alone', () => {
    const before = [...items];
    expect(pickDistinct(items, 5, createRng('s'))).toEqual(pickDistinct(items, 5, createRng('s')));
    expect(items).toEqual(before);
  });

  it('refuses to pick more than it has', () => {
    expect(() => pickDistinct([1, 2], 3, createRng('s'))).toThrow(/only 2/);
  });
});

describe('randomSeed', () => {
  it('is eight lowercase base-36 characters', () => {
    expect(randomSeed()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('varies between calls', () => {
    expect(randomSeed()).not.toBe(randomSeed());
  });
});
