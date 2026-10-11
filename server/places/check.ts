import { communitySlugOf } from '../account/input.js';
import { diagonalKm, isOnMap, knownPlace, scaleOf } from './lists.js';

/** A place as a browser names it: by id, and where it says the place is. */
export interface SentPlace {
  id: string;
  lng: number;
  lat: number;
}

/** A place as the server knows it. */
export interface Place {
  id: string;
  lng: number;
  lat: number;
  country: string;
}

/** A community map's places, in the row shape they are stored in. */
export type CommunityRow = readonly [id: string, lng: number, lat: number, country: string];

export interface CheckedPlaces {
  /** The places as their list or map has them, in the order sent. */
  places: Place[];
  /** The scale the map's scores fall off on, in kilometres. */
  scaleKm: number;
  /** Which of the two lists the places are from; null for a community map. */
  list: number | null;
}

/**
 * How far a coordinate a browser sends may be from the list's own, in
 * degrees: about eleven metres. The browser sends what it was served, so the
 * room is only for a number printed and read back.
 */
export const TOLERANCE_DEGREES = 0.0001;
/** A community map can be a few streets across; scoring never works to a scale smaller than this. */
export const MIN_COMMUNITY_SCALE_KM = 100;

const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOLERANCE_DEGREES;
const sameSpot = (sent: SentPlace, known: { lng: number; lat: number }): boolean => near(sent.lng, known.lng) && near(sent.lat, known.lat);

function onCommunityMap(sent: readonly SentPlace[], rows: readonly CommunityRow[]): CheckedPlaces | null {
  const byId = new Map<string, CommunityRow[]>();
  for (const row of rows) {
    byId.set(row[0], [...(byId.get(row[0]) ?? []), row]);
  }
  // A player's own list may use an id twice, so every row with the id is tried.
  const found = sent.map((place) => (byId.get(place.id) ?? []).find(([, lng, lat]) => sameSpot(place, { lng, lat })));
  if (found.some((row) => row === undefined) || rows.length === 0) {
    return null;
  }
  const places = found.flatMap((row) => (row ? [{ id: row[0], lng: row[1], lat: row[2], country: row[3] }] : []));
  const scaleKm = Math.max(MIN_COMMUNITY_SCALE_KM, diagonalKm(rows.map(([, lng, lat]) => ({ lng, lat }))));
  return { places, scaleKm, list: null };
}

function onOfficialMap(map: string, sent: readonly SentPlace[]): CheckedPlaces | null {
  const known = sent.map((place) => {
    const found = knownPlace(place.id);
    return found && sameSpot(place, found) && isOnMap(found, map) ? found : null;
  });
  const [first] = known;
  const sound = first && known.every((place) => place?.list === first.list) && new Set(sent.map((place) => place.id)).size === sent.length;
  if (!sound) {
    return null;
  }
  const places = known.flatMap((place) => (place ? [{ id: place.id, lng: place.lng, lat: place.lat, country: place.country }] : []));
  return { places, scaleKm: scaleOf(map, first.list), list: first.list };
}

/**
 * The places a browser names, as the server knows them, with the scale their
 * map is scored on. Null when any of them is not a place of the map: not in
 * a list under that id, not where the list has it, in another country or
 * region than the map's, from the other list than the rest, or sent twice.
 *
 * `community` is the community map's own places when `map` is one, and is
 * the caller's to load; for such a map null means the map is gone.
 */
export function checkPlaces(map: string, sent: readonly SentPlace[], community: readonly CommunityRow[] | null = null): CheckedPlaces | null {
  if (sent.length === 0) {
    return null;
  }
  if (communitySlugOf(map) !== null) {
    return community ? onCommunityMap(sent, community) : null;
  }
  return onOfficialMap(map, sent);
}
