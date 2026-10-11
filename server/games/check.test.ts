import { describe, expect, it } from 'vitest';
import type { SavedGame } from '../account/input.js';
import { WORLD_SCALE_KM, distanceKm, scoreForDistance } from '../match/scoring.js';
import type { CommunityRow } from '../places/check.js';
import { scaleOf, type KnownPlace } from '../places/lists.js';
import { scoredRound } from '../testing.js';
import { checkedGame } from './check.js';
import { placesOn, roundOn } from './testing.js';

type Round = SavedGame['rounds'][number];

/** The first place of one list that is on a map. */
function firstOn(map: string, list = 0): KnownPlace {
  const [place] = placesOn(map, 1, list);
  if (!place) {
    throw new Error(`No place on ${map}`);
  }
  return place;
}

// A place in France, and a guess in London, a few hundred kilometres away.
const PLACE = firstOn('country:FR');
const LONDON = { guessLng: -0.1276, guessLat: 51.5072 };
const KM = distanceKm(PLACE, { lng: LONDON.guessLng, lat: LONDON.guessLat });

const round = (change: Partial<Round> = {}, place: KnownPlace = PLACE): Round => ({ id: place.id, lng: place.lng, lat: place.lat, ...LONDON, ...change });
const game = (rounds: Round[], change: Partial<SavedGame> = {}): SavedGame => ({ map: 'world', mode: 'move', timeLimit: 0, seed: 'abc', rounds, ...change });
const checked = (rounds: Round[], change: Partial<SavedGame> = {}, community: readonly CommunityRow[] | null = null) =>
  checkedGame(game(rounds, change), community)?.game.rounds.map(({ distanceKm: km, score }) => [km, score]);

