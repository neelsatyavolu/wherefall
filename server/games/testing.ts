import { dailySeed } from '../daily/daily.js';
import { continentOf, continentsOf } from '../places/continents.js';
import { DAILY_CONTINENTS, DAILY_COUNTRIES, DAILY_WINDOW } from '../places/daily.js';
import { isOnMap, placesOf, type KnownPlace } from '../places/lists.js';
import { createRng, firstInOrder } from '../places/rng.js';

/**
 * What tests build games, dailies and runs with. The server takes a place
 * only when it is one of its own, so every round here is on a real place of
 * the lists, named by its id and put where its list has it.
 */

// The game's own numbers, written out again here so that a test's rounds do
// not depend on the code that scores them.
const WORLD_SCALE_KM = 20_000;
const KM_PER_DEGREE = (6371.0088 * Math.PI) / 180;
const FULL_SCORE = 5000;
const DECAY = 10;

/** The first `count` places of one list that are on a map. */
export const placesOn = (map: string, count: number, list = 0): KnownPlace[] =>
  placesOf(list)
    .filter((place) => isOnMap(place, map))
    .slice(0, count);

/** Where a guess lands that is `km` due north of a place, carrying on over the pole and down the far side when the north runs out. */
function guessFrom(place: { lng: number; lat: number }, km: number): { guessLng: number; guessLat: number } {
  const lat = place.lat + km / KM_PER_DEGREE;
  if (lat <= 90) {
    return { guessLng: place.lng, guessLat: lat };
  }
  return { guessLng: place.lng > 0 ? place.lng - 180 : place.lng + 180, guessLat: 180 - lat };
}

/**
 * A round on `place` as the browser sends it, which the server will score at
 * exactly `score` on a map scored to `scaleKm`. A score of 0 is a round with
 * no guess. Scores of 4998 and 4999 do not exist: the game gives those as 5000.
 */
export function roundOn(place: KnownPlace, score: number, scaleKm = WORLD_SCALE_KM, change: Record<string, unknown> = {}): Record<string, unknown> {
  const sent = { id: place.id, lng: place.lng, lat: place.lat };
  if (score === 0) {
    return { ...sent, guessLng: null, guessLat: null, ...change };
  }
  const km = (-scaleKm / DECAY) * Math.log(score / FULL_SCORE);
  return { ...sent, ...guessFrom(place, km), ...change };
}

/** The first `count` places of a list in the order a day's seed puts them. */
export const dailyOrder = (date: string, count: number, list = 0): KnownPlace[] => firstInOrder(placesOf(list), count, createRng(dailySeed(date)));

/** The first three of some places that are in different countries, the three on at least two continents: the daily's rule. */
export function drawnFrom(order: readonly KnownPlace[]): KnownPlace[] {
  const fits = (picked: readonly KnownPlace[], next: KnownPlace): boolean =>
    picked.every((place) => place.country !== next.country) && (picked.length < DAILY_COUNTRIES - 1 || continentsOf([...picked, next]) >= DAILY_CONTINENTS);
  return order.reduce<KnownPlace[]>((picked, place) => (picked.length < DAILY_COUNTRIES && fits(picked, place) ? [...picked, place] : picked), []);
}

/** The three places a day's seed draws, as the browser picks them. */
export const dailyPlaces = (date: string, list = 0): KnownPlace[] => drawnFrom(dailyOrder(date, DAILY_WINDOW, list));

/** The three rounds of a day's daily, scoring what is asked. */
export const dailyRounds = (date: string, scores: readonly number[], list = 0): Array<Record<string, unknown>> =>
  dailyPlaces(date, list).map((place, index) => roundOn(place, scores[index] ?? 0));

/** A country no place is in: the wrong answer to any round. */
const NOWHERE = 'ZZ';

/**
 * The rounds of a country streak that got `right` countries and then one
 * wrong, which is how every streak ends.
 */
export const streakRounds = (right: number): Array<{ id: string; answer: string | null }> =>
  placesOf(0)
    .slice(0, right + 1)
    .map((place, index) => ({ id: place.id, answer: index < right ? place.country : NOWHERE }));

/** The first `count` places that are on one of the six continents, which is what a guesser can ask about. */
const askable = (count: number): KnownPlace[] =>
  placesOf(0)
    .filter((place) => continentOf(place) !== null)
    .slice(0, count);

/** Ten rounds of Country Guesser or Continent Guesser with the first `right` answered rightly and the rest not at all. */
export const guesserRounds = (kind: 'country' | 'continent', right: number, rounds = 10): Array<{ id: string; answer: string | null }> =>
  askable(rounds).map((place, index) => ({ id: place.id, answer: index < right ? (kind === 'country' ? place.country : continentOf(place)) : null }));
