import { describe, expect, it } from 'vitest';
import { earnsConfetti, isPerfect, roundXp, starsFor } from './marks.ts';

describe('isPerfect', () => {
  it('is only the full 5,000', () => {
    expect(isPerfect(5000)).toBe(true);
    expect(isPerfect(4999)).toBe(false);
    expect(isPerfect(0)).toBe(false);
  });
});

describe('earnsConfetti', () => {
  it('starts at 4,850', () => {
    expect(earnsConfetti(4849)).toBe(false);
    expect(earnsConfetti(4850)).toBe(true);
    expect(earnsConfetti(5000)).toBe(true);
  });
});

describe('starsFor', () => {
  it('gives one star below half, two from half, three from four fifths', () => {
    expect(starsFor(0, 25_000)).toBe(1);
    expect(starsFor(12_499, 25_000)).toBe(1);
    expect(starsFor(12_500, 25_000)).toBe(2);
    expect(starsFor(19_999, 25_000)).toBe(2);
    expect(starsFor(20_000, 25_000)).toBe(3);
    expect(starsFor(25_000, 25_000)).toBe(3);
  });

  it('goes by the share, whatever the number of rounds', () => {
    expect(starsFor(7500, 15_000)).toBe(2);
    expect(starsFor(40_000, 50_000)).toBe(3);
  });

  it('gives one star to a game with nothing to score', () => {
    expect(starsFor(0, 0)).toBe(1);
  });
});

describe('roundXp', () => {
  it('is the score over 50, rounded', () => {
    expect(roundXp(5000)).toBe(100);
    expect(roundXp(2475)).toBe(50);
    expect(roundXp(2474)).toBe(49);
    expect(roundXp(24)).toBe(0);
    expect(roundXp(0)).toBe(0);
  });
});
