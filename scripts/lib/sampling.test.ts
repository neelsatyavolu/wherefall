import { describe, expect, it } from 'vitest';
import { areaFromHits, quotaFor, quotaForArea, randomGlobePoint, regionForGroups, settleRegions, tileAt, tilesNear } from './sampling.ts';
import { createRng } from '../../src/game/rng.ts';

describe('quotaFor', () => {
  it('gives small countries a floor so they still show up', () => {
    expect(quotaFor(1)).toBe(40);
  });

  it('grows with the square root of covered area', () => {
    expect(quotaFor(100)).toBe(120);
  });

  it('caps the largest countries so they do not swamp the map', () => {
    expect(quotaFor(4577)).toBe(600);
  });
});

describe('tileAt', () => {
  it('finds the tile over Paris', () => {
    expect(tileAt(2.35, 48.86, 6)).toEqual({ x: 32, y: 22 });
  });

  it('puts the whole world in tile 0/0 at zoom 0', () => {
    expect(tileAt(-120, -40, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('tilesNear', () => {
  it('starts with the tile under the point and adds distinct neighbours', () => {
    const tiles = tilesNear(2.35, 48.86, 11, 0.1);
    expect(tiles[0]).toEqual(tileAt(2.35, 48.86, 11));
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length);
    expect(tiles.length).toBeGreaterThan(1);
  });
});

describe('regionForGroups', () => {
  it('maps UN regions onto the game maps', () => {
    expect(regionForGroups(['EU', '155', '150', 'UN'])).toBe('europe');
    expect(regionForGroups(['021', '003', '019', 'UN'])).toBe('americas');
    expect(regionForGroups(['030', '142', 'UN'])).toBe('asia-oceania');
    expect(regionForGroups(['053', '009', 'UN'])).toBe('asia-oceania');
  });

  it('recognises Africa', () => {
    expect(regionForGroups(['011', '202', '002', 'UN'])).toBe('africa');
  });

  it('leaves places outside every region to the world map only', () => {
    expect(regionForGroups(['UN', '001'])).toBeNull();
  });
});

describe('settleRegions', () => {
  const row = (id: string, country: string, region: 'europe' | 'americas' | 'asia-oceania' | null) => ({ id, country, region });

  it('gives each country the region most of its rows are in', () => {
    const { regions } = settleRegions([row('a', 'FR', 'europe'), row('b', 'FR', 'europe'), row('c', 'JP', 'asia-oceania')]);
    expect(regions).toEqual({ FR: 'europe', JP: 'asia-oceania' });
  });

  it('drops rows that sit outside their country\'s region, whatever order they come in', () => {
    const rows = [row('hawaii', 'US', 'asia-oceania'), row('nyc', 'US', 'americas'), row('la', 'US', 'americas')];
    for (const ordered of [rows, [...rows].reverse()]) {
      const { regions, kept } = settleRegions(ordered);
      expect(regions).toEqual({ US: 'americas' });
      expect(kept.map((r) => r.id).sort()).toEqual(['la', 'nyc']);
    }
  });

  it('leaves countries without a region out of the table but keeps their rows', () => {
    const { regions, kept } = settleRegions([row('a', 'BJ', null), row('b', 'BJ', null)]);
    expect(regions).toEqual({});
    expect(kept).toHaveLength(2);
  });
});

describe('quotaForArea', () => {
  it('keeps tiny countries on the map', () => {
    expect(quotaForArea(2)).toBe(60);
  });

  it('gives a small country enough places to be a map of its own', () => {
    // Slovenia, about 20,000 km²: a country map needs 40
    expect(quotaForArea(20_000)).toBeGreaterThanOrEqual(40);
  });

  it('grows with the square root of area', () => {
    expect(quotaForArea(640_000)).toBe(320);
  });

  it('caps the giants', () => {
    expect(quotaForArea(17_000_000)).toBe(600);
  });
});

describe('areaFromHits', () => {
  it('scales the share of hits to the surface of the Earth', () => {
    expect(areaFromHits(1, 2)).toBe(255_036_000);
  });
});

describe('randomGlobePoint', () => {
  it('stays in range and does not crowd the poles', () => {
    const rng = createRng('globe');
    const points = Array.from({ length: 4000 }, () => randomGlobePoint(rng));
    expect(points.every(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)).toBe(true);
    // on a sphere half the surface lies between 30°S and 30°N
    const tropicsShare = points.filter(([, lat]) => Math.abs(lat) < 30).length / points.length;
    expect(tropicsShare).toBeGreaterThan(0.46);
    expect(tropicsShare).toBeLessThan(0.54);
  });
});
