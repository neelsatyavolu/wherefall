import { describe, expect, it } from 'vitest';
import { FILE_LIMITS, kindOf, parsePlacesFile, sizeProblem } from './map-file.ts';
import type { PastedPlace } from './map-paste.ts';

const PANO = 'AbCdEfGhIjKlMnOpQrSt-_';
const at = (lat: number, lng: number, panoId: string | null = null): PastedPlace => ({ point: { lat, lng }, panoId });
const json = (value: unknown) => parsePlacesFile('json', JSON.stringify(value));
const csv = (text: string) => parsePlacesFile('csv', text);

describe('which kind of file it is', () => {
  it('goes by the name: .json, .geojson and .csv, in any case', () => {
    expect(kindOf('places.json')).toBe('json');
    expect(kindOf('Places.GEOJSON')).toBe('json');
    expect(kindOf('my places.CSV')).toBe('csv');
  });

  it('falls back on the type the browser gives a file with another name', () => {
    expect(kindOf('places', 'application/json')).toBe('json');
    expect(kindOf('places', 'application/geo+json')).toBe('json');
    expect(kindOf('places.txt', 'text/csv')).toBe('csv');
  });

  it('is nothing for any other file', () => {
    expect(kindOf('places.xlsx', 'application/vnd.ms-excel')).toBeNull();
    expect(kindOf('places.txt', 'text/plain')).toBeNull();
    expect(kindOf('json')).toBeNull();
  });
});

describe('how big a file may be', () => {
  it('takes a file up to the limit and refuses one over it or with nothing in it', () => {
    expect(sizeProblem(1)).toBeNull();
    expect(sizeProblem(FILE_LIMITS.maxBytes)).toBeNull();
    expect(sizeProblem(FILE_LIMITS.maxBytes + 1)).toBe('tooBig');
    expect(sizeProblem(0)).toBe('empty');
  });
});

describe('a JSON file', () => {
  it('reads a list of [latitude, longitude] pairs', () => {
    expect(json([[48.8566, 2.3522], [-33.8688, 151.2093]])).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522), at(-33.8688, 151.2093)], unread: 0 } });
  });

  it('reads a list of objects, under lat and lng, latitude and longitude, or lon', () => {
    const read = json([{ lat: 1, lng: 2 }, { latitude: 3, longitude: 4 }, { lat: 5, lon: 6 }, { lat: '7.5', lng: '8.5' }]);
    expect(read).toEqual({ ok: true, pasted: { places: [at(1, 2), at(3, 4), at(5, 6), at(7.5, 8.5)], unread: 0 } });
  });

  it('reads a GeoJSON FeatureCollection of points, whose coordinates are longitude first', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, properties: { name: 'Paris' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [151.2093, -33.8688, 12] }, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} },
      ],
    };
    expect(json(collection)).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522), at(-33.8688, 151.2093)], unread: 1 } });
  });

  it("reads the map makers' export, keeping a panorama id that is Google's own", () => {
    const exported = { name: 'A map', customCoordinates: [{ lat: 48.8566, lng: 2.3522, heading: 90, panoId: PANO }, { lat: 1, lng: 2, panoId: 'CAoSLEFGMVFpcE5fbG9uZ19waG90b19zcGhlcmVfaWQ' }, { lat: 3, lng: 4, panoId: null }] };
    expect(json(exported)).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522, PANO), at(1, 2), at(3, 4)], unread: 0 } });
  });

  it('counts what is no place: a point off the globe, a pair of words, an object without both numbers', () => {
    const read = json([[91, 0], [0, 181], ['a', 'b'], { lat: 1 }, null, [1], [48, 2]]);
    expect(read).toEqual({ ok: true, pasted: { places: [at(48, 2)], unread: 6 } });
  });

  it('refuses what is not JSON, and JSON that holds no list of places', () => {
    expect(parsePlacesFile('json', '{ not json')).toEqual({ ok: false, problem: 'notJson' });
    expect(json({ places: [[1, 2]] })).toEqual({ ok: false, problem: 'shape' });
    expect(json('48, 2')).toEqual({ ok: false, problem: 'shape' });
    expect(json(12)).toEqual({ ok: false, problem: 'shape' });
    expect(json({ type: 'FeatureCollection' })).toEqual({ ok: false, problem: 'shape' });
  });

  it('refuses a list with nothing in it', () => {
    expect(json([])).toEqual({ ok: false, problem: 'empty' });
    expect(json({ customCoordinates: [] })).toEqual({ ok: false, problem: 'empty' });
    expect(parsePlacesFile('json', '   ')).toEqual({ ok: false, problem: 'empty' });
  });

  it('refuses more entries than a map can hold, saying how many there were', () => {
    const many = Array.from({ length: FILE_LIMITS.maxPlaces + 1 }, (_, i) => [i % 80, i % 170]);
    expect(json(many)).toEqual({ ok: false, problem: 'tooMany', count: FILE_LIMITS.maxPlaces + 1 });
    expect(json(many.slice(1))).toMatchObject({ ok: true });
  });
});

