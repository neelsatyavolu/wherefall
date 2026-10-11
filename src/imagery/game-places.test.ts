import { describe, expect, it } from 'vitest';
import { parseLocationSet, pickRounds, type Location } from '../game/locations.ts';
import { WORLD_SCALE_KM } from '../game/scoring.ts';
import { freshestSeed } from '../game/seen-places.ts';
import { continentCount, isSpread } from '../game/spread.ts';
import { NotPlayableHereError, STREAK_LOOKAHEAD, TooFewPlacesError, loadGamePlaces, loadSpreadPlaces, plannedGame, plannedStreak } from './game-places.ts';
import type { ImageryProvider, Place } from './provider.ts';
import { notingShown } from './shown.ts';

const rows = (prefix: string, country: string, count: number, lng: number, lat: number) =>
  Array.from({ length: count }, (_, i) => [`${prefix}${i}`, lng + i * 0.01, lat + i * 0.01, country]);

const openSet = parseLocationSet({ regions: { FR: 'europe', JP: 'asia-oceania' }, locations: [...rows('open-fr', 'FR', 20, 2, 45), ...rows('open-jp', 'JP', 20, 139, 35)] });
const googleSet = parseLocationSet({
  regions: { FR: 'europe', KE: 'africa' },
  locations: [...rows('g-fr', 'FR', 30, 2, 45), ...rows('g-ke', 'KE', 30, 36, -1)],
});

class Gone extends Error {}

function provider(name: 'google' | 'panoramax', set: typeof openSet, gone: readonly string[] = []): ImageryProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    name,
    attribution: null,
    asked,
    places: async () => set,
    resolve: async (location: Location): Promise<Place> => {
      asked.push(location.id);
      if (gone.includes(location.id)) {
        throw new Gone();
      }
      return { lng: location.lng + 0.001, lat: location.lat, credit: name };
    },
    isGone: (error) => error instanceof Gone,
    createView: async () => {
      throw new Error('not needed here');
    },
  };
}

describe('loadGamePlaces', () => {
  it("picks from the source's own list", async () => {
    const onGoogle = await loadGamePlaces(provider('google', googleSet), 'world', 'seed1', 5);
    const onOpen = await loadGamePlaces(provider('panoramax', openSet), 'world', 'seed1', 5);
    expect(onGoogle.rounds.every((round) => round.location.id.startsWith('g-'))).toBe(true);
    expect(onOpen.rounds.every((round) => round.location.id.startsWith('open-'))).toBe(true);
    expect(onGoogle.rounds).toHaveLength(5);
  });

  it('gives the same places for the same seed and source, and others for another seed', async () => {
    const ids = async (seed: string) => (await loadGamePlaces(provider('google', googleSet), 'world', seed, 5)).rounds.map((r) => r.location.id);
    expect(await ids('seed1')).toEqual(await ids('seed1'));
    expect(await ids('seed1')).not.toEqual(await ids('seed2'));
  });

  it("derives region and country maps from the source's list", async () => {
    const africa = await loadGamePlaces(provider('google', googleSet), 'africa', 's', 3);
    expect(africa.rounds.every((round) => round.location.country === 'KE')).toBe(true);
    expect(africa.locations).toHaveLength(30);
    const france = await loadGamePlaces(provider('panoramax', openSet), 'country:FR', 's', 3);
    expect(france.rounds.every((round) => round.location.country === 'FR')).toBe(true);
    expect(france.scaleKm).toBeLessThan(100);
  });

  it('uses the world scale on the world map', async () => {
    expect((await loadGamePlaces(provider('google', googleSet), 'world', 's', 3)).scaleKm).toBe(WORLD_SCALE_KM);
  });

  it('cannot serve a map its list has too few places for, so the next source is tried', async () => {
    await expect(loadGamePlaces(provider('panoramax', openSet), 'africa', 's', 3)).rejects.toBeInstanceOf(TooFewPlacesError);
    await expect(loadGamePlaces(provider('panoramax', openSet), 'country:JP', 's', 10)).resolves.toMatchObject({ scaleKm: expect.any(Number) });
    await expect(loadGamePlaces(provider('google', googleSet), 'country:JP', 's', 3)).rejects.toBeInstanceOf(TooFewPlacesError);
  });

  it('replaces a place whose picture is gone with a spare', async () => {
    const first = (await loadGamePlaces(provider('google', googleSet), 'world', 'seed1', 5)).rounds[0]!.location.id;
    const second = await loadGamePlaces(provider('google', googleSet, [first]), 'world', 'seed1', 5);
    expect(second.rounds).toHaveLength(5);
    expect(second.rounds.map((round) => round.location.id)).not.toContain(first);
  });

  it('keeps the picture found for each place', async () => {
    const { rounds } = await loadGamePlaces(provider('google', googleSet), 'world', 'seed1', 3);
    expect(rounds[0]!.pano).toEqual({ lng: rounds[0]!.location.lng + 0.001, lat: rounds[0]!.location.lat, credit: 'google' });
  });
});

