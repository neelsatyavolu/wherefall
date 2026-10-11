import { describe, expect, it } from 'vitest';
import { distanceKm } from './geo.ts';
import { HINTS_PER_GAME, hintCircle, hintRadiusKm, hintRing, hintsLeft } from './hint.ts';
import { createRng } from './rng.ts';
import { WORLD_SCALE_KM } from './scoring.ts';

const place = { lng: 139.69, lat: 35.69 };

describe('hintRadiusKm', () => {
  it('is 5870 km on the world map at the equator', () => {
    expect(hintRadiusKm(WORLD_SCALE_KM, 0)).toBeCloseTo(5870, 6);
  });

  it('shrinks with the cosine of the latitude, north or south', () => {
    expect(hintRadiusKm(WORLD_SCALE_KM, 60)).toBeCloseTo(2935, 6);
    expect(hintRadiusKm(WORLD_SCALE_KM, -60)).toBeCloseTo(2935, 6);
  });

  it('scales with the map', () => {
    expect(hintRadiusKm(2000, 0)).toBeCloseTo(587, 6);
    expect(hintRadiusKm(2000, 60)).toBeCloseTo(293.5, 6);
  });
});

describe('hintCircle', () => {
  it('has the radius for the place it hides', () => {
    expect(hintCircle(place, WORLD_SCALE_KM, createRng('a')).radiusKm).toBeCloseTo(hintRadiusKm(WORLD_SCALE_KM, place.lat), 6);
  });

  it('always contains the place, and is not simply centred on it', () => {
    const offsets = Array.from({ length: 200 }, (_, i) => {
      const circle = hintCircle(place, 3000, createRng(`seed${i}`));
      return distanceKm(circle.center, place) / circle.radiusKm;
    });
    expect(Math.max(...offsets)).toBeLessThan(0.7);
    expect(offsets.filter((offset) => offset > 0.2).length).toBeGreaterThan(100);
  });

  it('contains the place and stays off the poles at every latitude with streets', () => {
    for (let lat = -80; lat <= 80; lat += 4) {
      for (let seed = 0; seed < 40; seed += 1) {
        const at = { lng: 20, lat };
        const circle = hintCircle(at, WORLD_SCALE_KM, createRng(`pole${lat}:${seed}`));
        expect(distanceKm(circle.center, at)).toBeLessThan(circle.radiusKm);
        const lats = hintRing(circle).map(([, ringLat]) => Math.abs(ringLat));
        expect(Math.max(...lats)).toBeLessThanOrEqual(85.01);
      }
    }
  });

  it('is the same circle for the same seed and a different one for another', () => {
    expect(hintCircle(place, 3000, createRng('x'))).toEqual(hintCircle(place, 3000, createRng('x')));
    expect(hintCircle(place, 3000, createRng('x')).center).not.toEqual(hintCircle(place, 3000, createRng('y')).center);
  });
});

describe('hintRing', () => {
  it('is a closed ring that does not jump across the date line', () => {
    const ring = hintRing({ center: { lng: 175, lat: 0 }, radiusKm: 3000 });
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const steps = ring.slice(1).map(([lng], index) => Math.abs(lng - ring[index]![0]));
    expect(Math.max(...steps)).toBeLessThan(20);
    expect(Math.max(...ring.map(([lng]) => lng))).toBeGreaterThan(180);
  });
});

describe('hintsLeft', () => {
  it('allows two hints a game and never goes below none', () => {
    expect(HINTS_PER_GAME).toBe(2);
    expect(hintsLeft(0)).toBe(2);
    expect(hintsLeft(1)).toBe(1);
    expect(hintsLeft(2)).toBe(0);
    expect(hintsLeft(5)).toBe(0);
  });
});
