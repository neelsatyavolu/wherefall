import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertMap, type LocationRow } from '../db/maps.js';
import { placesOn, roundOn } from '../games/testing.js';
import { distanceKm, scoreForDistance } from '../match/scoring.js';
import { knownPlace, scaleOf, type KnownPlace } from '../places/lists.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, scoredRound, testDb } from '../testing.js';
import { account, register } from './account.js';
import { gamesGet, saveGame } from './games.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const ANY_ID = expect.stringMatching(/^[0-9a-f-]{36}$/);
const MINUTE = 60_000;
const NOT_VALID = 'That game could not be saved: its details are not valid.';
const NOT_ON_MAP = 'That game could not be saved: its places are not on its map.';

let db: Db;
let cookie: string;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

type Spot = { id: string; lng: number; lat: number };

/** The first place of one list that is on a map. */
function firstOn(map: string, list = 0): KnownPlace {
  const [place] = placesOn(map, 1, list);
  if (!place) {
    throw new Error(`No place on ${map}`);
  }
  return place;
}

const game = (scores: number[], change: Record<string, unknown> = {}) => ({
  map: 'world',
  mode: 'no-move',
  timeLimit: 60,
  seed: 'seed1',
  rounds: scores.map((score) => scoredRound(score)),
  ...change,
});

/** A game of one round on each of the given places, every guess on the spot. */
const gameOn = (map: string, places: readonly Spot[], change: Record<string, unknown> = {}) => ({
  map,
  mode: 'move',
  timeLimit: 0,
  seed: 'seed1',
  rounds: places.map(({ id, lng, lat }) => ({ id, lng, lat, guessLng: lng, guessLat: lat })),
  ...change,
});

async function signUp(username: string): Promise<string> {
  const body = { username, password: 'correct horse battery' };
  return cookieFrom(await register(apiRequest('POST', '/api/account/register', { body }), at(NOW)));
}

const save = (body: unknown, now = NOW, session: string | undefined = cookie) =>
  saveGame(apiRequest('POST', '/api/games', { body, cookie: session }), at(now));
const saved = async (body: unknown, now = NOW) => (await (await save(body, now)).json()).data;
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
const roundsOf = async (id: string) => (await (await gamesGet(apiRequest('GET', `/api/games?id=${id}`, { cookie }), at(NOW))).json()).data.rounds;
const xpOf = async () => (await db.query<{ xp: number; best_streak: number }>('SELECT xp, best_streak FROM users WHERE username = $1', ['neel']))[0];

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  cookie = await signUp('neel');
});

