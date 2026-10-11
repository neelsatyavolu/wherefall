import { describe, expect, it } from 'vitest';
import { distanceKm as gameDistanceKm } from '../../src/game/geo.ts';
import { WORLD_SCALE_KM, scoreForDistance as gameScoreForDistance } from '../../src/game/scoring.ts';
import { WORLD_SCALE_KM as SERVER_WORLD_SCALE_KM, distanceKm, scoreForDistance } from './scoring.js';

const POINTS = [
  { lng: 0, lat: 0 },
  { lng: 2.3522, lat: 48.8566 },
  { lng: -74.006, lat: 40.7128 },
  { lng: 139.6917, lat: 35.6895 },
  { lng: 151.2093, lat: -33.8688 },
  { lng: -180, lat: -90 },
  { lng: 180, lat: 90 },
  { lng: 179.999, lat: 0.001 },
  { lng: -179.999, lat: -0.001 },
  { lng: 2.3523, lat: 48.8567 },
];

const DISTANCES = [0, 0.001, 0.025, 0.0251, 0.5, 1, 42.5, 100, 999.9, 5000, 14_916.862, 20_015];
const SCALES = [100, 1873.4, 4200, WORLD_SCALE_KM, 20_000];

describe('distanceKm', () => {
  it('agrees with the game for every pair of a spread of points', () => {
    for (const a of POINTS) {
      for (const b of POINTS) {
        expect(distanceKm(a, b)).toBe(gameDistanceKm(a, b));
      }
    }
  });

  it('measures a quarter of the way round the world', () => {
    expect(distanceKm({ lng: 0, lat: 0 }, { lng: 90, lat: 0 })).toBeCloseTo((Math.PI / 2) * 6371.0088, 6);
  });
});

describe('scoreForDistance', () => {
  it('uses the same scale for the world as the game does', () => {
    expect(SERVER_WORLD_SCALE_KM).toBe(WORLD_SCALE_KM);
  });

  it('agrees with the game across distances and map scales', () => {
    for (const scale of SCALES) {
      for (const distance of DISTANCES) {
        expect(scoreForDistance(distance, scale)).toBe(gameScoreForDistance(distance, scale));
      }
    }
  });

  it('gives full marks within 25 metres and falls off after', () => {
    expect(scoreForDistance(0.025, WORLD_SCALE_KM)).toBe(5000);
    expect(scoreForDistance(1500, WORLD_SCALE_KM)).toBe(Math.round(5000 * Math.exp((-10 * 1500) / WORLD_SCALE_KM)));
    expect(scoreForDistance(20_000, 100)).toBe(0);
  });
});