describe('a community map', () => {
  const own = parseLocationSet({ regions: {}, locations: rows('pano', 'FR', 6, 2.3, 48.85) });

  it("is played from the map's own places, not the source's list", async () => {
    const google = provider('google', googleSet);
    const game = await loadGamePlaces(google, 'community:paris-walk-x7k2', 'seed1', 5, own);
    expect(game.rounds).toHaveLength(5);
    expect(game.rounds.every((round) => round.location.id.startsWith('pano'))).toBe(true);
    expect(game.locations).toHaveLength(6);
    // a few streets across: the scale is held at 100 km
    expect(game.scaleKm).toBe(100);
  });

  it('cannot be played on a source other than Google, whose panoramas its places are', async () => {
    await expect(loadGamePlaces(provider('panoramax', openSet), 'community:paris-walk-x7k2', 'seed1', 5, own)).rejects.toBeInstanceOf(NotPlayableHereError);
  });

  it('cannot be played without its places, or for more rounds than it has', async () => {
    await expect(loadGamePlaces(provider('google', googleSet), 'community:paris-walk-x7k2', 'seed1', 5)).rejects.toBeInstanceOf(NotPlayableHereError);
    await expect(loadGamePlaces(provider('google', googleSet), 'community:paris-walk-x7k2', 'seed1', 10, own)).rejects.toBeInstanceOf(TooFewPlacesError);
  });
});

describe('spares', () => {
  it('hands out the candidates that were not used, one at a time, until none is left', async () => {
    const game = await loadGamePlaces(provider('google', googleSet), 'world', 'seed1', 5);
    const used = new Set(game.rounds.map((round) => round.location.id));
    const taken: string[] = [];
    for (let spare = await game.takeSpare(); spare !== null; spare = await game.takeSpare()) {
      taken.push(spare.location.id);
    }
    expect(taken).toHaveLength(5);
    expect(new Set(taken).size).toBe(5);
    expect(taken.every((id) => !used.has(id))).toBe(true);
    expect(await game.takeSpare()).toBeNull();
  });

  it('passes over a spare whose picture is gone', async () => {
    const first = await loadGamePlaces(provider('google', googleSet), 'world', 'seed1', 5);
    const gone = (await first.takeSpare())!.location.id;
    const second = await loadGamePlaces(provider('google', googleSet, [gone]), 'world', 'seed1', 5);
    expect((await second.takeSpare())?.location.id).not.toBe(gone);
  });

  it('has none when the map is no bigger than the game', async () => {
    const own = parseLocationSet({ regions: {}, locations: rows('pano', 'FR', 5, 2.3, 48.85) });
    const game = await loadGamePlaces(provider('google', googleSet), 'community:tiny-map', 'seed1', 5, own);
    expect(await game.takeSpare()).toBeNull();
  });
});

