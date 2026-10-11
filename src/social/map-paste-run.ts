import type { LngLat } from '../game/geo.ts';
import { addPlace, type Draft } from './map-editor.ts';
import type { PastedPlace } from './map-paste.ts';
import { MAP_LIMITS } from './maps.ts';

/** How many places are looked up at once. A long list is slow one at a time, and Google refuses a flood. */
const AT_ONCE = 4;

export interface Lookups {
  /** the nearest official panorama to a point, or null when there is none close: the lookup a click on the map uses */
  snap: (point: LngLat) => Promise<{ id: string; lng: number; lat: number } | null>;
  countryAt: (point: LngLat) => string | null;
}

export interface Watch {
  /** called after each handful, with the draft as it then stands */
  onProgress: (done: number, total: number, draft: Draft) => void;
  /** asked before each handful: true ends the run, keeping what was added */
  stopped: () => boolean;
}

/** What became of the pasted places, by count. */
export interface Tally {
  added: number;
  /** no Street View close to the point */
  none: number;
  /** already in the map, or pasted twice */
  duplicate: number;
  /** a panorama out at sea, in no country */
  noCountry: number;
  /** more than the map can hold */
  full: number;
  /** a link with a panorama but no point to look near */
  noPoint: number;
  /** Street View could not be reached */
  failed: number;
  /** never looked up: the run was stopped, or gave up when Street View could not be reached */
  left: number;
}

type Outcome = keyof Tally;

export const emptyTally = (): Tally => ({ added: 0, none: 0, duplicate: 0, noCountry: 0, full: 0, noPoint: 0, failed: 0, left: 0 });

const counted = (tally: Tally, outcome: Outcome, count = 1): Tally => ({ ...tally, [outcome]: tally[outcome] + count });

const isFull = (draft: Draft) => draft.places.length >= MAP_LIMITS.maxPlaces;

type Found = { id: string; lng: number; lat: number } | null | 'failed' | 'noPoint';

function find(place: PastedPlace, snap: Lookups['snap']): Promise<Found> {
  return place.point === null ? Promise.resolve('noPoint') : snap(place.point).catch(() => 'failed' as const);
}

/** Puts one looked-up place into the draft, or says why not. */
function place(draft: Draft, found: Found, countryAt: Lookups['countryAt']): { draft: Draft; outcome: Outcome } {
  if (found === 'failed' || found === 'noPoint') {
    return { draft, outcome: found };
  }
  if (found === null) {
    return { draft, outcome: 'none' };
  }
  const country = countryAt(found);
  if (country === null) {
    return { draft, outcome: 'noCountry' };
  }
  const next = addPlace(draft, [found.id, found.lng, found.lat, country]);
  return next === draft ? { draft, outcome: isFull(draft) ? 'full' : 'duplicate' } : { draft: next, outcome: 'added' };
}

/**
 * Adds pasted places to a draft: each point is matched to the nearest panorama, as a click on the
 * map is, a handful at a time and in the order pasted. The run ends early when the map is full
 * (the rest did not fit), when it is stopped, or when Street View cannot be reached (the rest were
 * never looked up). What was added by then is kept.
 */
export async function addPasted(start: Draft, places: readonly PastedPlace[], lookups: Lookups, watch: Watch): Promise<{ draft: Draft; tally: Tally }> {
  let draft = start;
  let tally = emptyTally();
  for (let done = 0; done < places.length; done += AT_ONCE) {
    const rest = places.length - done;
    if (isFull(draft)) {
      return { draft, tally: counted(tally, 'full', rest) };
    }
    if (watch.stopped() || tally.failed > 0) {
      return { draft, tally: counted(tally, 'left', rest) };
    }
    const found = await Promise.all(places.slice(done, done + AT_ONCE).map((each) => find(each, lookups.snap)));
    for (const each of found) {
      const placed = place(draft, each, lookups.countryAt);
      draft = placed.draft;
      tally = counted(tally, placed.outcome);
    }
    watch.onProgress(Math.min(done + AT_ONCE, places.length), places.length, draft);
  }
  return { draft, tally };
}
