import { describe, expect, it } from 'vitest';
import { communityMap, communitySlugOf, regionMaps, countryMaps, countryOf, isMapId, locationsForMap, mapIdSchema, mapName, parseLocationSet, pickRounds, scaleForMap } from './locations.ts';
import { WORLD_SCALE_KM } from './scoring.ts';

const raw = {
  version: 1,
  regions: { FR: 'europe', DE: 'europe', US: 'americas', JP: 'asia-oceania' },
  locations: [
    ['a', 2.35, 48.85, 'FR'],
    ['b', 13.4, 52.52, 'DE'],
    ['c', -74, 40.7, 'US'],
    ['d', 139.7, 35.68, 'JP'],
    ['e', 2.2, 6.4, 'BJ'],
    ['f', 5.37, 43.3, 'FR'],
  ],
};

describe('parseLocationSet', () => {
  it('reads the compact rows', () => {
    const set = parseLocationSet(raw);
    expect(set.locations).toHaveLength(6);
    expect(set.locations[0]).toEqual({ id: 'a', lng: 2.35, lat: 48.85, country: 'FR' });
  });

  it.each([
    ['not an object', null],
    ['missing locations', { regions: {} }],
    ['short row', { regions: {}, locations: [['a', 1, 2]] }],
    ['latitude out of range', { regions: {}, locations: [['a', 1, 95, 'FR']] }],
    ['unknown region', { regions: { FR: 'atlantis' }, locations: [] }],
  ])('rejects %s', (_name, bad) => {
    expect(() => parseLocationSet(bad)).toThrow(/locations/i);
  });
});

describe('locationsForMap', () => {
  const set = parseLocationSet(raw);

  it('returns everything for the world', () => {
    expect(locationsForMap(set, 'world')).toHaveLength(6);
  });

  it('filters by region', () => {
    expect(locationsForMap(set, 'europe').map((l) => l.id)).toEqual(['a', 'b', 'f']);
    expect(locationsForMap(set, 'asia-oceania').map((l) => l.id)).toEqual(['d']);
  });
});

describe('pickRounds', () => {
  const set = parseLocationSet(raw);

  it('picks the same distinct rounds for the same seed', () => {
    const first = pickRounds(set.locations, 'seed-1', 5);
    expect(first).toEqual(pickRounds(set.locations, 'seed-1', 5));
    expect(new Set(first.map((l) => l.id)).size).toBe(5);
  });

  it('picks differently for another seed', () => {
    const ids = (seed: string) => pickRounds(set.locations, seed, 3).map((l) => l.id).join();
    const variants = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map(ids));
    expect(variants.size).toBeGreaterThan(1);
  });
});

describe('scaleForMap', () => {
  const set = parseLocationSet(raw);

  it('uses the fixed world scale', () => {
    expect(scaleForMap(set, 'world')).toBe(WORLD_SCALE_KM);
  });

  it('uses the bounding diagonal for a region', () => {
    const km = scaleForMap(set, 'europe');
    expect(km).toBeGreaterThan(900);
    expect(km).toBeLessThan(1500);
  });
});

describe('country maps and Africa', () => {
  const many = (code: string, count: number, lng: number, lat: number) =>
    Array.from({ length: count }, (_, i) => [`${code}${i}`, lng + i * 0.01, lat + i * 0.01, code]);
  const set = parseLocationSet({
    regions: { FR: 'europe', KE: 'africa', JP: 'asia-oceania' },
    locations: [...many('FR', 45, 2, 45), ...many('KE', 40, 36, -1), ...many('JP', 39, 139, 35)],
  });

  it('accepts africa as a region', () => {
    expect(locationsForMap(set, 'africa')).toHaveLength(40);
    expect(mapName('africa')).toBe('Africa');
  });

  it('offers the countries with at least 40 places, by name', () => {
    expect(countryMaps(set)).toEqual([
      { map: 'country:FR', code: 'FR', name: 'France', places: 45 },
      { map: 'country:KE', code: 'KE', name: 'Kenya', places: 40 },
    ]);
  });

  it('offers only the regions the set has enough places in', () => {
    expect(regionMaps(set)).toEqual(['europe', 'africa']);
    expect(regionMaps(parseLocationSet({ regions: {}, locations: [] }))).toEqual([]);
  });

  it("plays a country map on that country's places", () => {
    expect(locationsForMap(set, 'country:FR')).toHaveLength(45);
    expect(locationsForMap(set, 'country:JP').every((l) => l.country === 'JP')).toBe(true);
    expect(locationsForMap(set, 'country:ZZ')).toEqual([]);
  });

  it('scales a country by the diagonal of its places', () => {
    const scale = scaleForMap(set, 'country:FR');
    expect(scale).toBeGreaterThan(50);
    expect(scale).toBeLessThan(80);
  });

  it('names a country map after the country', () => {
    expect(mapName('country:FR')).toBe('France');
    expect(mapName('world')).toBe('World');
    expect(mapName('asia-oceania')).toBe('Asia & Oceania');
  });

  it('tells a map id from anything else', () => {
    expect(isMapId('world')).toBe(true);
    expect(isMapId('africa')).toBe(true);
    expect(isMapId('country:GB')).toBe(true);
    expect(isMapId('country:gb')).toBe(false);
    expect(isMapId('country:GBR')).toBe(false);
    expect(isMapId('mars')).toBe(false);
    expect(isMapId(null)).toBe(false);
    expect(countryOf('country:GB')).toBe('GB');
    expect(countryOf('europe')).toBeNull();
    expect(mapIdSchema.safeParse('country:US').success).toBe(true);
    expect(mapIdSchema.safeParse('country:us').success).toBe(false);
    expect(mapIdSchema.safeParse(7).success).toBe(false);
  });
});

describe('community maps', () => {
  const set = parseLocationSet({ regions: {}, locations: [['p1', 2.3, 48.8, 'FR'], ['p2', 2.4, 48.9, 'FR'], ['p3', 13.4, 52.5, 'DE']] });

  it('accepts a community map id and reads its slug', () => {
    expect(isMapId('community:paris-walk-x7k2')).toBe(true);
    expect(isMapId('community:a')).toBe(true);
    expect(communitySlugOf('community:paris-walk-x7k2')).toBe('paris-walk-x7k2');
    expect(communityMap('paris-walk-x7k2')).toBe('community:paris-walk-x7k2');
    expect(mapIdSchema.safeParse('community:paris-walk-x7k2').success).toBe(true);
  });

  it('refuses a slug that is not one', () => {
    for (const id of ['community:', 'community:Paris', 'community:a--b', 'community:-a', 'community:a b', `community:${'a'.repeat(49)}`, 'communitie:a']) {
      expect(isMapId(id), id).toBe(false);
    }
    expect(communitySlugOf('world')).toBeNull();
    expect(communitySlugOf('country:FR')).toBeNull();
    expect(communitySlugOf('community:Paris')).toBeNull();
  });

  it('has no name of its own: the name comes with the map from the server', () => {
    expect(mapName('community:paris-walk-x7k2')).toBe('Community map');
  });

  it("plays every place of the set it is given, and scales by their spread but never under 100 km", () => {
    expect(locationsForMap(set, 'community:any')).toHaveLength(3);
    expect(scaleForMap(set, 'community:any')).toBeGreaterThan(800);
    const tight = parseLocationSet({ regions: {}, locations: [['p1', 2.3, 48.8, 'FR'], ['p2', 2.301, 48.801, 'FR']] });
    expect(scaleForMap(tight, 'community:any')).toBe(100);
  });
});
