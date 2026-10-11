import { describe, expect, it } from 'vitest';
import { parsePaste, type PastedPlace } from './map-paste.ts';

const PANO = 'AbCdEfGhIjKlMnOpQrSt-_';
const at = (lat: number, lng: number, panoId: string | null = null): PastedPlace => ({ point: { lat, lng }, panoId });
const one = (line: string) => parsePaste(line);

describe('pasted coordinates', () => {
  it('reads latitude then longitude, split by a comma', () => {
    expect(one('48.8566, 2.3522')).toEqual({ places: [at(48.8566, 2.3522)], unread: 0 });
    expect(one('48.8566,2.3522')).toEqual({ places: [at(48.8566, 2.3522)], unread: 0 });
  });

  it('reads latitude then longitude, split by a space or a tab', () => {
    expect(one('48.8566 2.3522').places).toEqual([at(48.8566, 2.3522)]);
    expect(one('48.8566\t2.3522').places).toEqual([at(48.8566, 2.3522)]);
  });

  it('reads signs and whole numbers', () => {
    expect(one('-33.8688, 151.2093').places).toEqual([at(-33.8688, 151.2093)]);
    expect(one('+12 -3').places).toEqual([at(12, -3)]);
  });

  it('takes a list one line at a time, skipping the empty ones', () => {
    const pasted = parsePaste('  48.8566, 2.3522  \r\n\r\n-1.2921 36.8219\n\n');
    expect(pasted).toEqual({ places: [at(48.8566, 2.3522), at(-1.2921, 36.8219)], unread: 0 });
  });

  it('does not read a point that is nowhere on the globe', () => {
    expect(one('91, 10')).toEqual({ places: [], unread: 1 });
    expect(one('10, 181')).toEqual({ places: [], unread: 1 });
    expect(one('-90.5 0')).toEqual({ places: [], unread: 1 });
  });
});

describe('pasted Street View links', () => {
  it('reads the @lat,lng of a Google Maps address, with the panorama after !1s', () => {
    const link = `https://www.google.com/maps/@48.8583701,2.2944813,3a,75y,90t/data=!3m6!1e1!3m4!1s${PANO}!2e0!7i16384!8i8192`;
    expect(one(link)).toEqual({ places: [at(48.8583701, 2.2944813, PANO)], unread: 0 });
  });

  it('reads a negative @lat,lng with no panorama in the address', () => {
    expect(one('https://www.google.com/maps/@-33.8568,151.2153,17z').places).toEqual([at(-33.8568, 151.2153)]);
  });

  it('takes the panorama, not the place Google files it under', () => {
    const link = `https://www.google.com/maps/place/Tour+Eiffel/@48.8583701,2.2944813,3a,75y/data=!3m8!1e1!3m6!1s${PANO}!2e0!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.85!4d2.29`;
    expect(one(link).places).toEqual([at(48.8583701, 2.2944813, PANO)]);
  });

  it('reads pano= with its viewpoint, as the Maps URLs form has them', () => {
    expect(one(`https://www.google.com/maps/@?api=1&map_action=pano&pano=${PANO}&viewpoint=48.857832,2.295226`).places).toEqual([at(48.857832, 2.295226, PANO)]);
    expect(one('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=48.86%2C2.345').places).toEqual([at(48.86, 2.345)]);
  });

  it('reads pano= alone as a panorama with no point', () => {
    expect(one(`https://www.google.com/maps/@?api=1&map_action=pano&pano=${PANO}`)).toEqual({ places: [{ point: null, panoId: PANO }], unread: 0 });
  });

  it('does not read a link with neither a point nor a panorama', () => {
    expect(one('https://maps.app.goo.gl/AbCdEf123')).toEqual({ places: [], unread: 1 });
    expect(one('https://example.com/')).toEqual({ places: [], unread: 1 });
  });
});

describe('junk', () => {
  it('counts the lines it could not read and keeps the rest, in order', () => {
    const pasted = parsePaste(['Paris', '48.8566, 2.3522', '48.85', '1, 2, 3', 'lat, lng', '-1.2921 36.8219'].join('\n'));
    expect(pasted).toEqual({ places: [at(48.8566, 2.3522), at(-1.2921, 36.8219)], unread: 4 });
  });

  it('reads nothing from nothing', () => {
    expect(parsePaste('')).toEqual({ places: [], unread: 0 });
    expect(parsePaste(' \n \n')).toEqual({ places: [], unread: 0 });
  });
});
