import { continentOf } from '../game/continents.ts';
import type { Location } from '../game/locations.ts';
import { createRng, pickDistinct } from '../game/rng.ts';

/**
 * The daily's three places: three different countries on at least two continents. The server sends
 * only the day's seed; which places it means is this browser's rule, and the same for every browser
 * that plays from the same list.
 */

export const DAILY_ROUNDS = 3;
export const DAILY_CONTINENTS = 2;
/**
 * The server takes a daily only when its three places are among the first hundred the day's seed
 * puts their list in. The draw, its redraws around lost pictures and its spares all stay inside
 * that hundred, so a daily that can be played is one that can be saved.
 */
export const DAILY_WINDOW = 100;

type Rule = (picked: readonly Location[], next: Location) => boolean;

const newCountry: Rule = (picked, next) => picked.every((place) => place.country !== next.country);

/** How many of the six continents the places are on; a place on none of them (Antarctica) adds nothing. */
const continents = (places: readonly Location[]): number => new Set(places.map(continentOf).filter((continent) => continent !== null)).size;

/** The last place has to leave the three on two continents; the ones before it are free. */
const spread: Rule = (picked, next) => picked.length < DAILY_ROUNDS - 1 || continents([...picked, next]) >= DAILY_CONTINENTS;

const strict: Rule = (picked, next) => newCountry(picked, next) && spread(picked, next);

/** The first hundred places in the order the seed gives them, without the ones whose pictures are gone. */
const ordered = (locations: readonly Location[], seed: string, gone: ReadonlySet<string>): Location[] =>
  pickDistinct(locations, locations.length, createRng(seed))
    .slice(0, DAILY_WINDOW)
    .filter((place) => !gone.has(place.id));

/** Walks the places in order and takes each one the rule allows, until there are three. */
const fill = (picked: readonly Location[], pool: readonly Location[], rule: Rule): readonly Location[] =>
  pool.reduce((chosen, place) => (chosen.length < DAILY_ROUNDS && !chosen.includes(place) && rule(chosen, place) ? [...chosen, place] : chosen), picked);

/**
 * The day's three places, in the order they are played. `gone` are places whose pictures no longer
 * exist: they are passed over and the draw is made again without them.
 *
 * A list too poor for the rule still gives a game: with one continent only, three countries; with
 * fewer than three countries, each country once and then any other place; with fewer than three
 * places, the places there are.
 */
export function drawDaily(locations: readonly Location[], seed: string, gone: ReadonlySet<string> = new Set()): Location[] {
  const pool = ordered(locations, seed, gone);
  return [...[strict, newCountry, () => true].reduce((picked, rule) => fill(picked, pool, rule), [] as readonly Location[])];
}

/** `drawn` with the place at `index` swapped for another. */
const swapped = (drawn: readonly Location[], index: number, spare: Location): Location[] => drawn.map((place, i) => (i === index ? spare : place));

/**
 * The places that can stand in for one of the three when its picture will not load during the game,
 * in the seed's order: each keeps three countries on two continents whichever round it replaces.
 */
export function dailySpares(locations: readonly Location[], seed: string, drawn: readonly Location[], gone: ReadonlySet<string> = new Set()): Location[] {
  const fits = (spare: Location) => newCountry(drawn, spare) && drawn.every((_, index) => continents(swapped(drawn, index, spare)) >= DAILY_CONTINENTS);
  return ordered(locations, seed, gone).filter((place) => !drawn.includes(place) && fits(place));
}
