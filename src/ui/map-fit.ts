import type { LngLat } from '../game/geo.ts';

/**
 * What a result on the guess map is fitted to, worked out apart from the map itself: where a point
 * is drawn, which way round the world two points are nearest, whether a set of points has room,
 * and which of a reveal's pins have to be in sight. `guess-map.ts` draws what this decides.
 */

/** the furthest north and south a flat map of the world reaches: its top and bottom edge */
export const MAX_LATITUDE = 85.051129;
/** the least of the map a fit is left with, each way, whatever is asked to be kept clear */
const MIN_ROOM = 96;

export interface Room {
  width: number;
  height: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A pin of a reveal, as far as fitting goes. */
export interface FitPin {
  point: LngLat;
  own: boolean;
}

/** How far down the map a latitude is drawn: 0 at the top edge, 1 at the bottom one, and past either beyond them. */
const mercatorY = (lat: number): number => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI);
const latitudeAt = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
const turn = (lng: number): number => ((lng % 360) + 360) % 360;

/** Where a point is drawn. A flat map has no poles: a point past its edge is drawn on the edge. */
export function onMap(point: LngLat): LngLat {
  return { lng: point.lng, lat: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.lat)) };
}

/** `point` the short way round from `from`: the same place, written within half a turn of `from`, across the date line if that is nearer. */
export function near(from: LngLat, point: LngLat): LngLat {
  return { lng: point.lng - 360 * Math.round((point.lng - from.lng) / 360), lat: point.lat };
}

/**
 * The same points, written so that they lie together: the ring of longitudes is opened at its
 * widest gap, so points either side of the date line are side by side and not a world apart.
 */
export function together(points: readonly LngLat[]): LngLat[] {
  if (points.length < 2) {
    return [...points];
  }
  const ring = [...new Set(points.map((point) => turn(point.lng)))].sort((a, b) => a - b);
  const gaps = ring.map((lng, index) => (index === 0 ? lng + 360 - ring[ring.length - 1]! : lng - ring[index - 1]!));
  // the points begin after the widest gap
  const start = ring[gaps.indexOf(Math.max(...gaps))]!;
  const span = 360 - Math.max(...gaps);
  // as near the longitudes they came with as whole turns allow
  const home = start - 360 * Math.round((start + span / 2) / 360);
  return points.map((point) => ({ ...point, lng: home + turn(point.lng - start) }));
}

/** True when the room has space for every point with the world drawn `world` pixels across. */
export function holds(points: readonly LngLat[], room: Room, world: number): boolean {
  if (room.width <= 0 || room.height <= 0) {
    return false;
  }
  if (points.length < 2) {
    return true;
  }
  const lngs = together(points).map((point) => point.lng);
  const downs = points.map((point) => mercatorY(onMap(point).lat));
  const across = ((Math.max(...lngs) - Math.min(...lngs)) / 360) * world;
  const down = (Math.max(...downs) - Math.min(...downs)) * world;
  return across <= room.width && down <= room.height;
}

/**
 * What a reveal has to keep in sight: the place and the player's own pin. A player who made no
 * guess has no pin to prefer, and it is the place and everyone's.
 */
export function mustSee(place: LngLat, pins: readonly FitPin[]): LngLat[] {
  const own = pins.filter((pin) => pin.own);
  return [place, ...(own.length > 0 ? own : pins).map((pin) => pin.point)];
}

/**
 * The points a map is fitted to: all of them when the room holds them with the world no smaller
 * than `world` (the least it is drawn without leaving part of the map empty), and otherwise the
 * ones that have to be in sight. They come back lying together, across the date line if need be.
 */
export function pointsToFit(all: readonly LngLat[], must: readonly LngLat[], room: Room, world: number): LngLat[] {
  return together(holds(all, room, world) ? all : must);
}

/**
 * A fit's padding with every side given, and never so much of it that the map has no room left:
 * where two sides would leave less than a pair of pins needs, each gives way by its share.
 */
export function roomIn(padding: Partial<Padding>, size: Room): Padding {
  const { top = 0, right = 0, bottom = 0, left = 0 } = padding;
  const share = (span: number, sides: number) => (sides > 0 && span - sides < MIN_ROOM ? Math.max(0, span - MIN_ROOM) / sides : 1);
  const [across, down] = [share(size.width, left + right), share(size.height, top + bottom)];
  return { top: top * down, right: right * across, bottom: bottom * down, left: left * across };
}

/** A view of the map: the point in the middle of the room, and how many pixels across the world is drawn. */
export interface View {
  lng: number;
  lat: number;
  world: number;
}

/**
 * The view that puts `points` in the middle of the room, as large as the room holds them. The
 * middle is half way down the map between the highest and the lowest, which is not the latitude
 * half way between them: the map stretches towards the poles. Points that take no room at all
 * (one point, or none apart) are held by a world of any size: `world` is then infinite.
 */
export function viewOf(points: readonly LngLat[], room: Room): View {
  const lngs = points.map((point) => point.lng);
  const downs = points.map((point) => mercatorY(onMap(point).lat));
  const [west, east, top, bottom] = [Math.min(...lngs), Math.max(...lngs), Math.min(...downs), Math.max(...downs)];
  const world = Math.min(east > west ? (room.width * 360) / (east - west) : Infinity, bottom > top ? room.height / (bottom - top) : Infinity);
  return { lng: (west + east) / 2, lat: latitudeAt((top + bottom) / 2), world };
}
