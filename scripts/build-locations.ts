// Builds public/locations.json: a country-balanced sample of 360° pictures from Panoramax.
//
//   pnpm locations              full build (several thousand polite requests, takes a while)
//   ONLY=LU,AD pnpm locations   a few countries, written to locations.sample.json for trying changes
//
// How it works: Panoramax publishes a coverage grid in its vector tiles. We read where 360°
// imagery exists, give each country a quota, then for each chosen cell pick a random point on a
// random 360° sequence and ask the API for the actual picture there.
import { writeFile } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { featuresContaining, iso1A2Code } from '@rapideditor/country-coder';
import { PbfReader } from 'pbf';
import { createRng, type Rng } from '../src/game/rng.ts';
import { quotaFor, regionForGroups, settleRegions, tilesNear, type Tile } from './lib/sampling.ts';

const API = 'https://api.panoramax.xyz/api';
const USER_AGENT = 'plonk-location-builder/1.0 (one-off dataset build)';

const SEED = process.env.SEED ?? 'plonk-1';
const ONLY = process.env.ONLY?.split(',').map((cc) => cc.trim().toUpperCase()) ?? null;
// a partial run must never replace the real dataset
const OUTPUT = new URL(ONLY ? '../locations.sample.json' : '../public/locations.json', import.meta.url);

const MIN_CELL_PANOS = 200;
const MIN_COUNTRY_PANOS = 1000;
const SEQUENCE_ZOOM = 11;
const CELL_REACH_DEG = 0.08;
const SEARCH_BOX_DEG = 0.0008;
const MAX_GPS_ERROR_M = 20;
const MIN_IMAGE_WIDTH = 3800;
/** bucket size used to keep picked locations apart (about a kilometre) */
const SPACING_DEG = 0.01;
const ATTEMPTS_PER_LOCATION = 5;
const CONCURRENT_REQUESTS = 6;
const CONCURRENT_COUNTRIES = 8;
const RETRIES = 3;
/** more failed requests than this means Panoramax was struggling: the sample would be thin, so abort */
const MAX_FAILED_REQUESTS = 25;

const log = (line: string) => process.stdout.write(`${line}\n`);

interface Cell {
  lng: number;
  lat: number;
  panos: number;
}

type Row = [id: string, lng: number, lat: number, country: string];

// --- polite fetching -------------------------------------------------------------------------

let active = 0;
let failedRequests = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function request(url: string): Promise<Response | null> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await withSlot(() => fetch(url, { headers: { 'User-Agent': USER_AGENT } }));
      if (response.ok) {
        return response;
      }
      if (response.status === 404 || response.status === 204) {
        return null;
      }
    } catch {
      // network hiccup: fall through to the retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt ** 2));
  }
  failedRequests++;
  return null;
}

async function fetchTile(zoom: number, tile: Tile): Promise<VectorTile | null> {
  const response = await request(`${API}/map/${zoom}/${tile.x}/${tile.y}.mvt`);
  if (!response) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 ? new VectorTile(new PbfReader(bytes)) : null;
}

/** Territory level, so that overseas parts (Réunion, Tahiti) are places of their own, not "France". */
const territoryCode = (lng: number, lat: number) => iso1A2Code([lng, lat], { level: 'territory' });

// --- reading coverage ------------------------------------------------------------------------

async function readCoverage(): Promise<Map<string, Cell[]>> {
  const world = await fetchTile(0, { x: 0, y: 0 });
  const grid = world?.layers.grid;
  if (!grid) {
    throw new Error('Panoramax world tile has no coverage grid');
  }
  const byCountry = new Map<string, Cell[]>();
  for (let i = 0; i < grid.length; i++) {
    const cell = grid.feature(i);
    const panos = Number(cell.properties.nb_360_pictures ?? 0);
    const geometry = cell.toGeoJSON(0, 0, 0).geometry;
    if (panos < MIN_CELL_PANOS || geometry.type !== 'Point') {
      continue;
    }
    const [lng, lat] = geometry.coordinates as [number, number];
    const country = territoryCode(lng, lat);
    if (country) {
      byCountry.set(country, [...(byCountry.get(country) ?? []), { lng, lat, panos }]);
    }
  }
  return byCountry;
}

const sequencePointCache = new Map<string, Promise<Array<[number, number]>>>();

/** Points along the 360° sequences drawn in one tile. */
function sequencePoints(tile: Tile): Promise<Array<[number, number]>> {
  const key = `${tile.x}/${tile.y}`;
  const cached = sequencePointCache.get(key);
  if (cached) {
    return cached;
  }
  const loading = fetchTile(SEQUENCE_ZOOM, tile).then((vectorTile) => {
    const layer = vectorTile?.layers.sequences;
    const points: Array<[number, number]> = [];
    for (let i = 0; layer && i < layer.length; i++) {
      const sequence = layer.feature(i);
      if (sequence.properties.type !== 'equirectangular') {
        continue;
      }
      const geometry = sequence.toGeoJSON(tile.x, tile.y, SEQUENCE_ZOOM).geometry;
      const lines =
        geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
      for (const line of lines) {
        // one point per sequence part, so long sequences do not dominate the draw
        const middle = line[Math.floor(line.length / 2)];
        if (middle) {
          points.push([middle[0]!, middle[1]!]);
        }
      }
    }
    return points;
  });
  sequencePointCache.set(key, loading);
  return loading;
}

