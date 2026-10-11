import { CONTINENTS, continentOf, continentOfCountry, countriesOf } from './continents.ts';
import { pickRounds, type Location } from './locations.ts';
import { createRng, pickDistinct, type Rng } from './rng.ts';
import { unseenFirst } from './seen-places.ts';

/**
 * The Country Guesser and the Continent Guesser: ten places, six buttons a round, one answer each.
 * The rules only; the screen is `ui/guesser-play.ts`.
 */

export const GUESSER_KINDS = ['country', 'continent'] as const;
export type GuesserKind = (typeof GUESSER_KINDS)[number];

export const GUESSER_ROUNDS = 10;
export const POINTS_PER_ANSWER = 1000;
export const GUESSER_MAX_SCORE = GUESSER_ROUNDS * POINTS_PER_ANSWER;
export const OPTION_COUNT = 6;

/** What is right for a place: its country's code, or its continent. Null when the place has none, and so cannot be played. */
export function answerOf(kind: GuesserKind, place: Location): string | null {
  return kind === 'country' ? place.country : continentOf(place);
}

/** The first place of each country in the order given, then all the others: a game then moves from country to country. */
function countryByCountry(places: readonly Location[]): Location[] {
  const met = new Set<string>();
  const first: Location[] = [];
  const later: Location[] = [];
  for (const place of places) {
    (met.has(place.country) ? later : first).push(place);
    met.add(place.country);
  }
  return [...first, ...later];
}

/**
 * Every place a run can use, in the order the seed gives: the first ten are the game, and the rest
 * stand in for one whose picture is gone. Places this browser has not shown come first, and ten
 * different countries when the list has them.
 */
export function drawRun(kind: GuesserKind, locations: readonly Location[], seed: string, seen: ReadonlySet<string>): Location[] {
  const usable = locations.filter((place) => answerOf(kind, place) !== null);
  return countryByCountry(unseenFirst(pickRounds(usable, seed, usable.length), seen));
}

/** The countries a list has places in, each once. */
export const listedCountries = (locations: readonly Location[]): string[] => [...new Set(locations.map((place) => place.country))];

const shuffled = <T>(items: readonly T[], rng: Rng): T[] => pickDistinct(items, items.length, rng);

/**
 * The five wrong countries beside the right one. Plausible ones come first: countries of the same
 * continent that the list has places in, then the rest of that continent, then countries of the
 * list from elsewhere, then any country at all.
 */
function wrongCountries(answer: string, listed: readonly string[], rng: Rng): string[] {
  const continent = continentOfCountry(answer);
  const nearby = continent ? countriesOf(continent) : [];
  const everywhere = CONTINENTS.flatMap(countriesOf);
  const tiers = [listed.filter((code) => nearby.includes(code)), nearby, listed, everywhere];
  const ordered = [...new Set(tiers.flatMap((tier) => shuffled(tier, rng)))].filter((code) => code !== answer);
  return ordered.slice(0, OPTION_COUNT - 1);
}

/**
 * The six buttons of a round. For a country: the right one and five wrong ones, in an order the
 * seed and the round decide. For a continent: the six continents, always in the same order.
 * `listed` is the countries the list of places in use has.
 */
export function optionsFor(kind: GuesserKind, place: Location, listed: readonly string[], seed: string, round: number): string[] {
  if (kind === 'continent') {
    return [...CONTINENTS];
  }
  const rng = createRng(`${seed}:options:${round}`);
  return shuffled([place.country, ...wrongCountries(place.country, listed, rng)], rng);
}

export interface GuesserAnswer {
  readonly place: Location;
  /** what was right */
  readonly answer: string;
  /** the button the player pressed */
  readonly picked: string;
  readonly correct: boolean;
}

export interface GuesserRun {
  readonly kind: GuesserKind;
  readonly answers: readonly GuesserAnswer[];
}

export const newRun = (kind: GuesserKind): GuesserRun => ({ kind, answers: [] });

export const isOver = (run: GuesserRun): boolean => run.answers.length >= GUESSER_ROUNDS;

/** Takes the one answer of a round. A run that is over takes no more. */
export function judge(run: GuesserRun, place: Location, picked: string): GuesserRun {
  if (isOver(run)) {
    return run;
  }
  const answer = answerOf(run.kind, place) ?? '';
  return { ...run, answers: [...run.answers, { place, answer, picked, correct: picked === answer }] };
}

export const correctCount = (run: GuesserRun): number => run.answers.filter((answer) => answer.correct).length;

export const scoreOf = (run: GuesserRun): number => correctCount(run) * POINTS_PER_ANSWER;