describe('a CSV file', () => {
  it('reads lat and lng columns named in a header, in either order and among others', () => {
    expect(csv('lat,lng\n48.8566,2.3522\n-33.8688,151.2093\n')).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522), at(-33.8688, 151.2093)], unread: 0 } });
    expect(csv('name,lng,lat\nParis,2.3522,48.8566')).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522)], unread: 0 } });
  });

  it('knows the columns by their longer names too, whatever their case', () => {
    expect(csv('Latitude,Longitude\n1,2').ok && csv('Latitude,Longitude\n1,2')).toMatchObject({ pasted: { places: [at(1, 2)] } });
    expect(csv('LAT;LON\r\n1;2\r\n')).toMatchObject({ ok: true, pasted: { places: [at(1, 2)] } });
    expect(csv('lat\tlong\n1\t2')).toMatchObject({ ok: true, pasted: { places: [at(1, 2)] } });
  });

  it('reads two bare columns as latitude then longitude', () => {
    expect(csv('48.8566,2.3522\n-1.2921,36.8219')).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522), at(-1.2921, 36.8219)], unread: 0 } });
  });

  it('takes quoted cells, and a byte order mark at the start', () => {
    expect(csv('﻿"lat","lng"\n"48.8566","2.3522"')).toEqual({ ok: true, pasted: { places: [at(48.8566, 2.3522)], unread: 0 } });
  });

  it('skips empty rows and counts the rows that are no place', () => {
    expect(csv('lat,lng\n\n48,2\nnorth,east\n95,2\n48\n')).toEqual({ ok: true, pasted: { places: [at(48, 2)], unread: 3 } });
  });

  it('refuses a header that names no latitude and longitude', () => {
    expect(csv('name,x,y\nParis,2,48')).toEqual({ ok: false, problem: 'noColumns' });
    expect(csv('lat,name\n48,Paris')).toEqual({ ok: false, problem: 'noColumns' });
  });

  it('refuses a file with nothing in it, or with a header and no rows', () => {
    expect(csv('')).toEqual({ ok: false, problem: 'empty' });
    expect(csv('\n\n')).toEqual({ ok: false, problem: 'empty' });
    expect(csv('lat,lng\n')).toEqual({ ok: false, problem: 'empty' });
  });

  it('refuses more rows than a map can hold', () => {
    const rows = Array.from({ length: FILE_LIMITS.maxPlaces + 1 }, (_, i) => `${i % 80},${i % 170}`).join('\n');
    expect(csv(rows)).toEqual({ ok: false, problem: 'tooMany', count: FILE_LIMITS.maxPlaces + 1 });
    expect(csv(`lat,lng\n${rows}`)).toEqual({ ok: false, problem: 'tooMany', count: FILE_LIMITS.maxPlaces + 1 });
  });
});
