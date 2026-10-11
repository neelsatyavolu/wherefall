import { continentOf } from './continents.js';
import type { Place } from './check.js';
import { placesOf } from './lists.js';

// Places for tests, taken from the real lists the way a browser would send them.

const sent = ({ id, lng, lat, country }: Place): Place => ({ id, lng, lat, country });

/** `count` places of one list, moving from continent to continent, so any three of them in a row are on three. */
export function spreadPlaces(count: number, list = 0): Place[] {
  const byContinent = new Map<string, Place[]>();
  for (const place of placesOf(list)) {
    const continent = continentOf(place);
    if (continent !== null) {
      byContinent.set(continent, [...(byContinent.get(continent) ?? []), place]);
    }
  }
  const continents = [...byContinent.values()];
  return Array.from({ length: count }, (_unused, index) => sent(continents[index % continents.length]?.[Math.floor(index / continents.length)] as Place));
}

/** `count` places of one list that are all in one country. */
export function placesIn(country: string, count: number, list = 0): Place[] {
  return placesOf(list)
    .filter((place) => place.country === country)
    .slice(0, count)
    .map(sent);
}
