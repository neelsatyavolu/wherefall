const MIN_QUOTA = 40;
const MAX_QUOTA = 600;
const QUOTA_FACTOR = 12;

export type Region = 'europe' | 'americas' | 'asia-oceania' | 'africa';

/** UN M49 region codes, as carried in country-coder's `groups`. */
const REGION_BY_M49: Record<string, Region> = {
  '002': 'africa',
  '150': 'europe',
  '019': 'americas',
  '142': 'asia-oceania',
  '009': 'asia-oceania',
};

/**
 * How many locations a country gets, from the number of grid cells it has imagery in.
 * Square root keeps well-covered countries from drowning out the rest.
 */
export function quotaFor(cellCount: number): number {
  return Math.min(MAX_QUOTA, Math.max(MIN_QUOTA, Math.round(QUOTA_FACTOR * Math.sqrt(cellCount))));
}

export interface Tile {
  x: number;
  y: number;
}

export function tileAt(lng: number, lat: number, zoom: number): Tile {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** The tile under a point first, then the distinct tiles within `reachDeg` of it. */
export function tilesNear(lng: number, lat: number, zoom: number, reachDeg: number): Tile[] {
  const offsets = [0, -reachDeg, reachDeg];
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  for (const dLng of offsets) {
    for (const dLat of offsets) {
      const tile = tileAt(lng + dLng, lat + dLat, zoom);
      const key = `${tile.x}/${tile.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        tiles.push(tile);
      }
    }
  }
  return tiles;
}

export function regionForGroups(groups: readonly string[]): Region | null {
  for (const group of groups) {
    const region = REGION_BY_M49[group];
    if (region) {
      return region;
    }
  }
  return null;
}

interface RegionRow {
  country: string;
  region: Region | null;
}

/**
 * The game looks a place's region up by its country code, so a code must mean one region.
 * Each country takes the region most of its rows are in; rows elsewhere (Hawaii under US, say)
 * are dropped rather than left to drag the whole country into the wrong map.
 */
export function settleRegions<T extends RegionRow>(rows: readonly T[]): { regions: Record<string, Region>; kept: T[] } {
  const tallies = new Map<string, Map<Region | null, number>>();
  for (const row of rows) {
    const tally = tallies.get(row.country) ?? new Map<Region | null, number>();
    tally.set(row.region, (tally.get(row.region) ?? 0) + 1);
    tallies.set(row.country, tally);
  }
  const majority = new Map(
    [...tallies].map(([country, tally]) => [country, [...tally].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]![0]]),
  );
  return {
    regions: Object.fromEntries([...majority].flatMap(([country, region]) => (region ? [[country, region]] : []))),
    kept: rows.filter((row) => row.region === majority.get(row.country)),
  };
}

/** above the 40 a country needs to be a map of its own, so small countries with coverage qualify */
const MIN_AREA_QUOTA = 60;
const MAX_AREA_QUOTA = 600;
const AREA_QUOTA_DIVISOR = 2.5;
const EARTH_SURFACE_KM2 = 510_072_000;

/**
 * How many places a country gets in the worldwide set, from its land area. Square root again:
 * Russia is 6,600 times the size of Luxembourg but should not get 6,600 times the rounds.
 */
export function quotaForArea(areaKm2: number): number {
  return Math.min(MAX_AREA_QUOTA, Math.max(MIN_AREA_QUOTA, Math.round(Math.sqrt(areaKm2) / AREA_QUOTA_DIVISOR)));
}

/** Area of a region, from how many of `total` points spread evenly over the globe fell inside it. */
export function areaFromHits(hits: number, total: number): number {
  return (hits / total) * EARTH_SURFACE_KM2;
}

/** A point drawn uniformly over the surface of the globe (not uniformly in degrees, which crowds the poles). */
export function randomGlobePoint(rng: () => number): [lng: number, lat: number] {
  return [rng() * 360 - 180, (Math.asin(rng() * 2 - 1) * 180) / Math.PI];
}
