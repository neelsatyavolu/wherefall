import { locationsForMap, scaleForMap, type Location } from '../game/locations.ts';
import type { ResolvedRound } from '../game/rounds.ts';
import { TooFewPlacesError, type GamePlaces } from '../imagery/game-places.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { DAILY_ROUNDS, dailySpares, drawDaily } from './draw.ts';

const MAP = 'world';
/** How many times the draw is made again because a picture has gone, before the source is given up on. */
const MAX_REDRAWS = 10;

type Panos<P> = ReadonlyMap<string, P>;

/**
 * Picks and resolves the daily's three places on one imagery source, from that source's own list.
 * A place whose picture is gone is left out and the draw is made again, so the three keep the rule
 * (three countries, two continents). Any other failure is rethrown: it would pass on a retry, and
 * drawing around it would give this player other places than everyone else.
 */
export async function loadDailyPlaces<P extends Place>(provider: ImageryProvider<P>, seed: string): Promise<GamePlaces<P>> {
  const set = await provider.places();
  const locations = locationsForMap(set, MAP);
  if (locations.length < DAILY_ROUNDS) {
    throw new TooFewPlacesError(MAP, locations.length, DAILY_ROUNDS);
  }

  /** The place's picture, or null when it no longer exists. */
  const resolve = async (location: Location): Promise<P | null> => {
    try {
      return await provider.resolve(location);
    } catch (error) {
      if (!provider.isGone(error)) {
        throw error;
      }
      return null;
    }
  };

  const settle = async (gone: ReadonlySet<string>, panos: Panos<P>, redraws: number): Promise<{ drawn: Location[]; gone: ReadonlySet<string>; panos: Panos<P> }> => {
    const drawn = drawDaily(locations, seed, gone);
    if (drawn.length < DAILY_ROUNDS || redraws > MAX_REDRAWS) {
      throw new Error(`Only ${drawn.length} of ${DAILY_ROUNDS} places could be loaded`);
    }
    const asked = drawn.filter((location) => !panos.has(location.id));
    const answers = await Promise.all(asked.map(resolve));
    const lost = asked.filter((_, index) => answers[index] === null).map((location) => location.id);
    const found = new Map([...panos, ...asked.flatMap((location, index): Array<[string, P]> => (answers[index] ? [[location.id, answers[index]]] : []))]);
    return lost.length === 0 ? { drawn, gone, panos: found } : settle(new Set([...gone, ...lost]), found, redraws + 1);
  };

  const settled = await settle(new Set(), new Map(), 0);
  let spares = dailySpares(locations, seed, settled.drawn, settled.gone);
  const takeSpare = async (): Promise<ResolvedRound<P> | null> => {
    while (spares.length > 0) {
      const [location, ...rest] = spares as [Location, ...Location[]];
      spares = rest;
      const pano = await resolve(location);
      if (pano) {
        return { location, pano };
      }
    }
    return null;
  };

  return {
    rounds: settled.drawn.map((location) => ({ location, pano: settled.panos.get(location.id)! })),
    scaleKm: scaleForMap(set, MAP),
    locations,
    takeSpare,
  };
}
