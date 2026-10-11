import { describe, expect, it } from 'vitest';
import { drawDaily } from '../../src/daily/draw.ts';
import { CONTINENTS as GAME_CONTINENTS, continentOf as gameContinentOf } from '../../src/game/continents.ts';
import { boundsDiagonalKm } from '../../src/game/geo.ts';
import { locationsForMap, parseLocationSet, scaleForMap, type MapId } from '../../src/game/locations.ts';
import { createRng as gameRng, pickDistinct } from '../../src/game/rng.ts';
import { readFileSync } from 'node:fs';
import { MIN_COMMUNITY_SCALE_KM, TOLERANCE_DEGREES, checkPlaces, type CommunityRow } from './check.js';
import { CONTINENTS, continentOf, continentsOf } from './continents.js';
import { DAILY_WINDOW, isDailyDraw } from './daily.js';
import { LIST_FILES, diagonalKm, isOnMap, knownPlace, placesOf, scaleOf } from './lists.js';
import { createRng, firstInOrder } from './rng.js';

const gameSet = (list: number) => parseLocationSet(JSON.parse(readFileSync(`public/${LIST_FILES[list]}`, 'utf8')));
const SETS = [gameSet(0), gameSet(1)];
const sent = ({ id, lng, lat }: { id: string; lng: number; lat: number }) => ({ id, lng, lat });
const inCountry = (list: number, country: string, count: number) => placesOf(list).filter((place) => place.country === country).slice(0, count);

describe('the place lists', () => {
  it('are the two files the browser is served, every place under its own id', () => {
    for (const [list, set] of SETS.entries()) {
      expect(placesOf(list)).toHaveLength(set.locations.length);
      expect(placesOf(list)[0]).toEqual({ ...set.locations[0], list });
    }
    expect(placesOf(0).length).toBeGreaterThan(10_000);
    const [google] = placesOf(0);
    const [other] = placesOf(1);
    expect(knownPlace(google?.id ?? '')).toBe(google);
    expect(knownPlace(other?.id ?? '')).toBe(other);
    expect(knownPlace('no-such-place')).toBeUndefined();
    expect(placesOf(2)).toEqual([]);
  });

  it('put a place on the same maps as the game does', () => {
    for (const [list, set] of SETS.entries()) {
      for (const map of ['world', 'europe', 'americas', 'asia-oceania', 'africa', 'country:FR', 'country:JP'] as MapId[]) {
        const mine = placesOf(list).filter((place) => isOnMap(place, map)).map((place) => place.id);
        expect(mine).toEqual(locationsForMap(set, map).map((place) => place.id));
      }
    }
  });

  it('score each map on the scale the game does', () => {
    for (const [list, set] of SETS.entries()) {
      // A list need not have places everywhere: the game offers a map only where there are some.
      const maps = (['world', 'europe', 'africa', 'country:FR', 'country:US', 'country:AD'] as MapId[]).filter((map) => locationsForMap(set, map).length > 0);
      expect(maps.length).toBeGreaterThan(3);
      for (const map of maps) {
        expect(scaleOf(map, list)).toBeCloseTo(scaleForMap(set, map), 6);
      }
    }
    expect(scaleOf('world', 0)).toBe(20_000);
    const some = placesOf(0).slice(0, 50);
    expect(diagonalKm(some)).toBeCloseTo(boundsDiagonalKm(some), 6);
  });
});

describe('continentOf', () => {
  it('agrees with the game for every place in both lists, and lists the same six', () => {
    expect(CONTINENTS).toEqual(GAME_CONTINENTS);
    for (const list of [0, 1]) {
      for (const place of placesOf(list)) {
        expect(continentOf(place)).toBe(gameContinentOf(place));
      }
    }
    expect(continentOf({ country: 'RU', lng: 37 })).toBe('europe');
    expect(continentOf({ country: 'RU', lng: 131 })).toBe('asia');
    expect(continentOf({ country: 'RU', lng: -170 })).toBe('asia');
    expect(continentOf({ country: 'AQ', lng: 0 })).toBeNull();
  });

  it('counts the continents some places are on, leaving out a place on none', () => {
    expect(continentsOf([{ country: 'FR', lng: 2 }, { country: 'DE', lng: 13 }, { country: 'JP', lng: 139 }, { country: 'AQ', lng: 0 }])).toBe(2);
    expect(continentsOf([])).toBe(0);
  });
});