describe('checkedGame', () => {
  it('works out the distance and the score from where the place is and where the guess was', () => {
    expect(checked([round()])).toEqual([[KM, scoreForDistance(KM, WORLD_SCALE_KM)]]);
    expect(KM).toBeGreaterThan(100);
  });

  it('pays no attention to the country, the score and the distance the browser claims', () => {
    const honest = checkedGame(game([round()]));
    const claiming = { ...round(), country: 'GB', score: 5000, distanceKm: 0 };
    expect(checkedGame(game([claiming]))).toEqual(honest);
    expect(honest?.game.rounds[0]).toMatchObject({ country: 'FR' });
    expect(honest?.game.rounds[0]?.score).toBeLessThan(4500);
  });

  it('gives full marks for a guess on the spot', () => {
    expect(checked([round({ guessLng: PLACE.lng, guessLat: PLACE.lat })])).toEqual([[0, 5000]]);
  });

  it('halves a hinted round, rounding down', () => {
    const [[, full] = [0, 0]] = checked([round()]) ?? [];
    expect(checked([round({ hinted: true })])).toEqual([[KM, Math.floor((full ?? 0) / 2)]]);
    expect(checked([round({ guessLng: PLACE.lng, guessLat: PLACE.lat, hinted: true })])).toEqual([[0, 2500]]);
    // An odd score, so that the half has to be rounded.
    expect(checked([scoredRound(4997, { hinted: true }) as Round])?.[0]?.[1]).toBe(2498);
    expect(checked([round({ hinted: false })])).toEqual(checked([round()]));
  });

  it('stores the place as the server has it, and the guess and the rest of the game as they were sent', () => {
    const nudged = round({ lng: PLACE.lng + 0.00005, hinted: true });
    const sent = { ...game([nudged], { seed: 'xyz', timeLimit: 60, daily: '2026-10-11' }), scaleKm: 100 };
    expect(checkedGame(sent)?.game).toEqual({
      map: 'world',
      mode: 'move',
      timeLimit: 60,
      seed: 'xyz',
      daily: '2026-10-11',
      rounds: [{ country: 'FR', lng: PLACE.lng, lat: PLACE.lat, ...LONDON, hinted: true, distanceKm: KM, score: expect.any(Number) }],
    });
    expect(checkedGame(game([round()]))?.game).not.toHaveProperty('daily');
    expect(checkedGame(game([round()]))?.game.rounds[0]).toMatchObject({ hinted: false });
  });

  it('says which places the game was on, and which list they are from', () => {
    const other = firstOn('world', 1);
    expect(checkedGame(game([round()]))).toMatchObject({ places: [{ id: PLACE.id, lng: PLACE.lng, lat: PLACE.lat, country: 'FR' }], list: 0 });
    expect(checkedGame(game([round({}, other)]))).toMatchObject({ places: [{ id: other.id }], list: 1 });
  });

  describe('the scale', () => {
    const onScale = (scaleKm: number) => scoreForDistance(KM, scaleKm);

    it("is the world's for the world map", () => {
      expect(checked([round()])).toEqual([[KM, onScale(WORLD_SCALE_KM)]]);
    });

    it("is the map's own for a country or a region: the diagonal of its places in the list the game is from", () => {
      expect(checked([round()], { map: 'country:FR' })).toEqual([[KM, onScale(scaleOf('country:FR', 0))]]);
      expect(checked([round()], { map: 'europe' })).toEqual([[KM, onScale(scaleOf('europe', 0))]]);
      const other = firstOn('country:FR', 1);
      const km = distanceKm(other, { lng: LONDON.guessLng, lat: LONDON.guessLat });
      expect(checked([round({}, other)], { map: 'country:FR' })).toEqual([[km, scoreForDistance(km, scaleOf('country:FR', 1))]]);
      expect(onScale(scaleOf('country:FR', 0))).toBeLessThan(onScale(scaleOf('europe', 0)));
    });

    it('is never one the browser names', () => {
      const named = (scaleKm: number, map: string) => checkedGame({ ...game([round()], { map }), scaleKm } as SavedGame)?.game.rounds[0]?.score;
      expect(named(100, 'world')).toBe(onScale(WORLD_SCALE_KM));
      expect(named(20_000, 'country:FR')).toBe(onScale(scaleOf('country:FR', 0)));
      expect(named(100, 'country:FR')).toBe(onScale(scaleOf('country:FR', 0)));
    });
  });

  describe('on a map a player made', () => {
    const ROWS: CommunityRow[] = [
      ['corner', 2.3, 48.8, 'FR'],
      ['far', 12.3, 41.8, 'IT'],
    ];
    const MAP = { map: 'community:two-cities-abc123' };
    const corner: Round = { id: 'corner', lng: 2.3, lat: 48.8, guessLng: 2.3, guessLat: 49.8 };

    it("is checked against the map's own places, with its country and on its scale", () => {
      const km = distanceKm({ lng: 2.3, lat: 48.8 }, { lng: 2.3, lat: 49.8 });
      const scale = distanceKm({ lng: 2.3, lat: 41.8 }, { lng: 12.3, lat: 48.8 });
      expect(checkedGame(game([corner], MAP), ROWS)).toEqual({
        game: { ...game([], MAP), rounds: [{ country: 'FR', lng: 2.3, lat: 48.8, guessLng: 2.3, guessLat: 49.8, hinted: false, distanceKm: km, score: scoreForDistance(km, scale) }] },
        places: [{ id: 'corner', lng: 2.3, lat: 48.8, country: 'FR' }],
        list: null,
      });
    });

    it('is scored to at least 100 km, however small the map', () => {
      const km = distanceKm({ lng: 2.3, lat: 48.8 }, { lng: 2.3, lat: 49.8 });
      expect(checked([corner], MAP, [['corner', 2.3, 48.8, 'FR']])).toEqual([[km, scoreForDistance(km, 100)]]);
    });

    it.each([
      ['a place the map does not have', [{ ...corner, id: 'elsewhere' }], ROWS],
      ['a place of the map said to be somewhere else', [{ ...corner, lng: 2.4 }], ROWS],
      ['a place of the official lists', [round()], ROWS],
      ['a map that is gone', [corner], null],
      ['a map with no places', [corner], []],
    ])('is null for %s', (_name, rounds, rows) => {
      expect(checkedGame(game(rounds, MAP), rows)).toBeNull();
    });
  });

  describe('a round with no guess', () => {
    it('scores nothing, and has no distance, whatever it claims', () => {
      expect(checked([round({ guessLng: null, guessLat: null })])).toEqual([[null, 0]]);
      expect(checked([round({ guessLng: undefined, guessLat: undefined })])).toEqual([[null, 0]]);
      expect(checked([{ ...round({ guessLng: null, guessLat: null }), score: 5000, distanceKm: 0 } as Round])).toEqual([[null, 0]]);
      expect(checkedGame(game([round({ guessLng: undefined, guessLat: undefined })]))?.game.rounds[0]).toMatchObject({ guessLng: null, guessLat: null });
    });
  });

  describe('a place that is not on the map', () => {
    const berlin = firstOn('country:DE');

    it.each<[string, Round[], Partial<SavedGame>]>([
      ['a place that is in no list', [round({ id: 'not-a-real-panorama' })], {}],
      ['a known place said to be somewhere else', [round({ lat: PLACE.lat + 0.001 })], {}],
      ['the same place twice', [round(), round()], {}],
      ['places from both lists', [round(), round({}, firstOn('world', 1))], {}],
      ['a place of another country, on a country map', [round({}, berlin)], { map: 'country:FR' }],
      ['a place of another region, on a region map', [round()], { map: 'africa' }],
      ['an official place, on a map a player made', [round()], { map: 'community:paris-abc123' }],
    ])('makes the game null: %s', (_name, rounds, change) => {
      expect(checkedGame(game(rounds, change))).toBeNull();
    });

    it('spoils the whole game, however good its other rounds', () => {
      expect(checkedGame(game([round(), round({ id: 'nowhere' }), round({}, berlin)]))).toBeNull();
    });
  });

  it('scores every round of a game on its own', () => {
    const rounds = [scoredRound(5000), scoredRound(1234), scoredRound(0), scoredRound(1)] as Round[];
    expect(checked(rounds)?.map(([, score]) => score)).toEqual([5000, 1234, 0, 1]);
  });
});

describe('scoredRound, the helper the other tests build games with', () => {
  it.each([5000, 4997, 4990, 4321, 2500, 1001, 100, 25, 1])('makes a round the server scores at exactly %i', (score) => {
    expect(checked([scoredRound(score) as Round])?.[0]?.[1]).toBe(score);
  });

  it.each([4998, 4999])('cannot make a round of %i: the game gives a score that close as 5000', (score) => {
    expect(checked([scoredRound(score) as Round])?.[0]?.[1]).toBe(5000);
  });

  it('is on another place each time, so ten of them make a game', () => {
    const rounds = Array.from({ length: 10 }, (_unused, index) => scoredRound(index * 500)) as Round[];
    expect(new Set(rounds.map((each) => each.id)).size).toBe(10);
    expect(checked(rounds)?.map(([, score]) => score)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
  });
});

describe('roundOn', () => {
  it.each(['country:FR', 'country:LU', 'europe', 'africa'])('makes a round the server scores as asked on the scale of %s', (map) => {
    const place = firstOn(map);
    // Not 4990: on a map as small as Luxembourg that is a guess within 30 metres, which the game gives full marks.
    for (const score of [4000, 2500, 100, 1]) {
      expect(checked([roundOn(place, score, scaleOf(map, 0)) as Round], { map })?.[0]?.[1]).toBe(score);
    }
  });
});
