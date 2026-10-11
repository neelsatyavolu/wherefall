import type { LngLat } from '../game/geo.ts';
import type { Location } from '../game/locations.ts';
import type { Session } from '../game/session.ts';
import type { Challenge } from '../game/settings.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import type { SavedGame } from './client.ts';

/**
 * A finished game as the server takes it. The server knows every place by its id and holds a saved
 * round to where the place's list (or community map) has it, within 0.0001°. A game is played and
 * scored on where each picture really is, which can be up to 150 m from the listed coordinate when
 * a retired panorama's neighbour stands in: so what is saved is the listed coordinate, noted as
 * the game's places were made ready.
 */

/** Where a place is by its list, or null for a place nobody noted. */
export type Listed = (id: string) => LngLat | null;

/** The places of one game as their list has them: `note` each as it is made ready, ask `of` when the game is saved. */
export function listedPlaces(): { note: (location: Location) => void; of: Listed } {
  const places = new Map<string, LngLat>();
  return {
    note: ({ id, lng, lat }) => void places.set(id, { lng, lat }),
    of: (id) => places.get(id) ?? null,
  };
}

/**
 * The same source, telling `note` every place it is asked to make ready, as the caller named it:
 * from the source's own list, a community map, or a match. It changes nothing about the game.
 */
export function notingListed<P extends Place>(provider: ImageryProvider<P>, note: (location: Location) => void): ImageryProvider<P> {
  return {
    name: provider.name,
    // read when it is used, as the source's own is: it can depend on the language in use
    get attribution() {
      return provider.attribution;
    },
    places: () => provider.places(),
    resolve: (location) => {
      note(location);
      return provider.resolve(location);
    },
    isGone: (error) => provider.isGone(error),
    createView: (container, mode, handlers) => provider.createView(container, mode, handlers),
  };
}

/**
 * The game as it is sent: each round by its place's id, on the coordinates `listed` has for it
 * (the ones it was played on for a place nobody listed), with the guess and the hint. No scale is
 * sent: the server works out the scale, the country, the distance and the score.
 */
export function toSavedGame(session: Session, challenge: Challenge, daily: string | null, listed: Listed): SavedGame {
  return {
    map: challenge.map,
    mode: challenge.mode,
    timeLimit: challenge.timeLimit,
    seed: challenge.seed,
    rounds: session.results.map((result) => {
      const { lng, lat } = listed(result.location.id) ?? result.location;
      return {
        id: result.location.id,
        lng,
        lat,
        guessLng: result.guess?.lng ?? null,
        guessLat: result.guess?.lat ?? null,
        hinted: result.hinted,
        country: result.location.country,
        distanceKm: result.distanceKm,
        score: result.score,
      };
    }),
    ...(daily === null ? {} : { daily }),
  };
}
