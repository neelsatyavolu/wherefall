/**
 * What one pasted line says about a place: a point, the id of a Google panorama, or both. A line
 * with neither is not a place at all, and is counted instead.
 */
export interface PastedPlace {
  point: { lat: number; lng: number } | null;
  panoId: string | null;
}

export interface Pasted {
  places: PastedPlace[];
  /** lines with something on them that could not be read as a place */
  unread: number;
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
/** `lat, lng` or `lat lng`: latitude first, as Google Maps copies them */
const COORDINATES = new RegExp(`^(${NUMBER})(?:\\s*,\\s*|\\s+)(${NUMBER})$`);
/** the camera position in a Google Maps address: `/@48.85837,2.29448,3a,75y,…` */
const AT_POINT = new RegExp(`/@(${NUMBER}),(${NUMBER})`);
/** the Maps URLs form: `viewpoint=48.857832,2.295226`, its comma often written `%2C` */
const VIEWPOINT = new RegExp(`[?&]viewpoint=(${NUMBER})(?:,|%2C)(${NUMBER})`, 'i');
/** a value in the address's `data=` block: the panorama is one of these, and so is the place Google files it under */
const DATA_VALUES = /!1s([^!&?#/]+)/g;
const PANO_PARAMETER = /[?&]pano=([^&#]+)/i;
/** Google's own panorama ids. A photo sphere somebody uploaded has a longer one, and is not what a map is made of. */
const PANO_ID = /^[\w-]{22}$/;
const LINK = /^https?:\/\//i;

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

function pointOf(match: RegExpMatchArray | null): PastedPlace['point'] {
  if (!match) {
    return null;
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= MAX_LATITUDE && Math.abs(lng) <= MAX_LONGITUDE ? { lat, lng } : null;
}

function panoOf(link: string): string | null {
  const named = PANO_PARAMETER.exec(link)?.[1];
  const candidates = [named, ...[...link.matchAll(DATA_VALUES)].map((match) => match[1])];
  return candidates.find((value): value is string => value !== undefined && PANO_ID.test(value)) ?? null;
}

/** One line: a Street View link, a pair of coordinates, or nothing that can be read (null). */
function parseLine(line: string): PastedPlace | null {
  if (!LINK.test(line)) {
    const point = pointOf(COORDINATES.exec(line));
    return point ? { point, panoId: null } : null;
  }
  const point = pointOf(AT_POINT.exec(line)) ?? pointOf(VIEWPOINT.exec(line));
  const panoId = panoOf(line);
  return point || panoId ? { point, panoId } : null;
}

/**
 * Reads what a map's maker pasted, a line at a time: Street View links as Google Maps gives them
 * (`…/@lat,lng,…`, with the panorama after `!1s`, or the `pano=` and `viewpoint=` form), and plain
 * coordinates as `lat, lng` or `lat lng`. Empty lines are skipped; anything else is counted.
 */
export function parsePaste(text: string): Pasted {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const places = lines.map(parseLine).filter((place): place is PastedPlace => place !== null);
  return { places, unread: lines.length - places.length };
}
