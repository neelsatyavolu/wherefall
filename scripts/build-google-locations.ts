// Builds public/locations.google.json: places with official Google Street View, worldwide.
//
//   GOOGLE_MAPS_KEY=... pnpm locations:google              every country Google covers
//   GOOGLE_MAPS_KEY=... ONLY=MN,KE pnpm locations:google   a few, written to locations.google.sample.json
//
// How it works: random points are dropped inside each country and Google is asked for the
// nearest outdoor panorama (the Street View Static API's metadata lookup, which is free).
// Only Google's own captures are kept; user-uploaded photo spheres are skipped.
// The key must have the Street View Static API enabled. It is never written anywhere.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { featuresContaining, iso1A2Code } from '@rapideditor/country-coder';
import { createRng, type Rng } from '../src/game/rng.ts';
import { areaFromHits, quotaForArea, randomGlobePoint, regionForGroups, settleRegions } from './lib/sampling.ts';

const KEY = process.env.GOOGLE_MAPS_KEY;
if (!KEY) {
  throw new Error('Set GOOGLE_MAPS_KEY to a key with the Street View Static API enabled');
}
const SEED = process.env.SEED ?? 'plonk-google-1';
const ONLY = process.env.ONLY?.split(',').map((cc) => cc.trim().toUpperCase()) ?? null;
/** LOCATIONS_OUT writes the set somewhere else, so a rebuild can be checked before it replaces the live one */
const OUTPUT = process.env.LOCATIONS_OUT
  ? pathToFileURL(process.env.LOCATIONS_OUT)
  : new URL(ONLY ? '../locations.google.sample.json' : '../public/locations.google.json', import.meta.url);
/** lookups present themselves as coming from the site, so they keep working if the key is restricted to it */
const REFERER = process.env.GOOGLE_MAPS_REFERER ?? 'https://plonk-two.vercel.app/';

const METADATA = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const GLOBE_SAMPLES = 600_000;
/** lookup radius starts small, so places are not all on the edge of coverage, and widens where roads are sparse */
const START_RADIUS_M = 2_000;
const MAX_RADIUS_M = 128_000;
const WIDEN_AFTER = 30;
const MIN_ACCEPT_RATE = 0.15;
/** attempts with nothing found, at the widest radius, before a country is taken to have no coverage */
const GIVE_UP_AFTER = 60;
const ATTEMPTS_PER_LOCATION = 14;
/** first-generation imagery is too blurry to play on */
const MIN_YEAR = 2009;
const SPACING_DEG = 0.02;
/** once coverage is found, this share of new points is drawn near it rather than anywhere in the country */
const NEAR_FOUND_SHARE = 0.6;
const NEAR_FOUND_DEG = 0.6;
const MIN_FOUND_TO_FOLLOW = 5;
const CONCURRENT_REQUESTS = 40;
/** lookups fired together for one country */
const BATCH = 10;
const RETRIES = 3;
const MAX_FAILED_REQUESTS = 60;

const log = (line: string) => process.stdout.write(`${line}\n`);

type Row = [id: string, lng: number, lat: number, country: string];
type Point = [lng: number, lat: number];

const territoryCode = (lng: number, lat: number) => iso1A2Code([lng, lat], { level: 'territory' });

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

interface Metadata {
  status: string;
  pano_id?: string;
  location?: { lat: number; lng: number };
  copyright?: string;
  date?: string;
}

async function nearestPanorama([lng, lat]: Point, radius: number): Promise<Metadata | null> {
  const query = new URLSearchParams({ location: `${lat.toFixed(6)},${lng.toFixed(6)}`, radius: String(radius), source: 'outdoor', key: KEY! });
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await withSlot(() => fetch(`${METADATA}?${query}`, { headers: { Referer: REFERER } }));
      const body = (await response.json()) as Metadata;
      if (body.status === 'REQUEST_DENIED') {
        throw new Error('Google refused the key: is the Street View Static API enabled and the referrer allowed?');
      }
      if (body.status === 'OK' || body.status === 'ZERO_RESULTS') {
        return body;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Google refused')) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * attempt ** 2));
  }
  failedRequests++;
  return null;
}

// --- where the countries are -----------------------------------------------------------------

interface Country {
  code: string;
  /** points known to lie inside, used as seeds for drawing more */
  inside: Point[];
  areaKm2: number;
}

