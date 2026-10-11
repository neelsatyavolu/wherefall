import { continentOf } from './continents.ts';
import type { Location } from './locations.ts';

/**
 * The spread of an online world game: a public, ranked or 2v2 game of three rounds or more is
 * played on at least three of the six continents, and the server refuses places that are not. The
 * draw stays the seed's own wherever it can: a place is passed over only when taking it would leave
 * too few rounds for the continents still missing.
 */

export const SPREAD_CONTINENTS = 3;
/** A game shorter than this cannot be on three continents, and is not asked to be. */
export const SPREAD_MIN_ROUNDS = 3;

/** How many of the six continents the places are on; a place on none of them (Antarctica) adds nothing. */
export const continentCount = (places: readonly Location[]): number => new Set(places.map(continentOf).filter((continent) => continent !== null)).size;

/** True when the places are on enough continents for an online world game. */
export const isSpread = (places: readonly Location[]): boolean => continentCount(places) >= SPREAD_CONTINENTS;

/**
 * The places of a game, from `ordered`: every place on the map in the order the game's seed gives
 * them. `gone` are places whose pictures no longer exist: they are passed over, and the draw is
 * made again without them, so it ends on three continents whichever places had to stand in.
 *
 * A list too poor for the rule still gives a game: on as many continents as it has, then any other
 * place. With fewer places than rounds, the places there are.
 */
export function drawSpread(ordered: readonly Location[], rounds: number, gone: ReadonlySet<string> = new Set()): Location[] {
  const pool = ordered.filter((place) => !gone.has(place.id));
  const wanted = Math.min(SPREAD_CONTINENTS, rounds);
  // a place is taken while the rounds left after it can still bring the continents that are missing
  const fits = (picked: readonly Location[], next: Location) => continentCount([...picked, next]) + (rounds - picked.length - 1) >= wanted;
  const spread = pool.reduce<readonly Location[]>((picked, place) => (picked.length < rounds && fits(picked, place) ? [...picked, place] : picked), []);
  const others = pool.filter((place) => !spread.includes(place));
  return [...spread, ...others.slice(0, rounds - spread.length)];
}
