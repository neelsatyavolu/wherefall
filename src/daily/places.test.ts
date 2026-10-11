import { describe, expect, it } from 'vitest';
import { parseLocationSet, type Location, type LocationSet } from '../game/locations.ts';
import { WORLD_SCALE_KM } from '../game/scoring.ts';
import { TooFewPlacesError } from '../imagery/game-places.ts';
import type { ImageryProvider, Place } from '../imagery/provider.ts';
import { dailySpares, drawDaily } from './draw.ts';
import { loadDailyPlaces } from './places.ts';

const rows = (country: string, count: number, lng: number, lat: number) => Array.from({ length: count }, (_, i) => [`${country.toLowerCase()}${i}`, lng + i * 0.01, lat, country]);

const SET = parseLocationSet({
  regions: { FR: 'europe', DE: 'europe', KE: 'africa', JP: 'asia-oceania' },
  locations: [...rows('FR', 12, 2, 45), ...rows('DE', 12, 10, 50), ...rows('KE', 8, 36, -1), ...rows('JP', 8, 139, 35)],
});
const SEED = 'daily20261011';

class Gone extends Error {}

function provider(set: LocationSet, gone: readonly string[] = [], down: readonly string[] = []): ImageryProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'panoramax',
    attribution: null,
    asked,
    places: async () => set,
    resolve: async (location: Location): Promise<Place> => {
      asked.push(location.id);
      if (down.includes(location.id)) {
        throw new Error('network');
      }
      if (gone.includes(location.id)) {
        throw new Gone();
      }
      return { lng: location.lng + 0.001, lat: location.lat, credit: 'test' };
    },
    isGone: (error) => error instanceof Gone,
    createView: async () => {
      throw new Error('not needed here');
    },
  };
}

const ids = (places: ReadonlyArray<{ location: Location }>) => places.map((each) => each.location.id);

describe('loadDailyPlaces', () => {
  it("resolves the day's three places, scored on the world's scale", async () => {
    const places = await loadDailyPlaces(provider(SET), SEED);
    expect(ids(places.rounds)).toEqual(drawDaily(SET.locations, SEED).map((each) => each.id));
    expect(places.rounds[0]!.pano.credit).toBe('test');
    expect(places.scaleKm).toBe(WORLD_SCALE_KM);
    expect(places.locations).toBe(SET.locations);
  });

  it('draws again without a place whose picture is gone, asking for no picture twice', async () => {
    const first = drawDaily(SET.locations, SEED);
    const source = provider(SET, [first[0]!.id]);
    const places = await loadDailyPlaces(source, SEED);
    expect(ids(places.rounds)).toEqual(drawDaily(SET.locations, SEED, new Set([first[0]!.id])).map((each) => each.id));
    expect(new Set(source.asked).size).toBe(source.asked.length);
  });

  it('fails as it is when the source cannot be reached, so the same places come on a retry', async () => {
    const first = drawDaily(SET.locations, SEED);
    await expect(loadDailyPlaces(provider(SET, [], [first[1]!.id]), SEED)).rejects.toThrow('network');
  });

  it('says so when the list has fewer than three places', async () => {
    const poor = parseLocationSet({ regions: { FR: 'europe' }, locations: rows('FR', 2, 2, 45) });
    await expect(loadDailyPlaces(provider(poor), SEED)).rejects.toBeInstanceOf(TooFewPlacesError);
  });

  it('gives up when every picture is gone', async () => {
    const all = SET.locations.map((each) => each.id);
    await expect(loadDailyPlaces(provider(SET, all), SEED)).rejects.toThrow();
  });

  it('hands out spares that keep the rule, passing over gone ones, then none', async () => {
    const drawn = drawDaily(SET.locations, SEED);
    const spares = dailySpares(SET.locations, SEED, drawn);
    const places = await loadDailyPlaces(provider(SET, [spares[0]!.id]), SEED);
    expect((await places.takeSpare())?.location.id).toBe(spares[1]!.id);
    expect((await places.takeSpare())?.location.id).toBe(spares[2]!.id);
    for (let i = 3; i < spares.length; i++) {
      await places.takeSpare();
    }
    expect(await places.takeSpare()).toBeNull();
  });
});
