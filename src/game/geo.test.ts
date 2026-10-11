import { describe, expect, it } from 'vitest';
import { bearingDeg, boundsDiagonalKm, circleRing, destination, distanceKm } from './geo.ts';

const paris = { lng: 2.3522, lat: 48.8566 };
const london = { lng: -0.1278, lat: 51.5074 };

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(paris, paris)).toBe(0);
  });

  it('matches the known Paris to London distance', () => {
    expect(distanceKm(paris, london)).toBeCloseTo(343.6, 0);
  });

  it('is half the circumference between antipodes', () => {
    expect(distanceKm({ lng: 0, lat: 0 }, { lng: 180, lat: 0 })).toBeCloseTo(20015, -1);
  });

  it('takes the short way across the antimeridian', () => {
    expect(distanceKm({ lng: 179.5, lat: 0 }, { lng: -179.5, lat: 0 })).toBeCloseTo(111.2, 0);
  });
});

describe('bearingDeg', () => {
  const origin = { lng: 0, lat: 0 };

  it('points north, east, south and west', () => {
    expect(bearingDeg(origin, { lng: 0, lat: 1 })).toBeCloseTo(0);
    expect(bearingDeg(origin, { lng: 1, lat: 0 })).toBeCloseTo(90);
    expect(bearingDeg(origin, { lng: 0, lat: -1 })).toBeCloseTo(180);
    expect(bearingDeg(origin, { lng: -1, lat: 0 })).toBeCloseTo(270);
  });
});

describe('boundsDiagonalKm', () => {
  it('measures corner to corner of the bounding box', () => {
    const points = [paris, london, { lng: 1, lat: 50 }];
    const expected = distanceKm({ lng: -0.1278, lat: 48.8566 }, { lng: 2.3522, lat: 51.5074 });
    expect(boundsDiagonalKm(points)).toBeCloseTo(expected);
  });

  it('rejects an empty list', () => {
    expect(() => boundsDiagonalKm([])).toThrow();
  });
});

describe('destination', () => {
  it('lands the asked distance away in the asked direction', () => {
    const from = { lng: 2.35, lat: 48.85 };
    for (const [bearing, km] of [[0, 10], [90, 250], [200, 1200], [315, 0.5]] as const) {
      const to = destination(from, bearing, km);
      expect(distanceKm(from, to)).toBeCloseTo(km, 3);
      expect(Math.abs(((bearingDeg(from, to) - bearing + 540) % 360) - 180)).toBeLessThan(0.01);
    }
  });

  it('keeps longitudes on the map when crossing the date line', () => {
    const to = destination({ lng: 179.5, lat: 0 }, 90, 200);
    expect(to.lng).toBeLessThan(-178);
    expect(to.lng).toBeGreaterThanOrEqual(-180);
  });

  it('stays put for no distance', () => {
    const to = destination({ lng: 10, lat: 20 }, 45, 0);
    expect(to.lng).toBeCloseTo(10, 9);
    expect(to.lat).toBeCloseTo(20, 9);
  });
});

describe('circleRing', () => {
  it('is a closed ring of points all one radius from the centre', () => {
    const center = { lng: -58.4, lat: -34.6 };
    const ring = circleRing(center, 300, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const [lng, lat] of ring) {
      expect(distanceKm(center, { lng, lat })).toBeCloseTo(300, 3);
    }
  });
});
