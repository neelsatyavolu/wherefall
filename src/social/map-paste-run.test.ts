import { describe, expect, it } from 'vitest';
import type { LngLat } from '../game/geo.ts';
import { emptyDraft, type Draft } from './map-editor.ts';
import { addPasted, emptyTally, type Lookups, type Watch } from './map-paste-run.ts';
import type { PastedPlace } from './map-paste.ts';
import { MAP_LIMITS, type MapRow } from './maps.ts';

const point = (lat: number, lng = 2): PastedPlace => ({ point: { lat, lng }, panoId: null });
const idOf = (place: LngLat) => `pano-${place.lat}-${place.lng}`;

/** A lookup that finds a panorama exactly where it is asked, in France, and remembers what it was asked. */
function lookups(change: Partial<Lookups> = {}): Lookups & { asked: LngLat[] } {
  const asked: LngLat[] = [];
  return {
    asked,
    snap: async (place) => {
      asked.push(place);
      return { id: idOf(place), lng: place.lng, lat: place.lat };
    },
    countryAt: () => 'FR',
    ...change,
  };
}

const quiet: Watch = { onProgress: () => undefined, stopped: () => false };
const full = (): Draft => ({ ...emptyDraft(), places: Array.from({ length: MAP_LIMITS.maxPlaces }, (_, i): MapRow => [`old-${i}`, 0, 0, 'FR']) });

describe('adding pasted places', () => {
  it('adds each place it finds, in the order pasted, without changing the draft it was given', async () => {
    const draft = emptyDraft();
    const result = await addPasted(draft, [point(1), point(2), point(3), point(4), point(5), point(6)], lookups(), quiet);
    expect(result.draft.places.map(([id]) => id)).toEqual([1, 2, 3, 4, 5, 6].map((lat) => `pano-${lat}-2`));
    expect(result.draft.places[0]).toEqual(['pano-1-2', 2, 1, 'FR']);
    expect(result.tally).toEqual({ ...emptyTally(), added: 6 });
    expect(draft.places).toHaveLength(0);
  });

  it('counts a place with no Street View, and one in no country', async () => {
    const result = await addPasted(
      emptyDraft(),
      [point(1), point(2), point(3)],
      lookups({ snap: async (place) => (place.lat === 2 ? null : { id: idOf(place), lng: place.lng, lat: place.lat }), countryAt: (place) => (place.lat === 3 ? null : 'FR') }),
      quiet,
    );
    expect(result.draft.places.map(([id]) => id)).toEqual(['pano-1-2']);
    expect(result.tally).toEqual({ ...emptyTally(), added: 1, none: 1, noCountry: 1 });
  });

  it('counts a place already in the map, and one pasted twice', async () => {
    const draft: Draft = { ...emptyDraft(), places: [['pano-1-2', 2, 1, 'FR']] };
    const result = await addPasted(draft, [point(1), point(7), point(7)], lookups(), quiet);
    expect(result.draft.places.map(([id]) => id)).toEqual(['pano-1-2', 'pano-7-2']);
    expect(result.tally).toEqual({ ...emptyTally(), added: 1, duplicate: 2 });
  });

  it('counts a link with a panorama but no point, which cannot be looked up', async () => {
    const found = lookups();
    const result = await addPasted(emptyDraft(), [{ point: null, panoId: 'AbCdEfGhIjKlMnOpQrStUv' }, point(1)], found, quiet);
    expect(result.tally).toEqual({ ...emptyTally(), added: 1, noPoint: 1 });
    expect(found.asked).toEqual([{ lat: 1, lng: 2 }]);
  });

  it('stops looking once the map is full, and counts what did not fit', async () => {
    const found = lookups();
    const nearlyFull = { ...full(), places: full().places.slice(1) };
    const result = await addPasted(nearlyFull, Array.from({ length: 12 }, (_, i) => point(i + 1)), found, quiet);
    expect(result.draft.places).toHaveLength(MAP_LIMITS.maxPlaces);
    expect(result.tally).toEqual({ ...emptyTally(), added: 1, full: 11 });
    // the first handful is looked up together; nothing after it is
    expect(found.asked.length).toBeLessThan(12);
  });

  it('asks nothing of a map that is already full', async () => {
    const found = lookups();
    const result = await addPasted(full(), [point(1), point(2)], found, quiet);
    expect(result.tally).toEqual({ ...emptyTally(), full: 2 });
    expect(found.asked).toEqual([]);
  });

  it('gives up when Street View cannot be reached, keeping what it had', async () => {
    let calls = 0;
    const found = lookups({
      snap: async (place) => {
        calls += 1;
        if (place.lat >= 2) {
          throw new Error('unreachable');
        }
        return { id: idOf(place), lng: place.lng, lat: place.lat };
      },
    });
    const result = await addPasted(emptyDraft(), Array.from({ length: 20 }, (_, i) => point(i + 1)), found, quiet);
    expect(result.draft.places.map(([id]) => id)).toEqual(['pano-1-2']);
    expect(result.tally.added).toBe(1);
    expect(result.tally.failed).toBeGreaterThan(0);
    expect(result.tally.failed + result.tally.left).toBe(19);
    expect(calls).toBeLessThan(20);
  });

  it('reports progress, and stops when asked', async () => {
    const seen: Array<[number, number, number]> = [];
    let stop = false;
    const watch: Watch = {
      onProgress: (done, total, draft) => {
        seen.push([done, total, draft.places.length]);
        stop = done >= 8;
      },
      stopped: () => stop,
    };
    const result = await addPasted(emptyDraft(), Array.from({ length: 20 }, (_, i) => point(i + 1)), lookups(), watch);
    expect(seen.at(-1)).toEqual([8, 20, 8]);
    expect(seen.every(([, total]) => total === 20)).toBe(true);
    expect(result.draft.places).toHaveLength(8);
    expect(result.tally).toEqual({ ...emptyTally(), added: 8, left: 12 });
  });
});