describe('the seeded order', () => {
  it('is the game’s: the same numbers from a seed, and the same shuffle', () => {
    const [mine, theirs] = [createRng('daily20270115'), gameRng('daily20270115')];
    expect(Array.from({ length: 20 }, mine)).toEqual(Array.from({ length: 20 }, theirs));
    const items = Array.from({ length: 500 }, (_unused, index) => index);
    expect(firstInOrder(items, 40, createRng('abc'))).toEqual(pickDistinct(items, items.length, gameRng('abc')).slice(0, 40));
    expect(firstInOrder(items, 900, createRng('abc'))).toEqual(pickDistinct(items, items.length, gameRng('abc')));
  });
});

describe('checkPlaces', () => {
  it('knows the places of the world map, gives them back as the list has them, and scores on the world’s scale', () => {
    const three = placesOf(0).slice(0, 3);
    const checked = checkPlaces('world', three.map((place) => ({ id: place.id, lng: place.lng + TOLERANCE_DEGREES / 2, lat: place.lat })));
    expect(checked).toEqual({ places: three.map(({ id, lng, lat, country }) => ({ id, lng, lat, country })), scaleKm: 20_000, list: 0 });
    expect(checkPlaces('world', placesOf(1).slice(0, 2).map(sent))?.list).toBe(1);
  });

  it('holds a country or region map to its own places, on the scale of that map in the list they came from', () => {
    const french = inCountry(0, 'FR', 3);
    expect(checkPlaces('country:FR', french.map(sent))?.scaleKm).toBeCloseTo(scaleForMap(SETS[0]!, 'country:FR'), 6);
    expect(checkPlaces('europe', french.map(sent))?.scaleKm).toBeCloseTo(scaleForMap(SETS[0]!, 'europe'), 6);
    expect(checkPlaces('country:FR', inCountry(1, 'FR', 2).map(sent))?.scaleKm).toBeCloseTo(scaleForMap(SETS[1]!, 'country:FR'), 6);
    expect(checkPlaces('country:DE', french.map(sent))).toBeNull();
    expect(checkPlaces('africa', french.map(sent))).toBeNull();
  });

  it.each([
    ['a place nobody has heard of', (place: { id: string; lng: number; lat: number }) => ({ ...place, id: 'made-up' })],
    ['a place moved from where its list has it', (place: { id: string; lng: number; lat: number }) => ({ ...place, lat: place.lat + 0.001 })],
    ['a place moved east', (place: { id: string; lng: number; lat: number }) => ({ ...place, lng: place.lng - 0.01 })],
  ])('refuses %s', (_name, change) => {
    const [first, second] = placesOf(0);
    expect(checkPlaces('world', [sent(first!), change(sent(second!))])).toBeNull();
  });

  it('refuses no places, a place sent twice, and places from both lists at once', () => {
    const [first, second] = placesOf(0);
    expect(checkPlaces('world', [])).toBeNull();
    expect(checkPlaces('world', [sent(first!), sent(first!)])).toBeNull();
    expect(checkPlaces('world', [sent(first!), sent(placesOf(1)[0]!)])).toBeNull();
    expect(checkPlaces('world', [sent(first!), sent(second!)])).not.toBeNull();
  });

  it('holds a community map to its own places, whatever their ids, on its own scale and never a smaller one than 100 km', () => {
    const rows: CommunityRow[] = [
      ['a', 2.35, 48.85, 'FR'],
      ['b', 2.36, 48.86, 'FR'],
      ['b', 13.4, 52.5, 'DE'],
    ];
    const checked = checkPlaces('community:my-map', [{ id: 'b', lng: 13.4, lat: 52.5 }, { id: 'a', lng: 2.35, lat: 48.85 }], rows);
    expect(checked?.places).toEqual([{ id: 'b', lng: 13.4, lat: 52.5, country: 'DE' }, { id: 'a', lng: 2.35, lat: 48.85, country: 'FR' }]);
    expect(checked?.list).toBeNull();
    expect(checked?.scaleKm).toBeCloseTo(diagonalKm([{ lng: 2.35, lat: 48.85 }, { lng: 13.4, lat: 52.5 }]), 6);
    expect(checkPlaces('community:my-map', [{ id: 'a', lng: 2.35, lat: 48.85 }], rows.slice(0, 2))?.scaleKm).toBe(MIN_COMMUNITY_SCALE_KM);
    expect(checkPlaces('community:my-map', [{ id: 'a', lng: 3, lat: 48.85 }], rows)).toBeNull();
    expect(checkPlaces('community:my-map', [{ id: 'c', lng: 2.35, lat: 48.85 }], rows)).toBeNull();
    // A place of the official lists is not a place of somebody's map, and a map that is gone has no places.
    expect(checkPlaces('community:my-map', [sent(placesOf(0)[0]!)], rows)).toBeNull();
    expect(checkPlaces('community:my-map', [{ id: 'a', lng: 2.35, lat: 48.85 }], null)).toBeNull();
  });
});

