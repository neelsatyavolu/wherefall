import { describe, expect, it } from 'vitest';
import { countAt } from './count-up.ts';

describe('countAt', () => {
  it('starts at nothing and ends on the number', () => {
    expect(countAt(18_450, 0)).toBe(0);
    expect(countAt(18_450, 1)).toBe(18_450);
  });

  it('only ever climbs, fast first and slowing to the end', () => {
    const steps = Array.from({ length: 11 }, (_, i) => countAt(10_000, i / 10));
    steps.slice(1).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(steps[index]!));
    expect(steps[5]).toBeGreaterThan(5000);
  });

  it('is always a whole number and never past the end', () => {
    expect(Number.isInteger(countAt(777, 0.333))).toBe(true);
    expect(countAt(777, 1.4)).toBe(777);
    expect(countAt(777, -1)).toBe(0);
  });
});