async function sequencePointsNear(cell: Cell): Promise<Array<[number, number]>> {
  for (const tile of tilesNear(cell.lng, cell.lat, SEQUENCE_ZOOM, CELL_REACH_DEG)) {
    const points = await sequencePoints(tile);
    if (points.length > 0) {
      return points;
    }
  }
  return [];
}

// --- picking pictures ------------------------------------------------------------------------

interface Picture {
  id: string;
  lng: number;
  lat: number;
}

function usablePicture(raw: any): Picture | null {
  const props = raw?.properties ?? {};
  const orientation = props['pers:interior_orientation'] ?? {};
  const [lng, lat] = raw?.geometry?.coordinates ?? [];
  const width = orientation.sensor_array_dimensions?.[0];
  const gpsError = props['quality:horizontal_accuracy'];
  const usable =
    typeof raw?.id === 'string' &&
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    orientation.field_of_view === 360 &&
    props['geovisio:status'] === 'ready' &&
    typeof raw.assets?.sd?.href === 'string' &&
    (typeof width !== 'number' || width >= MIN_IMAGE_WIDTH) &&
    (typeof gpsError !== 'number' || gpsError <= MAX_GPS_ERROR_M);
  return usable ? { id: raw.id, lng, lat } : null;
}

async function picturesAt(lng: number, lat: number): Promise<Picture[]> {
  const d = SEARCH_BOX_DEG;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((v) => v.toFixed(6)).join(',');
  const response = await request(`${API}/search?bbox=${bbox}&limit=10&filter=${encodeURIComponent('field_of_view=360')}`);
  if (!response) {
    return [];
  }
  const body = (await response.json()) as { features?: unknown[] };
  return (body.features ?? []).flatMap((raw) => usablePicture(raw) ?? []);
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function sampleCountry(country: string, cells: readonly Cell[]): Promise<Row[]> {
  const rng = createRng(`${SEED}:${country}`);
  const quota = quotaFor(cells.length);
  const order = shuffled(cells, rng);
  const occupied = new Set<string>();
  const rows: Row[] = [];

  for (let attempt = 0; rows.length < quota && attempt < quota * ATTEMPTS_PER_LOCATION; attempt++) {
    const cell = order[attempt % order.length]!;
    const points = await sequencePointsNear(cell);
    if (points.length === 0) {
      continue;
    }
    const [lng, lat] = pick(points, rng);
    const candidates = (await picturesAt(lng, lat)).filter((p) => territoryCode(p.lng, p.lat) === country);
    if (candidates.length === 0) {
      continue;
    }
    const picture = pick(candidates, rng);
    const bucket = `${Math.round(picture.lng / SPACING_DEG)}:${Math.round(picture.lat / SPACING_DEG)}`;
    if (occupied.has(bucket)) {
      continue;
    }
    occupied.add(bucket);
    rows.push([picture.id, Number(picture.lng.toFixed(6)), Number(picture.lat.toFixed(6)), country]);
  }
  log(`${country}: ${rows.length}/${quota} locations from ${cells.length} cells`);
  return rows;
}

// --- main ------------------------------------------------------------------------------------

const coverage = await readCoverage();
const countries = [...coverage.entries()]
  .filter(([country, cells]) => (ONLY ? ONLY.includes(country) : cells.reduce((sum, c) => sum + c.panos, 0) >= MIN_COUNTRY_PANOS))
  .sort(([a], [b]) => a.localeCompare(b));
log(`Sampling ${countries.length} countries (seed ${SEED})`);

const queue = [...countries];
const collected: Row[][] = [];
await Promise.all(
  Array.from({ length: CONCURRENT_COUNTRIES }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      collected.push(await sampleCountry(next[0], next[1]));
    }
  }),
);

if (failedRequests > MAX_FAILED_REQUESTS) {
  throw new Error(`${failedRequests} requests failed: refusing to write a thin dataset`);
}

// Region comes from where each picture is, not from its country code alone.
const { regions, kept } = settleRegions(
  collected.flat().map((row) => ({
    row,
    country: row[3],
    region: regionForGroups(featuresContaining([row[1], row[2]]).map((f) => f.properties.id)),
  })),
);
const locations = kept.map(({ row }) => row).sort((a, b) => a[3].localeCompare(b[3]) || a[0].localeCompare(b[0]));

if (locations.length === 0) {
  throw new Error('No locations found: refusing to overwrite the dataset');
}
await writeFile(OUTPUT, `${JSON.stringify({ version: 1, generated: new Date().toISOString().slice(0, 10), regions, locations })}\n`);
log(`Wrote ${locations.length} locations in ${new Set(locations.map((row) => row[3])).size} countries`);
