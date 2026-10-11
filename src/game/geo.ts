export interface LngLat {
  lng: number;
  lat: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance (haversine). */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from one point to another, 0 to 360 with north at 0. */
export function bearingDeg(from: LngLat, to: LngLat): number {
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The point reached by travelling a distance from a point along a compass bearing. */
export function destination(from: LngLat, bearing: number, km: number): LngLat {
  const angular = km / EARTH_RADIUS_KM;
  const lat1 = toRad(from.lat);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(toRad(bearing)));
  const lng2 =
    toRad(from.lng) + Math.atan2(Math.sin(toRad(bearing)) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lng: ((toDeg(lng2) + 540) % 360) - 180, lat: toDeg(lat2) };
}

/** A circle on the ground as a closed ring of `[lng, lat]` points, for drawing. */
export function circleRing(center: LngLat, radiusKm: number, steps = 96): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const point = destination(center, ((i % steps) / steps) * 360, radiusKm);
    return [point.lng, point.lat];
  });
}

export function boundsDiagonalKm(points: readonly LngLat[]): number {
  if (points.length === 0) {
    throw new Error('Cannot measure the bounds of no points');
  }
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  return distanceKm(
    { lng: Math.min(...lngs), lat: Math.min(...lats) },
    { lng: Math.max(...lngs), lat: Math.max(...lats) },
  );
}