describe('saveGame', () => {
  it('saves a finished game and works the totals out itself', async () => {
    const response = await save(game([5000, 2500, 0], { score: 999_999, maxScore: 1 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: ANY_ID, playedAt: new Date(NOW).toISOString(), map: 'world', mode: 'no-move', rounds: 3, score: 7500, maxScore: 15_000, xpEarned: 150, xpCapped: false },
    });
  });

  it('refuses a visitor who is not signed in', async () => {
    const response = await saveGame(apiRequest('POST', '/api/games', { body: game([5000]) }), at(NOW));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Sign in first.' });
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('refuses a forged session', async () => {
    expect((await save(game([5000]), NOW, `${cookie}x`)).status).toBe(401);
  });

  it('refuses a session whose account no longer exists', async () => {
    await db.query('DELETE FROM users');
    expect((await save(game([5000]))).status).toBe(401);
  });

  it('refuses a request sent from another site, even with a session', async () => {
    const request = apiRequest('POST', '/api/games', { body: game([5000]), cookie, headers: { origin: 'https://evil.example' } });
    expect((await saveGame(request, at(NOW))).status).toBe(403);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it.each([
    ['no rounds', game([])],
    ['more than ten rounds', game(Array.from({ length: 11 }, () => 100))],
    ['an unknown map', game([100], { map: 'mars' })],
    ['something that is not a game', 'hello'],
    ['a round that names no place', game([], { rounds: [{ ...scoredRound(100), id: undefined }] })],
    ['a round with an empty id', game([], { rounds: [scoredRound(100, { id: '' })] })],
    ['a round that does not say where its place is', game([], { rounds: [{ ...scoredRound(100), lng: undefined, lat: undefined }] })],
    ['a place off the globe', game([], { rounds: [scoredRound(100, { lng: 180.5 })] })],
    ['a place as text', game([], { rounds: [scoredRound(100, { lat: '48.85' })] })],
    ['a guess off the globe', game([], { rounds: [scoredRound(100, { guessLat: -91 })] })],
    ['half a guess', game([], { rounds: [scoredRound(100, { guessLat: null })] })],
    ['the other half of a guess', game([], { rounds: [scoredRound(0, { guessLng: 2 })] })],
    ['a hint that is not yes or no', game([], { rounds: [scoredRound(100, { hinted: 'yes' })] })],
    ['a NUL in a place id', game([], { rounds: [scoredRound(100, { id: 'a\u0000b' })] })],
  ])('refuses %s', async (_name, body) => {
    expect(await refusal(save(body))).toEqual([400, NOT_VALID]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('answers a double submit with the game already saved, and counts it once', async () => {
    const body = game([4000, 3000]);
    const first = await save(body);
    const second = await save(body, NOW + 2_000);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    const me = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW + 3_000));
    expect((await me.json()).data.stats).toMatchObject({ gamesPlayed: 1, roundsPlayed: 2 });
  });

  it('stops one account saving games without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await save(game([100], { seed: `s${index}` }))).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 201)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect((await save(game([100], { seed: 'later' }), NOW + 60 * MINUTE)).status).toBe(201);
  });
});

describe('the places of a saved game', () => {
  const french = placesOn('country:FR', 3);
  const paris = firstOn('country:FR');
  const berlin = firstOn('country:DE');
  const cairo = firstOn('africa');

  it('are stored as the server has them: where the list puts them, in the list’s country', async () => {
    const [round] = gameOn('world', [paris]).rounds;
    // What the browser makes of the country, the distance and the score is not read, however wrong.
    const { id, score } = await saved(gameOn('world', [], { rounds: [{ ...round, country: 'xx', distanceKm: -3, score: 5001 }] }));
    expect(score).toBe(5000);
    expect(await roundsOf(id)).toEqual([{ country: 'FR', distanceKm: 0, score: 5000, hinted: false, lng: paris.lng, lat: paris.lat, guessLng: paris.lng, guessLat: paris.lat }]);
  });

  it('may be a hair off where the list has them, as a number printed and read back is, and are stored where the list has them', async () => {
    const { id } = await saved(gameOn('world', [{ id: paris.id, lng: paris.lng + 0.00009, lat: paris.lat - 0.00009 }]));
    expect(await roundsOf(id)).toMatchObject([{ lng: paris.lng, lat: paris.lat }]);
  });

  it.each<[string, Spot[]]>([
    ['a place that is in no list', [{ id: 'not-a-real-panorama', lng: 1, lat: 1 }]],
    ['a known place said to be somewhere else', [{ id: paris.id, lng: paris.lng + 0.001, lat: paris.lat }]],
    ['the same place twice', [paris, paris]],
    ['places from both lists', [paris, firstOn('country:FR', 1)]],
  ])('refuses %s', async (_name, places) => {
    expect(await refusal(save(gameOn('world', places)))).toEqual([400, NOT_ON_MAP]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect(await xpOf()).toMatchObject({ xp: 0 });
  });

  it('have to be in the country of a country map, and in the region of a region map', async () => {
    expect((await save(gameOn('country:FR', french))).status).toBe(201);
    expect(await refusal(save(gameOn('country:FR', [...french, berlin], { seed: 'b' })))).toEqual([400, NOT_ON_MAP]);
    expect((await save(gameOn('europe', [paris, berlin], { seed: 'c' }))).status).toBe(201);
    expect(await refusal(save(gameOn('europe', [paris, cairo], { seed: 'd' })))).toEqual([400, NOT_ON_MAP]);
    expect((await save(gameOn('africa', [cairo], { seed: 'e' }))).status).toBe(201);
  });

  it('may all be from the second list', async () => {
    const places = placesOn('world', 3, 1);
    expect(knownPlace(places[0]?.id ?? '')?.list).toBe(1);
    expect((await save(gameOn('world', places))).status).toBe(201);
  });
});

describe('the scale a saved game is scored on', () => {
  const luxembourg = firstOn('country:LU');
  /** A guess one degree north of a place in Luxembourg: about 111 km off. */
  const nearMiss = { id: luxembourg.id, lng: luxembourg.lng, lat: luxembourg.lat, guessLng: luxembourg.lng, guessLat: luxembourg.lat + 1 };
  const off = distanceKm(luxembourg, { lng: nearMiss.guessLng, lat: nearMiss.guessLat });
  const body = (map: string, change: Record<string, unknown> = {}) => ({ map, mode: 'move', timeLimit: 0, seed: 's1', rounds: [nearMiss], ...change });

  it('is the world’s for the world map, whatever scale the browser names', async () => {
    const onWorld = scoreForDistance(off, 20_000);
    expect((await saved(body('world'))).score).toBe(onWorld);
    expect((await saved(body('world', { seed: 's2', scaleKm: 100 }))).score).toBe(onWorld);
    expect(onWorld).toBeGreaterThan(4500);
  });

  it('is the map’s own for a country, whatever scale the browser names', async () => {
    const onLuxembourg = scoreForDistance(off, scaleOf('country:LU', 0));
    const wide = await saved(body('country:LU', { scaleKm: 20_000 }));
    const narrow = await saved(body('country:LU', { seed: 's2', scaleKm: 100 }));
    const unnamed = await saved(body('country:LU', { seed: 's3' }));
    expect([wide.score, narrow.score, unnamed.score]).toEqual([onLuxembourg, onLuxembourg, onLuxembourg]);
    // Luxembourg is under 100 km from corner to corner: 111 km off is nearly nothing there, and nearly full marks on the world's scale.
    expect(onLuxembourg).toBeLessThan(100);
  });

  it('is the map’s own for a region, and for the same country in the other list, which is not quite as wide', async () => {
    expect((await saved(body('europe'))).score).toBe(scoreForDistance(off, scaleOf('europe', 0)));
    const round = roundOn(firstOn('country:LU', 1), 2500, scaleOf('country:LU', 1));
    expect((await saved(body('country:LU', { seed: 's2', rounds: [round] }))).score).toBe(2500);
    expect(scaleOf('country:LU', 1)).not.toBe(scaleOf('country:LU', 0));
  });

  it('takes anything at all as a scale, since it is not read', async () => {
    expect((await save(body('country:LU', { scaleKm: 'wide' }))).status).toBe(201);
  });
});

describe('a game on a map a player made', () => {
  const ROWS: LocationRow[] = [
    ['corner', 2.3, 48.8, 'FR'],
    ['square', 2.31, 48.81, 'FR'],
    ['bridge', 2.32, 48.82, 'FR'],
  ];
  const SPOTS: Spot[] = ROWS.map(([id, lng, lat]) => ({ id, lng, lat }));
  const MAP = 'community:paris-abc123';

  beforeEach(async () => {
    const [owner] = await db.query<{ id: string }>('SELECT id FROM users');
    await insertMap(db, 'paris-abc123', owner?.id ?? '', { name: 'Paris', description: 'Three corners of Paris.', details: '', locations: ROWS }, NOW);
  });

  it('is checked against the map’s own places, saved with no XP, and scored to at least 100 km', async () => {
    // A guess 0.1 degrees north of the first place: about 11 km off, on a map that is a few kilometres across.
    const [onTheSpot, ...rest] = gameOn(MAP, SPOTS).rounds;
    const response = await save(gameOn(MAP, [], { rounds: [{ ...onTheSpot, guessLat: 48.9 }, ...rest] }));
    expect(response.status).toBe(201);
    const km = distanceKm({ lng: 2.3, lat: 48.8 }, { lng: 2.3, lat: 48.9 });
    expect((await response.json()).data).toMatchObject({ map: MAP, rounds: 3, score: scoreForDistance(km, 100) + 10_000, xpEarned: 0, xpCapped: false });
    expect(scoreForDistance(km, 100)).toBeLessThan(2000);
    expect(await xpOf()).toMatchObject({ xp: 0 });
  });

  it('takes its country from the map', async () => {
    const { id } = await saved(gameOn(MAP, SPOTS.slice(0, 1)));
    expect(await roundsOf(id)).toMatchObject([{ country: 'FR', lng: 2.3, lat: 48.8 }]);
  });

  it.each<[string, Spot[]]>([
    ['a place the map does not have', [{ id: 'elsewhere', lng: 2.3, lat: 48.8 }]],
    ['a place of the map said to be somewhere else', [{ id: 'corner', lng: 2.4, lat: 48.8 }]],
    ['a place of the official lists', [firstOn('country:FR')]],
  ])('refuses %s', async (_name, places) => {
    expect(await refusal(save(gameOn(MAP, places)))).toEqual([400, NOT_ON_MAP]);
  });

  it('cannot be saved once the map is gone: there is nothing to check its places against', async () => {
    await db.query('DELETE FROM community_maps');
    expect(await refusal(save(gameOn(MAP, SPOTS)))).toEqual([400, NOT_ON_MAP]);
    expect(await refusal(save(gameOn('community:never-was', SPOTS)))).toEqual([400, NOT_ON_MAP]);
  });
});

describe('what a browser says of itself is not taken on trust', () => {
  it('refuses a streak that is only a number: the old body is not a run any more', async () => {
    expect(await refusal(save({ kind: 'streak', streak: 500, seed: 'a1' }))).toEqual([400, NOT_VALID]);
    expect(await xpOf()).toEqual({ xp: 0, best_streak: 0 });
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
  });

  it.each([
    ['country', 10],
    ['continent', 10],
  ])('refuses a %s guesser run that is only a number', async (kind, correct) => {
    expect(await refusal(save({ kind, correct, seed: 'a1' }))).toEqual([400, NOT_VALID]);
    expect(await xpOf()).toMatchObject({ xp: 0 });
  });

  it('refuses a perfect game on a made-up place, however it is scored', async () => {
    const madeUp = { id: 'not-a-real-panorama', country: 'ZZ', distanceKm: 0, score: 5000, lng: 1, lat: 1, guessLng: 1, guessLat: 1 };
    expect(await refusal(save({ map: 'world', mode: 'move', timeLimit: 0, seed: 's1', rounds: [madeUp] }))).toEqual([400, NOT_ON_MAP]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });
});

describe('the cap on XP from solo play', () => {
  const nearlyThere = () => db.query(`UPDATE users SET xp = 19950, solo_xp = 19950, solo_xp_day = '2027-01-15'`);

  it('stops paying at 20,000 a day, and says so, while the games are still saved', async () => {
    await nearlyThere();
    const first = await save(game([5000], { seed: 'a' }));
    expect(first.status).toBe(201);
    expect((await first.json()).data).toMatchObject({ score: 5000, xpEarned: 50, xpCapped: true });
    const second = await save(game([5000], { seed: 'b' }));
    expect(second.status).toBe(201);
    expect((await second.json()).data).toMatchObject({ score: 5000, xpEarned: 0, xpCapped: true });
    expect(await xpOf()).toMatchObject({ xp: 20_000 });
    expect(await db.query('SELECT xp_earned FROM games ORDER BY xp_earned')).toEqual([{ xp_earned: 0 }, { xp_earned: 50 }]);
  });

  it('does not say capped of a game that earned nothing anyway', async () => {
    await db.query(`UPDATE users SET xp = 20000, solo_xp = 20000, solo_xp_day = '2027-01-15'`);
    expect(await saved(game([0]))).toMatchObject({ score: 0, xpEarned: 0, xpCapped: false });
  });

  it('answers a repeat of a game it cut short as it answered the first', async () => {
    await nearlyThere();
    const body = game([5000, 5000]);
    const first = await save(body);
    const second = await save(body, NOW + 2_000);
    expect(second.status).toBe(200);
    const again = await second.json();
    expect(again.data).toMatchObject({ xpEarned: 50, xpCapped: true });
    expect(again).toEqual(await first.json());
    expect(await xpOf()).toMatchObject({ xp: 20_000 });
  });

  it('pays in full again the next day', async () => {
    await db.query(`UPDATE users SET xp = 20000, solo_xp = 20000, solo_xp_day = '2027-01-15'`);
    expect(await saved(game([5000]), NOW + 24 * 60 * MINUTE)).toMatchObject({ xpEarned: 100, xpCapped: false });
    expect(await xpOf()).toMatchObject({ xp: 20_100 });
  });

  it('is one cap for two games saved at the same moment', async () => {
    await nearlyThere();
    const replies = await Promise.all([saved(game([5000], { seed: 'a' })), saved(game([5000], { seed: 'b' }))]);
    expect(replies.map((reply) => reply.xpEarned).sort((a, b) => a - b)).toEqual([0, 50]);
    expect(replies.every((reply) => reply.xpCapped)).toBe(true);
    expect(await xpOf()).toMatchObject({ xp: 20_000 });
  });
});

describe('account, after games', () => {
  it('reports the stats and the recent games of the signed-in player only', async () => {
    const friend = await signUp('friend');
    await save(game([5000, 5000, 5000], { seed: 'f' }), NOW, friend);

    await save(game([5000, 3000, 1000, 0, 1001], { seed: 'a', mode: 'move' }), NOW);
    const scale = scaleOf('asia-oceania', 0);
    const rounds = placesOn('asia-oceania', 2).map((place, index) => roundOn(place, [4500, 4800][index] ?? 0, scale));
    await save(game([], { seed: 'b', map: 'asia-oceania', mode: 'nmpz', rounds }), NOW + MINUTE);

    const response = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW + 2 * MINUTE));
    // What else the account says of itself is the account route's own business, and its own tests'.
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        account: { username: 'neel', xp: 200 + 186, level: 2 },
        stats: {
          gamesPlayed: 2,
          roundsPlayed: 7,
          averageRoundScore: 2757,
          bestRoundScore: 5000,
          perfectRounds: 1,
          bestGame: { score: 9300, maxScore: 10_000 },
          ratedGames: 0,
        },
        recentGames: [
          { id: ANY_ID, playedAt: new Date(NOW + MINUTE).toISOString(), map: 'asia-oceania', mode: 'nmpz', rounds: 2, score: 9300, maxScore: 10_000 },
          { id: ANY_ID, playedAt: new Date(NOW).toISOString(), map: 'world', mode: 'move', rounds: 5, score: 10_001, maxScore: 25_000 },
        ],
      },
    });
  });

  it('shows at most the ten newest games', async () => {
    for (let index = 0; index < 12; index += 1) {
      await save(game([index], { seed: `s${index}` }), NOW + index * MINUTE);
    }
    const response = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW + 20 * MINUTE));
    const { stats, recentGames } = (await response.json()).data;
    expect(stats.gamesPlayed).toBe(12);
    expect(recentGames).toHaveLength(10);
    expect(recentGames.map((entry: { score: number }) => entry.score)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});
