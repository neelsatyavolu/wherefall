import { MAX_ROUND_SCORE } from '../account/input.js';

// A copy of the game's own arithmetic (src/game/geo.ts and src/game/scoring.ts),
// which the server cannot import. scoring.test.ts holds the two together.

interface LngLat {
  lng: number;
  lat: number;
}

/** The scale the world map is scored on. Every other map uses the diagonal of its own places. */
export const WORLD_SCALE_KM = 20_000;

const EARTH_RADIUS_KM = 6371.0088;
const PERFECT_WITHIN_KM = 0.03;
/** A score above this is so nearly perfect that it is given as perfect. */
const AS_GOOD_AS_PERFECT = 4997;
const DECAY = 10;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance (haversine). */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points for a guess: full marks on the spot, falling off exponentially with distance. */
export function scoreForDistance(km: number, scaleKm: number): number {
  if (km <= PERFECT_WITHIN_KM) {
    return MAX_ROUND_SCORE;
  }
  const score = Math.round(MAX_ROUND_SCORE * Math.exp((-DECAY * km) / scaleKm));
  return score > AS_GOOD_AS_PERFECT ? MAX_ROUND_SCORE : score;
}
