import { circleRing, destination, distanceKm, type LngLat } from './geo.ts';
import type { Rng } from './rng.ts';
import { WORLD_SCALE_KM } from './scoring.ts';

/** The hint's radius on the world map at the equator. It shrinks with the map and towards the poles. */
const WORLD_RADIUS_KM = 5870;
/** The place sits within this share of the radius from the centre, so the centre does not give it away. */
const MAX_OFFSET_SHARE = 0.7;
/** A singleplayer game has this many hints, to spend on any of its rounds. */
export const HINTS_PER_GAME = 2;
/** as far towards a pole as a map is drawn */
const MAX_LATITUDE = 85;
const KM_PER_DEGREE = 111.195;

export interface HintCircle {
  center: LngLat;
  radiusKm: number;
}

/** How wide the hint is for a place at a latitude: `5870 km × scale / 20000 × cos(latitude)`. */
export function hintRadiusKm(scaleKm: number, latitude: number): number {
  return ((WORLD_RADIUS_KM * scaleKm) / WORLD_SCALE_KM) * Math.cos((latitude * Math.PI) / 180);
}

/** How many hints a game has left once `used` of them were asked for. */
export function hintsLeft(used: number): number {
  return Math.max(0, HINTS_PER_GAME - used);
}

/** A circle on the map that contains the place without being centred on it. Showing it halves the round. */
export function hintCircle(place: LngLat, scaleKm: number, rng: Rng): HintCircle {
  const radiusKm = hintRadiusKm(scaleKm, place.lat);
  const offsetKm = rng() * MAX_OFFSET_SHARE * radiusKm;
  const raw = destination(place, rng() * 360, offsetKm);
  // a circle that reached over a pole could not be drawn: its centre is slid towards the equator
  const limit = Math.max(0, MAX_LATITUDE - radiusKm / KM_PER_DEGREE);
  const center = { lng: raw.lng, lat: Math.max(-limit, Math.min(limit, raw.lat)) };
  return { center: distanceKm(center, place) < radiusKm ? center : raw, radiusKm };
}

/**
 * The circle as a closed ring of `[lng, lat]` points, for drawing. Its longitudes run on past 180
 * rather than jumping to the other side of the map when the circle crosses the date line.
 */
export function hintRing(circle: HintCircle): Array<[number, number]> {
  return circleRing(circle.center, circle.radiusKm).map(([lng, lat]) => {
    const turns = Math.round((lng - circle.center.lng) / 360);
    return [lng - turns * 360, lat];
  });
}
