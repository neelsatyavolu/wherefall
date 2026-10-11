import { communitySlugOf, locationsForMap, pickRounds, scaleForMap, type Location, type LocationSet, type MapId } from '../game/locations.ts';
import { SPARE_ROUNDS, resolveRounds, type ResolvedRound } from '../game/rounds.ts';
import { WORLD_SCALE_KM } from '../game/scoring.ts';
import { drawSpread } from '../game/spread.ts';
import { MAX_STREAK } from '../game/streak.ts';
import type { ImageryProvider, Place } from './provider.ts';

/** This source's list has too few places on the map for the game asked for. */
export class TooFewPlacesError extends Error {
  constructor(map: MapId, found: number, wanted: number) {
    super(`Only ${found} places on ${map}, ${wanted} needed`);
    this.name = 'TooFewPlacesError';
  }
}

/** A community map is made of Google panoramas: no other source can show it, and it needs its own places. */
export class NotPlayableHereError extends Error {
  constructor(map: MapId, source: string) {
    super(`${map} cannot be played on ${source}`);
    this.name = 'NotPlayableHereError';
  }
}

export interface GamePlaces<P extends Place = Place> {
  /** one resolved place per round */
  rounds: ResolvedRound<P>[];
  /** distance scale for scoring on this map, from this source's list */
  scaleKm: number;
  /** every place this source has on the map, for framing the guess map */
  locations: readonly Location[];
  /**
   * The next candidate that was picked but not used, resolved and ready to stand in for a place
   * whose picture will not load. Null once there are none left.
   */
  takeSpare: () => Promise<ResolvedRound<P> | null>;
}

/** How many places from the start of a streak run a fresh seed is judged by: about as far as most runs get. */
export const STREAK_LOOKAHEAD = 10;

/** A game's places in the order the seed gives them: its rounds first, then the spares. */
const gameCandidates = (locations: readonly Location[], seed: string, rounds: number): Location[] =>
  pickRounds(locations, seed, Math.min(locations.length, rounds + SPARE_ROUNDS));

/**
 * The places a seed gives a game on an official map, while every picture still exists. A game
 * nobody sent is given the seed whose places this browser has seen least (`freshestSeed`); this is
 * what each seed is judged by. Empty when the list cannot fill the game, whatever the seed.
 */
export function plannedGame(set: LocationSet, map: MapId, seed: string, rounds: number): Location[] {
  const locations = locationsForMap(set, map);
  return locations.length < rounds ? [] : gameCandidates(locations, seed, rounds).slice(0, rounds);
}

/** The first places a seed gives a country streak, which draws from the whole list as `ui/streak-play.ts` does. */
export function plannedStreak(set: LocationSet, seed: string): Location[] {
  return pickRounds(set.locations, seed, Math.min(set.locations.length, MAX_STREAK + SPARE_ROUNDS)).slice(0, STREAK_LOOKAHEAD);
}

/**
 * Picks and resolves a game's places on one imagery source. An official map is played from that
 * source's own list: its regions, countries and scoring scale all come from there. A community
 * map is played from its own places (`community`, fetched from the server), on Google only.
 * Rejects when the source cannot serve the game, so the caller can try the next source.
 */
export async function loadGamePlaces<P extends Place>(
  provider: ImageryProvider<P>,
  map: MapId,
  seed: string,
  rounds: number,
  community?: LocationSet,
): Promise<GamePlaces<P>> {
  const isCommunity = communitySlugOf(map) !== null;
  if (isCommunity && (provider.name !== 'google' || !community)) {
    throw new NotPlayableHereError(map, provider.name);
  }
  const set = isCommunity && community ? community : await provider.places();
  const locations = locationsForMap(set, map);
  if (locations.length < rounds) {
    throw new TooFewPlacesError(map, locations.length, rounds);
  }
  const candidates = gameCandidates(locations, seed, rounds);
  const resolved = await resolveRounds(candidates, rounds, (location) => provider.resolve(location), provider.isGone);
  const used = new Set(resolved.map((round) => round.location.id));
  let spares = candidates.filter((candidate) => !used.has(candidate.id));
  const takeSpare = async (): Promise<ResolvedRound<P> | null> => {
    while (spares.length > 0) {
      const [location, ...rest] = spares as [Location, ...Location[]];
      spares = rest;
      try {
        return { location, pano: await provider.resolve(location) };
      } catch (error) {
        if (!provider.isGone(error)) {
          throw error;
        }
      }
    }
    return null;
  };
  return { rounds: resolved, scaleKm: scaleForMap(set, map), locations, takeSpare };
}

/**
 * Picks and resolves the places of an online world game (public, ranked or 2v2, three rounds or
 * more) on one imagery source: from the seed like any game, but on at least three continents, which
 * is what the server takes. A place whose picture is gone is passed over and the draw made again
 * without it, so the game ends on three continents whichever spare stood in; as in any game, more
 * than `SPARE_ROUNDS` lost pictures is a failure. Rejects when the source cannot serve the game.
 */
export async function loadSpreadPlaces<P extends Place>(provider: ImageryProvider<P>, seed: string, rounds: number): Promise<GamePlaces<P>> {
  const locations = (await provider.places()).locations;
  if (locations.length < rounds) {
    throw new TooFewPlacesError('world', locations.length, rounds);
  }
  const ordered = pickRounds(locations, seed, locations.length);
  const attempt = async (location: Location): Promise<ResolvedRound<P> | null> => {
    try {
      return { location, pano: await provider.resolve(location) };
    } catch (error) {
      if (!provider.isGone(error)) {
        throw error;
      }
      return null;
    }
  };
  let found: ReadonlyMap<string, ResolvedRound<P>> = new Map();
  let gone: ReadonlySet<string> = new Set();
  for (;;) {
    const drawn = drawSpread(ordered, rounds, gone);
    const asked = drawn.filter((location) => !found.has(location.id));
    const answers = await Promise.all(asked.map(attempt));
    found = new Map([...found, ...answers.filter((round) => round !== null).map((round) => [round.location.id, round] as const)]);
    const lost = asked.filter((_, index) => answers[index] === null).map((location) => location.id);
    if (lost.length === 0 && drawn.length === rounds) {
      // a match plays the places that were posted: there is nothing a spare could stand in for later
      return { rounds: drawn.map((location) => found.get(location.id)!), scaleKm: WORLD_SCALE_KM, locations, takeSpare: async () => null };
    }
    gone = new Set([...gone, ...lost]);
    if (drawn.length < rounds || gone.size > SPARE_ROUNDS) {
      throw new Error(`Only ${drawn.filter((location) => found.has(location.id)).length} of ${rounds} places could be loaded`);
    }
  }
}
