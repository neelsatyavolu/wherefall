import { z } from 'zod';
import { language, t, type Language } from '../i18n/index.ts';
import { boundsDiagonalKm } from './geo.ts';
import { createRng, pickDistinct } from './rng.ts';
import { WORLD_SCALE_KM } from './scoring.ts';

export const REGION_IDS = ['europe', 'americas', 'asia-oceania', 'africa'] as const;
/** The maps that are not one country: the world and its regions. */
export const MAP_IDS = ['world', ...REGION_IDS] as const;
export type RegionId = (typeof REGION_IDS)[number];
/** One country or territory, by its two-letter code: `country:FR`. */
export type CountryMapId = `country:${string}`;
/** A map a player made, by the slug the server gave it: `community:paris-walk-x7k2`. */
export type CommunityMapId = `community:${string}`;
export type MapId = (typeof MAP_IDS)[number] | CountryMapId | CommunityMapId;

/** A country or region needs this many places in the set in use before it is offered as a map. */
export const MIN_COUNTRY_PLACES = 40;

const COUNTRY_MAP = /^country:([A-Z]{2})$/;
/** small letters and digits in groups joined by single hyphens, 48 characters at most */
const COMMUNITY_MAP = /^community:([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const MAX_SLUG_LENGTH = 48;
/** A community map can be a few streets across; scoring never works to a scale smaller than this. */
const MIN_COMMUNITY_SCALE_KM = 100;

/** the country names of the language last asked for: made once per language, not once per name */
let regionNames: { language: Language; names: Intl.DisplayNames } | null = null;

function regionNamesNow(): Intl.DisplayNames {
  if (regionNames?.language !== language()) {
    regionNames = { language: language(), names: new Intl.DisplayNames([language()], { type: 'region' }) };
  }
  return regionNames.names;
}

/** The name of a country or territory in the language in use, or its code when there is none. */
export function countryName(code: string): string {
  try {
    return regionNamesNow().of(code) ?? code;
  } catch {
    return code;
  }
}

/** The country code of a country map, or null for the world and the regions. */
export function countryOf(map: string): string | null {
  return COUNTRY_MAP.exec(map)?.[1] ?? null;
}

export const countryMap = (code: string): CountryMapId => `country:${code}`;

/** The slug of a community map, or null for every official map. */
export function communitySlugOf(map: string): string | null {
  const slug = COMMUNITY_MAP.exec(map)?.[1] ?? null;
  return slug !== null && slug.length <= MAX_SLUG_LENGTH ? slug : null;
}

export const communityMap = (slug: string): CommunityMapId => `community:${slug}`;

export function isMapId(value: string | null | undefined): value is MapId {
  return typeof value === 'string' && (MAP_IDS.some((id) => id === value) || COUNTRY_MAP.test(value) || communitySlugOf(value) !== null);
}

export const mapIdSchema = z.custom<MapId>((value) => typeof value === 'string' && isMapId(value));

/** The name of an official map. A community map's name is its maker's and comes from the server; here it is only "Community map". */
export function mapName(map: MapId): string {
  if (communitySlugOf(map) !== null) {
    // what a community map is called before its own name is known
    return t('map.community');
  }
  const country = countryOf(map);
  return country ? countryName(country) : t(`map.${map as (typeof MAP_IDS)[number]}`);
}

export interface Location {
  id: string;
  lng: number;
  lat: number;
  country: string;
}

export interface LocationSet {
  locations: readonly Location[];
  regions: Readonly<Record<string, RegionId>>;
}

const locationRow = z.tuple([
  z.string().min(1),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.string().length(2),
]);

const locationFile = z.object({
  regions: z.record(z.string(), z.enum(REGION_IDS)),
  locations: z.array(locationRow),
});

export function parseLocationSet(raw: unknown): LocationSet {
  const parsed = locationFile.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid locations file: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
  }
  return {
    regions: parsed.data.regions,
    locations: parsed.data.locations.map(([id, lng, lat, country]) => ({ id, lng, lat, country })),
  };
}

/** The places of a map within a set. For a community map the set is that map's own places, all of them. */
export function locationsForMap(set: LocationSet, map: MapId): readonly Location[] {
  if (map === 'world' || communitySlugOf(map) !== null) {
    return set.locations;
  }
  const country = countryOf(map);
  if (country) {
    return set.locations.filter((location) => location.country === country);
  }
  return set.locations.filter((location) => set.regions[location.country] === map);
}

/** The regions a set has enough places for, in their usual order. A set drawn from one source can lack a whole region. */
export function regionMaps(set: LocationSet): RegionId[] {
  const counts = new Map<RegionId, number>();
  for (const location of set.locations) {
    const region = set.regions[location.country];
    if (region) {
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
  }
  return REGION_IDS.filter((region) => (counts.get(region) ?? 0) >= MIN_COUNTRY_PLACES);
}

export interface CountryMap {
  map: CountryMapId;
  code: string;
  name: string;
  places: number;
}

/** The countries and territories a set has enough places for, by name. Each set has its own list. */
export function countryMaps(set: LocationSet): CountryMap[] {
  const counts = new Map<string, number>();
  for (const location of set.locations) {
    counts.set(location.country, (counts.get(location.country) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, places]) => places >= MIN_COUNTRY_PLACES)
    .map(([code, places]) => ({ map: countryMap(code), code, name: countryName(code), places }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pickRounds(locations: readonly Location[], seed: string, count: number): Location[] {
  return pickDistinct(locations, count, createRng(seed));
}

/** Distance scale for scoring: a miss that is small on the world map is large inside one region or country. */
export function scaleForMap(set: LocationSet, map: MapId): number {
  if (map === 'world') {
    return WORLD_SCALE_KM;
  }
  const diagonal = boundsDiagonalKm(locationsForMap(set, map));
  return communitySlugOf(map) !== null ? Math.max(MIN_COMMUNITY_SCALE_KM, diagonal) : diagonal;
}