describe('isDailyDraw', () => {
  const SEED = 'daily20270115';
  const asKnown = (list: number, ids: string[]) => ids.flatMap((id) => { const place = knownPlace(id); return place?.list === list ? [place] : []; });

  it('takes what the game draws from the seed, from either list, on any day', () => {
    for (const seed of [SEED, 'daily20270116', 'daily20261231', 'daily20270704']) {
      for (const [list, set] of SETS.entries()) {
        const drawn = drawDaily(set.locations, seed).map((place) => place.id);
        expect(isDailyDraw(asKnown(list, drawn), list, seed)).toBe(true);
      }
    }
  });

  it('takes what the game draws around pictures that have gone', () => {
    const set = SETS[0]!;
    const first = drawDaily(set.locations, SEED);
    const gone = new Set(first.map((place) => place.id));
    const redrawn = drawDaily(set.locations, SEED, gone);
    expect(redrawn.map((place) => place.id)).not.toEqual(first.map((place) => place.id));
    expect(isDailyDraw(asKnown(0, redrawn.map((place) => place.id)), 0, SEED)).toBe(true);
  });

  it('refuses another day’s places, places far down the order, two in one country, and three on one continent', () => {
    const set = SETS[0]!;
    const today = asKnown(0, drawDaily(set.locations, SEED).map((place) => place.id));
    const other = asKnown(0, drawDaily(set.locations, 'daily20270116').map((place) => place.id));
    expect(isDailyDraw(other, 0, SEED)).toBe(false);
    expect(isDailyDraw(today.slice(0, 2), 0, SEED)).toBe(false);
    expect(isDailyDraw(today, 1, SEED)).toBe(false);
    expect(isDailyDraw(today, 7, SEED)).toBe(false);

    const order = firstInOrder(placesOf(0), DAILY_WINDOW + 1, createRng(SEED));
    const early = order.slice(0, DAILY_WINDOW);
    const late = order[DAILY_WINDOW]!;
    // Two of the first hundred in one country, with a third from another continent.
    const twice = early.find((place) => early.some((other) => other !== place && other.country === place.country))!;
    const again = early.find((place) => place !== twice && place.country === twice.country)!;
    const elsewhere = early.find((place) => continentOf(place) !== continentOf(twice) && continentOf(place) !== null)!;
    expect(isDailyDraw([twice, again, elsewhere], 0, SEED)).toBe(false);
    // The hundred-and-first, with two early ones it keeps the rule with.
    const partner = early.find((place) => place.country !== late.country && continentOf(place) !== continentOf(late) && continentOf(place) !== null)!;
    const third = early.find((place) => place.country !== late.country && place.country !== partner.country)!;
    expect(isDailyDraw([partner, third, late], 0, SEED)).toBe(false);
    expect(isDailyDraw([partner, third, early.find((place) => ![partner.country, third.country].includes(place.country) && place !== partner && place !== third)!], 0, SEED)).toBe(true);
    const european = early.filter((place) => continentOf(place) === 'europe' && place.country !== 'RU');
    const three = [...new Map(european.map((place) => [place.country, place])).values()].slice(0, 3);
    expect(three).toHaveLength(3);
    expect(isDailyDraw(three, 0, SEED)).toBe(false);
  });
});