describe('places seen before', () => {
  /** A source that notes what it shows into `seen`, as the game does. */
  const noting = (seen: Set<string>) => notingShown(provider('google', googleSet), (id) => void seen.add(id));
  const ids = (game: { rounds: ReadonlyArray<{ location: Location }> }) => game.rounds.map((round) => round.location.id);

  it('are noted as a game is drawn: the places of its rounds, and no others', async () => {
    const seen = new Set<string>();
    const game = await loadGamePlaces(noting(seen), 'world', 'seed1', 5);
    expect([...seen].sort()).toEqual(ids(game).sort());
  });

  it('do not change what a seed gives: a challenge link shows the same places after they have been seen', async () => {
    const seen = new Set<string>();
    const first = ids(await loadGamePlaces(noting(seen), 'world', 'link0001', 5));
    expect(first.every((id) => seen.has(id))).toBe(true);
    expect(ids(await loadGamePlaces(noting(seen), 'world', 'link0001', 5))).toEqual(first);
  });

  it('are what a fresh game is planned around: its seed is one whose places are new', async () => {
    const seen = new Set<string>();
    await loadGamePlaces(noting(seen), 'world', 'seed1', 5);
    const seeds = Array.from({ length: 40 }, (_, i) => `try${i}`);
    const seed = freshestSeed(seeds, (each) => plannedGame(googleSet, 'world', each, 5), seen);
    const next = ids(await loadGamePlaces(noting(new Set()), 'world', seed, 5));
    expect(next.some((id) => seen.has(id))).toBe(false);
  });
});

describe('plannedGame', () => {
  it('is the places the game then shows, in order', async () => {
    for (const map of ['world', 'africa', 'country:FR'] as const) {
      const game = await loadGamePlaces(provider('google', googleSet), map, 'seed7', 5);
      expect(plannedGame(googleSet, map, 'seed7', 5)).toEqual(game.rounds.map((round) => round.location));
    }
  });

  it('is empty for a map the list cannot fill, which no seed can help', () => {
    expect(plannedGame(openSet, 'africa', 'seed7', 5)).toEqual([]);
  });
});

describe('plannedStreak', () => {
  it('is the first places of a run, the same for the same seed', () => {
    const first = plannedStreak(googleSet, 'run1');
    expect(first).toEqual(plannedStreak(googleSet, 'run1'));
    expect(first).not.toEqual(plannedStreak(googleSet, 'run2'));
    expect(first).toHaveLength(STREAK_LOOKAHEAD);
    expect(first).toEqual(pickRounds(googleSet.locations, 'run1', googleSet.locations.length).slice(0, STREAK_LOOKAHEAD));
  });

  it('is every place of a list shorter than that', () => {
    const tiny = parseLocationSet({ regions: {}, locations: rows('t', 'FR', 4, 2, 45) });
    expect(plannedStreak(tiny, 'run1')).toHaveLength(4);
  });
});

