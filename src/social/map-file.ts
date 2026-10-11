import type { Pasted, PastedPlace } from './map-paste.ts';
import { MAP_LIMITS } from './maps.ts';

/**
 * Reading a file of places in the browser, for the map editor. What comes out is what the paste
 * box makes of its lines, so both go through the same lookup, progress and summary.
 *
 * A JSON file (`.json`, `.geojson`) is one of:
 *   - a list of `[latitude, longitude]` pairs, latitude first, as the paste box has them;
 *   - a list of objects with `lat` and `lng` (also `latitude` / `longitude`, and `lon` or `long`);
 *   - a GeoJSON FeatureCollection, of which the Point features are read (longitude first, as
 *     GeoJSON has it) and every other feature is counted as not read;
 *   - the export of the map-making tools: `{ customCoordinates: [{ lat, lng, panoId? }] }`.
 *
 * A CSV file (`.csv`) is rows split by commas, semicolons or tabs, with either a header row that
 * names a latitude and a longitude column (`lat` / `latitude`, `lng` / `lon` / `long` /
 * `longitude`, in any order and among other columns), or no header and latitude then longitude
 * in the first two columns. Numbers are written with a decimal point.
 *
 * Limits: 2 MB, and as many entries as a map holds places (5,000). An entry that is no place (a
 * point off the globe, words, a row with one number) does not stop the file: it is counted, and
 * the summary says how many there were.
 */

export const FILE_LIMITS = { maxBytes: 2 * 1024 * 1024, maxPlaces: MAP_LIMITS.maxPlaces } as const;

export type FileKind = 'json' | 'csv';

/** Why a file was not read at all. */
export type FileProblem = 'type' | 'tooBig' | 'empty' | 'notJson' | 'shape' | 'noColumns' | 'tooMany';

export type FileRead = { ok: true; pasted: Pasted } | { ok: false; problem: Exclude<FileProblem, 'tooMany'> } | { ok: false; problem: 'tooMany'; count: number };

const EXTENSIONS: ReadonlyArray<[ending: string, kind: FileKind]> = [
  ['.json', 'json'],
  ['.geojson', 'json'],
  ['.csv', 'csv'],
];
const TYPES: Readonly<Record<string, FileKind>> = { 'application/json': 'json', 'application/geo+json': 'json', 'text/csv': 'csv' };

/** What the file is, by its name, or by the type the browser gives it when the name does not say. Null for anything else. */
export function kindOf(name: string, type = ''): FileKind | null {
  const lower = name.toLowerCase();
  return EXTENSIONS.find(([ending]) => lower.endsWith(ending))?.[1] ?? TYPES[type.toLowerCase()] ?? null;
}

/** What is wrong with a file of so many bytes, before it is read: nothing in it, or too much. */
export function sizeProblem(bytes: number): 'empty' | 'tooBig' | null {
  if (bytes === 0) {
    return 'empty';
  }
  return bytes > FILE_LIMITS.maxBytes ? 'tooBig' : null;
}

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;
/** Google's own panorama ids, as the paste box knows them */
const PANO_ID = /^[\w-]{22}$/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?$/;

type Row = Readonly<Record<string, unknown>>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A coordinate written as a number, or as a number in a string; anything else is none. */
function numberOf(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  return typeof value === 'string' && NUMBER.test(value.trim()) ? Number(value.trim()) : null;
}

function placeAt(lat: unknown, lng: unknown, pano: unknown = null): PastedPlace | null {
  const [latitude, longitude] = [numberOf(lat), numberOf(lng)];
  if (latitude === null || longitude === null || Math.abs(latitude) > MAX_LATITUDE || Math.abs(longitude) > MAX_LONGITUDE) {
    return null;
  }
  return { point: { lat: latitude, lng: longitude }, panoId: typeof pano === 'string' && PANO_ID.test(pano) ? pano : null };
}

/** One entry of a JSON list: a `[lat, lng]` pair, or an object that names the two. */
function entryPlace(entry: unknown): PastedPlace | null {
  if (Array.isArray(entry)) {
    return entry.length >= 2 ? placeAt(entry[0], entry[1]) : null;
  }
  if (!isRow(entry)) {
    return null;
  }
  return placeAt(entry.lat ?? entry.latitude, entry.lng ?? entry.lon ?? entry.long ?? entry.longitude, entry.panoId);
}

/** One feature of a GeoJSON collection: a Point, whose coordinates are longitude then latitude. */
function featurePlace(feature: unknown): PastedPlace | null {
  const geometry = isRow(feature) ? feature.geometry : null;
  if (!isRow(geometry) || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
    return null;
  }
  return placeAt(geometry.coordinates[1], geometry.coordinates[0]);
}

/** Every entry read as a place or counted; a list with nothing in it, or with more than a map holds, is refused whole. */
function readEntries(entries: readonly unknown[], read: (entry: unknown) => PastedPlace | null): FileRead {
  if (entries.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  if (entries.length > FILE_LIMITS.maxPlaces) {
    return { ok: false, problem: 'tooMany', count: entries.length };
  }
  const places = entries.map(read).filter((place) => place !== null);
  return { ok: true, pasted: { places, unread: entries.length - places.length } };
}

function parseJson(text: string): FileRead {
  if (text.trim() === '') {
    return { ok: false, problem: 'empty' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'notJson' };
  }
  if (Array.isArray(value)) {
    return readEntries(value, entryPlace);
  }
  if (isRow(value) && Array.isArray(value.customCoordinates)) {
    return readEntries(value.customCoordinates, entryPlace);
  }
  if (isRow(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return readEntries(value.features, featurePlace);
  }
  return { ok: false, problem: 'shape' };
}

const LATITUDE_NAMES = ['lat', 'latitude'];
const LONGITUDE_NAMES = ['lng', 'lon', 'long', 'longitude'];
const SEPARATORS = [',', ';', '\t'];

/** The cells of a row, without the quotes a spreadsheet puts around them. */
const cellsOf = (row: string, separator: string): string[] => row.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim());

/** What splits the rows' cells: whichever of comma, semicolon and tab the first row has most of. */
const separatorOf = (row: string): string => SEPARATORS.reduce((best, each) => (row.split(each).length > row.split(best).length ? each : best), SEPARATORS[0]!);

function parseCsv(text: string): FileRead {
  const rows = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row !== '');
  if (rows.length === 0) {
    return { ok: false, problem: 'empty' };
  }
  const separator = separatorOf(rows[0]!);
  const first = cellsOf(rows[0]!, separator);
  // a first row that is not all numbers names the columns
  const headed = first.some((cell) => numberOf(cell) === null);
  const names = first.map((cell) => cell.toLowerCase());
  const [lat, lng] = headed ? [names.findIndex((name) => LATITUDE_NAMES.includes(name)), names.findIndex((name) => LONGITUDE_NAMES.includes(name))] : [0, 1];
  if (lat < 0 || lng < 0) {
    return { ok: false, problem: 'noColumns' };
  }
  return readEntries(headed ? rows.slice(1) : rows, (row) => {
    const cells = cellsOf(row as string, separator);
    return placeAt(cells[lat], cells[lng]);
  });
}

/** Reads the text of a file of places. See the top of this file for the shapes it takes. */
export function parsePlacesFile(kind: FileKind, text: string): FileRead {
  return kind === 'json' ? parseJson(text) : parseCsv(text);
}
