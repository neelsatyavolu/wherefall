import type { LngLat } from '../game/geo.ts';

/**
 * Loads the borders (a large file, so only when a country streak starts) and returns a function
 * that names the country or territory a point is in. Territory level is how the country codes in
 * the lists of places were made, so a guess is judged by the same borders as the answer.
 */
export async function loadCountryFinder(): Promise<(point: LngLat) => string | null> {
  const { iso1A2Code } = await import('@rapideditor/country-coder');
  return (point) => iso1A2Code([point.lng, point.lat], { level: 'territory' });
}
