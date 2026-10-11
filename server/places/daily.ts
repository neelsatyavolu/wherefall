import { continentsOf } from './continents.js';
import type { Place } from './check.js';
import { LIST_FILES, placesOf } from './lists.js';
import { createRng, firstInOrder } from './rng.js';

/**
 * Which places a daily's seed draws. The browser draws the three itself:
 * it shuffles its list with the seed and takes the first that fit the rule,
 * passing over any whose picture has gone. The server cannot know which
 * pictures were gone, so it holds a daily to this: its places are among the
 * first hundred the seed puts their list in, and keep the rule.
 */
export const DAILY_WINDOW = 100;
export const DAILY_COUNTRIES = 3;
export const DAILY_CONTINENTS = 2;

/** The window of the seed last asked about, per list: every player of a day asks about the same one. */
const windows = new Map<number, { seed: string; ids: ReadonlySet<string> }>();

function windowOf(list: number, seed: string): ReadonlySet<string> {
  const held = windows.get(list);
  if (held?.seed === seed) {
    return held.ids;
  }
  const ids = new Set(firstInOrder(placesOf(list), DAILY_WINDOW, createRng(seed)).map((place) => place.id));
  windows.set(list, { seed, ids });
  return ids;
}

/**
 * True when `places` (already known to be from the one list `list`) could be
 * the daily of `seed`: all early in the seed's order, in different
 * countries, on at least two continents.
 */
export function isDailyDraw(places: readonly Place[], list: number, seed: string): boolean {
  if (list < 0 || list >= LIST_FILES.length || places.length !== DAILY_COUNTRIES) {
    return false;
  }
  const window = windowOf(list, seed);
  const countries = new Set(places.map((place) => place.country));
  return places.every((place) => window.has(place.id)) && countries.size === DAILY_COUNTRIES && continentsOf(places) >= DAILY_CONTINENTS;
}
