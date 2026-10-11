import type { Location } from '../game/locations.ts';
import type { MapRow } from './maps.ts';

/** How many of a map's places its page shows in Street View. Each one is a panorama out of Google's daily allowance. */
export const PREVIEW_PLACES = 5;

/**
 * The places a map is previewed by: five spread evenly through its list, starting with the first,
 * or all of them when it has no more than that. Always the same five for the same map, so looking
 * again does not give away another five of the places a game on it would ask about.
 */
export function previewPlaces(rows: readonly MapRow[], count = PREVIEW_PLACES): Location[] {
  const shown = Math.min(count, rows.length);
  return Array.from({ length: shown }, (_, i) => rows[Math.floor((i * rows.length) / shown)]!).map(([id, lng, lat, country]) => ({ id, lng, lat, country }));
}

/** The place shown after stepping on (`by` 1) or back (`by` -1) from one of `total`, going round at the ends. */
export function stepped(index: number, by: number, total: number): number {
  return total > 0 ? (((index + by) % total) + total) % total : 0;
}
