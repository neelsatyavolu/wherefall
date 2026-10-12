import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/game/rng.ts';
import { parseTowns, pointInTown, populationDraw, townRadiusKm, unzipSingle, type Town } from './towns.ts';

/** A GeoNames row: nineteen tab-separated columns, of which the builder reads latitude, longitude and population. */
const row = (name: string, lat: string, lng: string, population: string) =>
  ['1', name, name, '', lat, lng, 'P', 'PPL', 'FR', '', '', '', '', '', population, '', '', 'Europe/Paris', '2024-01-01'].join('\t');

describe('parseTowns', () => {
  it('reads where each town is and how many live there', () => {
    expect(parseTowns(`${row('Paris', '48.85341', '2.3488', '2138551')}\n${row('Uzès', '44.01667', '4.41667', '8569')}\n`)).toEqual([
      { lng: 2.3488, lat: 48.85341, population: 2138551 },
      { lng: 4.41667, lat: 44.01667, population: 8569 },
    ]);
  });

  it('counts a town listed without a population as the smallest the list holds', () => {
    expect(parseTowns(row('Seat', '10', '20', '0'))[0]?.population).toBe(1000);
  });

  it('refuses a table that is not the one expected', () => {
    expect(() => parseTowns('<html>moved</html>')).toThrow(/line 1/);
    expect(() => parseTowns(row('Nowhere', '95', '20', '5000'))).toThrow(/line 1/);
  });
});

describe('townRadiusKm', () => {
  it('keeps a village to its few streets', () => {
    expect(townRadiusKm(1000)).toBe(0.4);
  });

  it('grows with the square root of the population', () => {
    expect(townRadiusKm(400_000) / townRadiusKm(100_000)).toBeCloseTo(2, 5);
    expect(townRadiusKm(1_000_000)).toBeCloseTo(10.3, 1);
  });

  it('caps the largest cities', () => {
    expect(townRadiusKm(30_000_000)).toBe(25);
  });
});

describe('populationDraw', () => {
  it('draws a town as often as it is populous', () => {
    const city: Town = { lng: 0, lat: 0, population: 9000 };
    const village: Town = { lng: 1, lat: 1, population: 1000 };
    const draw = populationDraw([village, city]);
    const rng = createRng('towns');
    const cityShare = Array.from({ length: 4000 }, () => draw(rng)).filter((town) => town === city).length / 4000;
    expect(cityShare).toBeGreaterThan(0.87);
    expect(cityShare).toBeLessThan(0.93);
  });

  it('refuses to draw from no towns', () => {
    expect(() => populationDraw([])).toThrow();
  });
});

describe('pointInTown', () => {
  const kmBetween = ([lngA, latA]: readonly [number, number], [lngB, latB]: readonly [number, number]) => {
    const rad = Math.PI / 180;
    const h = Math.sin(((latB - latA) * rad) / 2) ** 2 + Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(((lngB - lngA) * rad) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  it('stays inside the town and does not crowd its centre', () => {
    // Oslo, far enough north that a degree of longitude is half a degree of latitude
    const town: Town = { lng: 10.75, lat: 59.91, population: 580_000 };
    const radius = townRadiusKm(town.population);
    const rng = createRng('oslo');
    const distances = Array.from({ length: 2000 }, () => kmBetween(pointInTown(town, rng), [town.lng, town.lat]));
    expect(Math.max(...distances)).toBeLessThanOrEqual(radius * 1.01);
    // half of a disc's area lies beyond 71% of its radius
    const outerShare = distances.filter((km) => km > radius * Math.SQRT1_2).length / distances.length;
    expect(outerShare).toBeGreaterThan(0.45);
    expect(outerShare).toBeLessThan(0.55);
  });
});

describe('unzipSingle', () => {
  /** A zip archive of one file, laid out as the format has it: the file, the directory, the end record. */
  function zipOf(name: string, content: Buffer, method: 0 | 8): Buffer {
    const data = method === 8 ? deflateRawSync(content) : content;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + data.length, 16);
    return Buffer.concat([local, Buffer.from(name), data, central, Buffer.from(name), end]);
  }

  it('gives back the file a zip archive holds', () => {
    const table = Buffer.from('one\ttwo\n'.repeat(500));
    expect(unzipSingle(zipOf('cities.txt', table, 8)).equals(table)).toBe(true);
    expect(unzipSingle(zipOf('cities.txt', table, 0)).equals(table)).toBe(true);
  });

  it('refuses what is not a zip archive', () => {
    expect(() => unzipSingle(Buffer.from('<html>not found</html>'))).toThrow(/zip/);
  });
});
