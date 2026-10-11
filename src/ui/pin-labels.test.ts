import { describe, expect, it } from 'vitest';
import { boxAround, namesThatFit } from './pin-labels.ts';

const at = (x: number, y: number, width = 40, height = 22) => boxAround({ x, y }, { width, height });

describe('boxAround', () => {
  it('is the box of a pin of a size, centred on its point', () => {
    expect(boxAround({ x: 100, y: 50 }, { width: 40, height: 22 })).toEqual({ left: 80, top: 39, right: 120, bottom: 61 });
  });
});

describe('namesThatFit', () => {
  it('keeps every name when no pin lies on another', () => {
    expect(namesThatFit([], [at(100, 100), at(200, 100), at(100, 200)])).toEqual([true, true, true]);
  });

  it('leaves the name off a pin that would lie on one already named, first come first kept', () => {
    expect(namesThatFit([], [at(100, 100), at(120, 105), at(300, 100)])).toEqual([true, false, true]);
  });

  it('leaves the name off a pin that would lie on the place or on the player’s own pin, which are always there', () => {
    const place = at(100, 100, 16, 16);
    const own = at(200, 100);
    expect(namesThatFit([place, own], [at(110, 100), at(210, 110), at(400, 100)])).toEqual([false, false, true]);
  });

  it('counts a pin left bare as taking no room, so the next one may have its name', () => {
    // the second lies on the first and goes bare; the third lies on where the second's name would have been, and keeps its own
    expect(namesThatFit([], [at(100, 100), at(130, 100), at(165, 100)])).toEqual([true, false, true]);
  });

  it('wants a little air between two names: touching is too close', () => {
    expect(namesThatFit([], [at(100, 100), at(140, 100)])).toEqual([true, false]);
    expect(namesThatFit([], [at(100, 100), at(144, 100)])).toEqual([true, true]);
  });

  it('names all of twenty pins spread out, and one of twenty on one spot', () => {
    const spread = Array.from({ length: 20 }, (_, index) => at(60 * index, 100));
    expect(namesThatFit([], spread).every(Boolean)).toBe(true);
    const heap = Array.from({ length: 20 }, () => at(100, 100));
    expect(namesThatFit([], heap).filter(Boolean)).toHaveLength(1);
  });
});
