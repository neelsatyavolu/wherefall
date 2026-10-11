import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { WORLD_SCALE_KM, distanceKm } from '../match/scoring.js';

/**
 * The two lists of places the game is played on, as the browser is served
 * them from `public/`. The server reads them so that a place is what its
 * list says it is, not what a browser claims: where it is, which country it
 * is in, and how wide the map it belongs to is.
 */

/** The files, in a fixed order: a place's `list` is its file's index here. */
export const LIST_FILES = ['locations.google.json', 'locations.json'] as const;

// Each file is named here in full, not built from its name, so that the tool
// which gathers a function's files for deployment can see that it is read.
const BESIDE_THE_CODE: Record<(typeof LIST_FILES)[number], URL> = {
  'locations.google.json': new URL('../../public/locations.google.json', import.meta.url),
  'locations.json': new URL('../../public/locations.json', import.meta.url),
};

export const REGIONS = ['europe', 'americas', 'asia-oceania', 'africa'] as const;
export type Region = (typeof REGIONS)[number];

export interface KnownPlace {
  id: string;
  lng: number;
  lat: number;
  country: string;
  /** Which of the two files the place is in. */
  list: number;
}

interface PlaceList {
  places: readonly KnownPlace[];
  /** The region each country is counted in, for the countries that have one. */
  regions: Readonly<Record<string, Region>>;
}

const fileSchema = z.object({
  regions: z.record(z.string(), z.enum(REGIONS)),
  locations: z.array(z.tuple([z.string().min(1), z.number().min(-180).max(180), z.number().min(-90).max(90), z.string().length(2)])),
});

/**
 * Where `public/` is. Beside the code where the layout is the repository's
 * (tests, `vercel dev`, a deployed function whose files keep their paths),
 * and under the working directory, which is where Vercel puts files named
 * by `includeFiles`.
 */
function publicFile(name: (typeof LIST_FILES)[number]): string {
  const candidates = [fileURLToPath(BESIDE_THE_CODE[name]), join(process.cwd(), 'public', name)];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`The place list ${name} is not deployed with this function: looked in ${candidates.join(' and ')}`);
  }
  return found;
}

function readList(name: (typeof LIST_FILES)[number], list: number): PlaceList {
  const file = fileSchema.parse(JSON.parse(readFileSync(publicFile(name), 'utf8')));
  return { regions: file.regions, places: file.locations.map(([id, lng, lat, country]) => ({ id, lng, lat, country, list })) };
}

interface Loaded {
  lists: readonly PlaceList[];
  byId: ReadonlyMap<string, KnownPlace>;
}

let loaded: Loaded | null = null;

/** Both lists, read and indexed once for the life of the instance, the first time anything asks. */
function all(): Loaded {
  if (!loaded) {
    const lists = LIST_FILES.map(readList);
    loaded = { lists, byId: new Map(lists.flatMap((list) => list.places.map((place) => [place.id, place] as const))) };
  }
  return loaded;
}

/** The place with this id in either list. No id is in both. */
export const knownPlace = (id: string): KnownPlace | undefined => all().byId.get(id);

/** Every place of one list. */
export const placesOf = (list: number): readonly KnownPlace[] => all().lists[list]?.places ?? [];

const COUNTRY_MAP = /^country:([A-Z]{2})$/;

/** True when `place` is on the official map `map`: anywhere for the world, else in that country or region. */
export function isOnMap(place: KnownPlace, map: string): boolean {
  if (map === 'world') {
    return true;
  }
  const country = COUNTRY_MAP.exec(map)?.[1];
  return country ? place.country === country : all().lists[place.list]?.regions[place.country] === map;
}

/** The distance, in kilometres, between the corners of the box that holds some places. */
export function diagonalKm(places: ReadonlyArray<{ lng: number; lat: number }>): number {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { lng, lat } of places) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return distanceKm({ lng: west, lat: south }, { lng: east, lat: north });
}

const scales = new Map<string, number>();

/**
 * The scale an official map's scores fall off on: the world's own, or the
 * diagonal of the map's places in one list. The two lists hold different
 * places, so a country is not quite as wide in one as in the other.
 */
export function scaleOf(map: string, list: number): number {
  if (map === 'world') {
    return WORLD_SCALE_KM;
  }
  const key = `${list}:${map}`;
  const known = scales.get(key);
  if (known !== undefined) {
    return known;
  }
  const scale = diagonalKm(placesOf(list).filter((place) => isOnMap(place, map)));
  scales.set(key, scale);
  return scale;
}