/** Throws points all over the globe and sorts them by country: gives each country's area and where it is. */
function surveyCountries(rng: Rng): Country[] {
  const byCode = new Map<string, Point[]>();
  for (let i = 0; i < GLOBE_SAMPLES; i++) {
    const point = randomGlobePoint(rng);
    const code = territoryCode(point[0], point[1]);
    if (!code) {
      continue;
    }
    // appended in place: copying the list on every one of 600,000 points would never finish
    const points = byCode.get(code);
    if (points) {
      points.push(point);
    } else {
      byCode.set(code, [point]);
    }
  }
  return [...byCode]
    .map(([code, inside]) => ({ code, inside, areaKm2: areaFromHits(inside.length, GLOBE_SAMPLES) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** A fresh point inside the country: near one of its known interior points, checked to still be inside. */
function pointInside(country: Country, rng: Rng): Point {
  // how far to wander from a seed: about the spacing between seeds, so the whole country is reachable
  const spreadDeg = Math.min(8, Math.max(0.05, Math.sqrt(country.areaKm2 / country.inside.length) / 111));
  for (let tries = 0; tries < 200; tries++) {
    const [lng, lat] = country.inside[Math.floor(rng() * country.inside.length)]!;
    const candidate: Point = [lng + (rng() * 2 - 1) * spreadDeg, Math.max(-85, Math.min(85, lat + (rng() * 2 - 1) * spreadDeg))];
    if (territoryCode(candidate[0], candidate[1]) === country.code) {
      return candidate;
    }
  }
  return country.inside[Math.floor(rng() * country.inside.length)]!;
}

// --- sampling one country --------------------------------------------------------------------

function officialAndUsable(found: Metadata, country: string): found is Metadata & { pano_id: string; location: { lat: number; lng: number } } {
  const year = Number(found.date?.slice(0, 4));
  return (
    found.status === 'OK' &&
    typeof found.pano_id === 'string' &&
    found.location !== undefined &&
    found.copyright === '© Google' &&
    year >= MIN_YEAR &&
    territoryCode(found.location.lng, found.location.lat) === country
  );
}

async function sampleCountry(country: Country): Promise<Row[]> {
  const rng = createRng(`${SEED}:${country.code}`);
  const quota = quotaForArea(country.areaKm2);
  const occupied = new Set<string>();
  const rows: Row[] = [];
  let radius = START_RADIUS_M;
  let sinceWidened = 0;
  let acceptedSinceWidened = 0;

  // A country's outline includes its coastal waters, and much of some countries has no roads.
  // Following what has already been found keeps most lookups on land that Google has driven,
  // while the rest still explore the whole country.
  const nextPoint = (): Point => {
    if (rows.length < MIN_FOUND_TO_FOLLOW || rng() > NEAR_FOUND_SHARE) {
      return pointInside(country, rng);
    }
    const [, lng, lat] = rows[Math.floor(rng() * rows.length)]!;
    return [lng + (rng() * 2 - 1) * NEAR_FOUND_DEG, Math.max(-85, Math.min(85, lat + (rng() * 2 - 1) * NEAR_FOUND_DEG))];
  };

  for (let attempt = 0; rows.length < quota && attempt < quota * ATTEMPTS_PER_LOCATION; attempt += BATCH) {
    // one lookup at a time would take a large country a quarter of an hour
    const points = Array.from({ length: BATCH }, nextPoint);
    const results = await Promise.all(points.map((point) => nearestPanorama(point, radius)));
    sinceWidened += BATCH;
    for (const found of results) {
      if (rows.length >= quota || !found || !officialAndUsable(found, country.code)) {
        continue;
      }
      const bucket = `${Math.round(found.location.lng / SPACING_DEG)}:${Math.round(found.location.lat / SPACING_DEG)}`;
      if (!occupied.has(bucket)) {
        occupied.add(bucket);
        acceptedSinceWidened++;
        rows.push([found.pano_id, Number(found.location.lng.toFixed(6)), Number(found.location.lat.toFixed(6)), country.code]);
      }
    }
    const struggling = sinceWidened >= WIDEN_AFTER && acceptedSinceWidened / sinceWidened < MIN_ACCEPT_RATE;
    if (struggling && radius < MAX_RADIUS_M) {
      radius *= 4;
      sinceWidened = 0;
      acceptedSinceWidened = 0;
    } else if (struggling && rows.length === 0 && sinceWidened >= GIVE_UP_AFTER) {
      break;
    }
  }
  if (rows.length > 0) {
    log(`${country.code}: ${rows.length}/${quota} (area ${Math.round(country.areaKm2).toLocaleString('en-US')} km², radius ${radius / 1000} km)`);
  }
  return rows;
}

// --- main ------------------------------------------------------------------------------------

const countries = surveyCountries(createRng(SEED)).filter((country) => !ONLY || ONLY.includes(country.code));
log(`Sampling ${countries.length} countries and territories (seed ${SEED})`);

const queue = [...countries];
const collected: Row[][] = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      collected.push(await sampleCountry(next));
    }
  }),
);

if (failedRequests > MAX_FAILED_REQUESTS) {
  throw new Error(`${failedRequests} requests failed: refusing to write a thin dataset`);
}

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
log(`Wrote ${locations.length} locations in ${new Set(locations.map((row) => row[3])).size} countries and territories`);
