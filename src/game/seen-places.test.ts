import { describe, expect, it } from 'vitest';
import { pickRounds, type Location } from './locations.ts';
import { SEEN_LIMIT, countSeen, freshestSeed, remember, unseenFirst } from './seen-places.ts';

const places = (count: number): Location[] => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, lng: i, lat: 0, country: 'FR' }));

describe('remember', () => {
  it('adds places as the newest, without changing the list it was given', () => {
    const before = ['a', 'b'];
    expect(remember(before, ['c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(before).toEqual(['a', 'b']);
  });

  it('moves a place shown again to the newest end instead of listing it twice', () => {
    expect(remember(['a', 'b', 'c'], ['a'])).toEqual(['b', 'c', 'a']);
    expect(remember(['a'], ['b', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps the last 5,000 and drops the oldest', () => {
    expect(SEEN_LIMIT).toBe(5000);
    const full = Array.from({ length: SEEN_LIMIT }, (_, i) => `old${i}`);
    const after = remember(full, ['new1', 'new2']);
    expect(after).toHaveLength(SEEN_LIMIT);
    expect(after.slice(0, 1)).toEqual(['old2']);
    expect(after.slice(-2)).toEqual(['new1', 'new2']);
  });

  it('works to any limit', () => {
    expect(remember(['a', 'b', 'c'], ['d'], 2)).toEqual(['c', 'd']);
  });
});

describe('countSeen', () => {
  it('counts the places shown before', () => {
    expect(countSeen(places(4), new Set(['p1', 'p3', 'other']))).toBe(2);
  });
});

describe('unseenFirst', () => {
  it('puts unseen places ahead of seen ones and keeps each group in order', () => {
    const order = unseenFirst(places(5), new Set(['p0', 'p2']));
    expect(order.map((place) => place.id)).toEqual(['p1', 'p3', 'p4', 'p0', 'p2']);
  });

  it('still returns every place when all have been seen, so a game can always be filled', () => {
    const all = places(3);
    expect(unseenFirst(all, new Set(all.map((place) => place.id)))).toEqual(all);
  });
});

describe('freshestSeed', () => {
  const list = places(12);
  const draw = (seed: string) => pickRounds(list, seed, 3);
  const seeds = Array.from({ length: 40 }, (_, i) => `seed${i}`);

  it('takes the first seed when nothing has been seen', () => {
    expect(freshestSeed(seeds, draw, new Set())).toBe('seed0');
  });

  it('takes a seed whose game shows nothing seen before, when there is one', () => {
    const seen = new Set(draw('seed0').map((place) => place.id));
    const chosen = freshestSeed(seeds, draw, seen);
    expect(countSeen(draw(chosen), seen)).toBe(0);
  });

  it('takes the seed with the fewest seen places when none is clear of them', () => {
    const seen = new Set(list.slice(0, 11).map((place) => place.id));
    const chosen = freshestSeed(seeds, draw, seen);
    const fewest = Math.min(...seeds.map((seed) => countSeen(draw(seed), seen)));
    expect(countSeen(draw(chosen), seen)).toBe(fewest);
  });

  it('fills a game with seen places when every place has been seen', () => {
    const seen = new Set(list.map((place) => place.id));
    expect(draw(freshestSeed(seeds, draw, seen))).toHaveLength(3);
  });

  it('a seed gives the same places whatever has been seen: a challenge link is not changed by it', () => {
    const first = draw('link0001');
    const seen = new Set(remember([], first.map((place) => place.id)));
    expect(countSeen(first, seen)).toBe(3);
    expect(draw('link0001')).toEqual(first);
  });

  it('refuses an empty list of seeds', () => {
    expect(() => freshestSeed([], draw, new Set())).toThrow();
  });
});