describe('loadSpreadPlaces: an online world game on three continents', () => {
  // mostly France and the United States, with two places in Japan: most plain draws are on two continents
  const lopsided = parseLocationSet({
    regions: { FR: 'europe', US: 'americas', JP: 'asia-oceania' },
    locations: [...rows('s-fr', 'FR', 40, 2, 45), ...rows('s-us', 'US', 40, -100, 40), ...rows('s-jp', 'JP', 2, 139, 35)],
  });
  const even = parseLocationSet({
    regions: { FR: 'europe', US: 'americas', JP: 'asia-oceania', KE: 'africa' },
    locations: [...rows('e-fr', 'FR', 10, 2, 45), ...rows('e-us', 'US', 10, -100, 40), ...rows('e-jp', 'JP', 10, 139, 35), ...rows('e-ke', 'KE', 10, 36, -1)],
  });
  const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const idsOf = (rounds: ReadonlyArray<{ location: Location }>) => rounds.map((round) => round.location.id);
  const placesOf = (rounds: ReadonlyArray<{ location: Location }>) => rounds.map((round) => round.location);

  it('draws one place a round on at least three continents, whatever the seed', async () => {
    for (const seed of SEEDS) {
      for (const count of [3, 5]) {
        const { rounds } = await loadSpreadPlaces(provider('panoramax', lopsided), seed, count);
        expect(rounds).toHaveLength(count);
        expect(new Set(idsOf(rounds)).size).toBe(count);
        expect(continentCount(placesOf(rounds))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('is the same draw for the same seed, and the plain draw wherever that is spread already', async () => {
    const spread = async (seed: string) => idsOf((await loadSpreadPlaces(provider('panoramax', even), seed, 5)).rounds);
    expect(await spread('seed1')).toEqual(await spread('seed1'));
    expect(await spread('seed1')).not.toEqual(await spread('seed2'));
    const plain = await Promise.all(SEEDS.map(async (seed) => ({ seed, rounds: (await loadGamePlaces(provider('panoramax', even), 'world', seed, 5)).rounds })));
    const alreadySpread = plain.filter(({ rounds }) => isSpread(placesOf(rounds)));
    expect(alreadySpread.length).toBeGreaterThan(0);
    for (const { seed, rounds } of alreadySpread) {
      expect(await spread(seed)).toEqual(idsOf(rounds));
    }
  });

  it('plays on the world scale, from every place the source has, with each picture resolved', async () => {
    const places = await loadSpreadPlaces(provider('panoramax', lopsided), 'seed1', 5);
    expect(places.scaleKm).toBe(WORLD_SCALE_KM);
    expect(places.locations).toHaveLength(82);
    expect(places.rounds.every((round) => round.pano.lng === round.location.lng + 0.001)).toBe(true);
  });

  it('still ends on three continents when a spare stands in for a place whose picture is gone', async () => {
    for (const seed of SEEDS) {
      const first = await loadSpreadPlaces(provider('panoramax', lopsided), seed, 5);
      // the hardest place to lose: the one from the continent with the fewest places, when it was drawn
      const lost = idsOf(first.rounds).filter((id) => id.startsWith('s-jp'));
      const again = await loadSpreadPlaces(provider('panoramax', lopsided, lost), seed, 5);
      expect(again.rounds).toHaveLength(5);
      expect(idsOf(again.rounds).some((id) => lost.includes(id))).toBe(false);
      expect(continentCount(placesOf(again.rounds))).toBeGreaterThanOrEqual(lost.length === 2 ? 2 : 3);
    }
    const noJapan = await loadSpreadPlaces(provider('panoramax', lopsided, ['s-jp0']), 'a', 3);
    expect(idsOf(noJapan.rounds)).toContain('s-jp1');
  });

  it('asks for each picture once, however often the draw is made again', async () => {
    const source = provider('panoramax', lopsided, ['s-jp0', 's-jp1']);
    const { rounds } = await loadSpreadPlaces(source, 'a', 5);
    expect(new Set(source.asked).size).toBe(source.asked.length);
    // with no third continent left the game is still drawn: the server is the one to refuse it
    expect(continentCount(placesOf(rounds))).toBe(2);
  });

  it('gives up when more pictures are gone than a game has spares for', async () => {
    const allGone = lopsided.locations.map((location) => location.id);
    await expect(loadSpreadPlaces(provider('panoramax', lopsided, allGone), 'a', 5)).rejects.toThrow('could be loaded');
  });

  it('rethrows a failure that is not a missing picture, and cannot serve a list shorter than the game', async () => {
    const down: ImageryProvider = { ...provider('panoramax', lopsided), resolve: async () => Promise.reject(new Error('network down')) };
    await expect(loadSpreadPlaces(down, 'a', 5)).rejects.toThrow('network down');
    const tiny = parseLocationSet({ regions: { FR: 'europe' }, locations: rows('t-fr', 'FR', 2, 2, 45) });
    await expect(loadSpreadPlaces(provider('panoramax', tiny), 'a', 3)).rejects.toBeInstanceOf(TooFewPlacesError);
  });

  it('has no spare to hand out later: a match plays the places that were posted', async () => {
    expect(await (await loadSpreadPlaces(provider('panoramax', even), 'a', 3)).takeSpare()).toBeNull();
  });
});
