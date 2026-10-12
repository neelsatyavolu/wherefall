import { inflateRawSync } from 'node:zlib';
import type { Rng } from '../../src/game/rng.ts';

/** A populated place, as GeoNames lists it. */
export interface Town {
  lng: number;
  lat: number;
  population: number;
}

/** GeoNames lists a seat of local government whatever its size, some with no count: such a town is taken as the smallest listed. */
const MIN_POPULATION = 1000;
const LAT_COLUMN = 4;
const LNG_COLUMN = 5;
const POPULATION_COLUMN = 14;

/** The towns of a GeoNames table (`cities1000.txt`): one tab-separated row for each. */
export function parseTowns(table: string): Town[] {
  return table
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== '')
    .map(({ line, number }) => {
      const columns = line.split('\t');
      const [lat, lng, population] = [LAT_COLUMN, LNG_COLUMN, POPULATION_COLUMN].map((column) => Number(columns[column] ?? NaN)) as [number, number, number];
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && population >= 0)) {
        throw new Error(`Not a GeoNames table of towns: line ${number} has no place and population`);
      }
      return { lng, lat, population: Math.max(MIN_POPULATION, population) };
    });
}

/** how densely a town is taken to be built, to turn its population into the ground it covers */
const PEOPLE_PER_KM2 = 3000;
const MIN_RADIUS_KM = 0.4;
const MAX_RADIUS_KM = 25;

/** How far a town reaches from its centre: the radius of a disc that holds its people. */
export function townRadiusKm(population: number): number {
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Math.sqrt(population / (Math.PI * PEOPLE_PER_KM2))));
}

/** A draw among towns in which each comes up as often as it is populous. */
export function populationDraw(towns: readonly Town[]): (rng: Rng) => Town {
  if (towns.length === 0) {
    throw new Error('No towns to draw from');
  }
  // appended in place: a large country has many thousands of towns, and copying the list for each would take minutes
  const runningTotals: number[] = [];
  let total = 0;
  for (const town of towns) {
    total += town.population;
    runningTotals.push(total);
  }
  return (rng) => {
    const mark = rng() * total;
    return towns[runningTotals.findIndex((sum) => sum > mark)] ?? towns.at(-1)!;
  };
}

const KM_PER_DEGREE = 111.32;

/** A point drawn evenly over the ground a town covers. */
export function pointInTown(town: Town, rng: Rng): [lng: number, lat: number] {
  // the square root spreads the points over the disc's area; without it they crowd the centre
  const km = townRadiusKm(town.population) * Math.sqrt(rng());
  const bearing = rng() * 2 * Math.PI;
  const kmPerDegreeLng = KM_PER_DEGREE * Math.cos((town.lat * Math.PI) / 180);
  return [town.lng + (km * Math.sin(bearing)) / kmPerDegreeLng, town.lat + (km * Math.cos(bearing)) / KM_PER_DEGREE];
}

const END_RECORD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const STORED = 0;
const DEFLATED = 8;

/** The file inside a zip archive of one file, which is how GeoNames ships its tables. */
export function unzipSingle(zip: Buffer): Buffer {
  const end = zip.lastIndexOf(END_RECORD);
  if (end < 0) {
    throw new Error('Not a zip archive');
  }
  // the directory at the end of the archive says how the file is packed and where it starts
  const entry = zip.readUInt32LE(end + 16);
  const method = zip.readUInt16LE(entry + 10);
  const packedSize = zip.readUInt32LE(entry + 20);
  const header = zip.readUInt32LE(entry + 42);
  const start = header + 30 + zip.readUInt16LE(header + 26) + zip.readUInt16LE(header + 28);
  const packed = zip.subarray(start, start + packedSize);
  if (method === STORED) {
    return packed;
  }
  if (method !== DEFLATED) {
    throw new Error(`The zip archive is packed in a way this cannot read (method ${method})`);
  }
  return inflateRawSync(packed);
}
