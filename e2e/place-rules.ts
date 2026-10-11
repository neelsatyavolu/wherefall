import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { continentOf } from '../src/game/continents.ts';
import { createRng, pickDistinct } from '../src/game/rng.ts';

/**
 * What the server knows about places, for the stand-in servers (wave-6 contract, sections 4 to 7):
 * a saved round, a run's round and a claimed daily name their place by id, and are taken only when
 * the place is in one of the two lists (or on the community map) where that list has it.
 */

export type PlaceRow = [id: string, lng: number, lat: number, country: string];

/** A list of places as its file holds it. */
export interface PlaceFile {
  regions: Record<string, string>;
  locations: PlaceRow[];
}

export interface KnownPlace {
  id: string;
  lng: number;
  lat: number;
  country: string;
  /** which of the two files the place is in: 0 the Google list, 1 the open one */
  list: number;
}

/** A place as a browser names it. */
export interface SentPlace {
  id: string;
  lng: number;
  lat: number;
}

/** How far a coordinate sent may be from the list's own, in degrees. */
const TOLERANCE_DEGREES = 0.0001;
/** A daily's places are among the first hundred the day's seed puts their list in, in three countries on two continents. */
const DAILY_WINDOW = 100;
const DAILY_COUNTRIES = 3;
const DAILY_CONTINENTS = 2;

const FILES = ['locations.google.json', 'locations.json'] as const;
const real: Array<PlaceFile | undefined> = [];

/** One of the two real lists, read from `public/` the first time it is needed. */
function realList(list: number): PlaceFile {
  real[list] ??= JSON.parse(readFileSync(join(process.cwd(), 'public', FILES[list]!), 'utf8')) as PlaceFile;
  return real[list]!;
}

/** the stand-in list a page was served in place of `/locations.json`, when a test gave it one */
const served = new WeakMap<Page, PlaceFile>();
/** the community maps of a page's `MapsServer`, as they are stored now */
const community = new WeakMap<Page, () => ReadonlyArray<{ slug: string; locations: PlaceRow[] }>>();

/** `mockPlaces` tells the stand-in servers which list the page plays from. */
export function servePlaces(page: Page, places: unknown): void {
  const file = places as Partial<PlaceFile> | null;
  if (file && Array.isArray(file.locations)) {
    served.set(page, { regions: file.regions ?? {}, locations: file.locations });
  }
}

/** A `MapsServer` tells the stand-in servers where its maps are. */
export function serveCommunityMaps(page: Page, maps: () => ReadonlyArray<{ slug: string; locations: PlaceRow[] }>): void {
  community.set(page, maps);
}

/** The two lists the server of this page knows: the real Google list, and the open list the page is served. */
export const listsFor = (page: Page | null): PlaceFile[] => [realList(0), (page && served.get(page)) ?? realList(1)];

/** The places of a community map on this page as stored now, or null when there is no such map. */
export function communityRows(page: Page | null, map: string): PlaceRow[] | null {
  const slug = map.startsWith('community:') ? map.slice('community:'.length) : null;
  const maps = page ? community.get(page)?.() : undefined;
  return (slug !== null && maps?.find((each) => each.slug === slug)?.locations) || null;
}

const indexes = new WeakMap<PlaceFile, Map<string, PlaceRow>>();

function rowOf(file: PlaceFile, id: string): PlaceRow | undefined {
  if (!indexes.has(file)) {
    indexes.set(file, new Map(file.locations.map((row) => [row[0], row])));
  }
  return indexes.get(file)!.get(id);
}

/** The place with this id in either list. */
export function knownPlace(lists: readonly PlaceFile[], id: string): KnownPlace | null {
  for (const [list, file] of lists.entries()) {
    const row = rowOf(file, id);
    if (row) {
      return { id: row[0], lng: row[1], lat: row[2], country: row[3], list };
    }
  }
  return null;
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_DEGREES;
const sameSpot = (sent: SentPlace, known: { lng: number; lat: number }) => near(sent.lng, known.lng) && near(sent.lat, known.lat);

function isOnMap(place: KnownPlace, map: string, lists: readonly PlaceFile[]): boolean {
  if (map === 'world') {
    return true;
  }
  const country = /^country:([A-Z]{2})$/.exec(map)?.[1];
  return country ? place.country === country : lists[place.list]?.regions[place.country] === map;
}

export interface CheckedPlaces {
  places: KnownPlace[];
  /** which list the places are from; null for a community map */
  list: number | null;
}

/**
 * The places a browser names, as the server knows them. Null when any is not a place of the map:
 * not in a list under that id, not where the list has it, in another country or region, from the
 * other list than the rest, or sent twice. For a community map `rows` are its places, null when it is gone.
 */
export function checkPlaces(lists: readonly PlaceFile[], map: string, sent: readonly SentPlace[], rows: readonly PlaceRow[] | null): CheckedPlaces | null {
  if (sent.length === 0) {
    return null;
  }
  if (map.startsWith('community:')) {
    // a row is itself an array, so each one found is wrapped before the list is flattened
    const found = sent.flatMap((place) => (rows ?? []).filter(([id, lng, lat]) => id === place.id && sameSpot(place, { lng, lat })).slice(0, 1));
    return found.length === sent.length ? { places: found.map(([id, lng, lat, country]) => ({ id, lng, lat, country, list: -1 })), list: null } : null;
  }
  const known = sent.map((place) => {
    const found = knownPlace(lists, place.id);
    return found && sameSpot(place, found) && isOnMap(found, map, lists) ? found : null;
  });
  const places = known.filter((place) => place !== null);
  const first = places[0];
  const sound = first && places.length === sent.length && places.every((place) => place.list === first.list) && new Set(sent.map((place) => place.id)).size === sent.length;
  return sound ? { places, list: first.list } : null;
}

/** The seed every player's daily is drawn with on a UTC day (YYYY-MM-DD). */
export const dailySeed = (date: string): string => `daily${date.replaceAll('-', '')}`;

/** True when `places`, all from the list `list`, could be the daily of `seed`. */
export function isDailyDraw(lists: readonly PlaceFile[], places: readonly KnownPlace[], list: number | null, seed: string): boolean {
  const file = list === null ? undefined : lists[list];
  if (!file || places.length !== DAILY_COUNTRIES) {
    return false;
  }
  const window = new Set(pickDistinct(file.locations, file.locations.length, createRng(seed)).slice(0, DAILY_WINDOW).map(([id]) => id));
  const continents = new Set(places.map(continentOf).filter((continent) => continent !== null));
  return places.every((place) => window.has(place.id)) && new Set(places.map((place) => place.country)).size === DAILY_COUNTRIES && continents.size >= DAILY_CONTINENTS;
}

/** The continent the server counts a place in, for Continent Guesser. */
export const continentOfPlace = (place: KnownPlace): string | null => continentOf(place);
