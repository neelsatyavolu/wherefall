import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { COUNTDOWN_MS, PREPARE_MS } from '../match/types.js';
import { diagonalKm, scaleOf } from '../places/lists.js';
import { placesIn, spreadPlaces } from '../places/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { mapsPost } from './maps.js';
import { matchGet, matchPost } from './match.js';

// What a match is played on is the server's to say: the places a resolver's
// browser posts are held to the lists, and the scale is never the browser's.
const NOW = 1_800_000_000_000;
const SECOND = 1000;
const NOT_ON_MAP = [400, "Those places are not on this match's map."];
const NOT_SPREAD = [400, 'A world game needs places on at least three continents.'];
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 };

let db: Db;
let neel: string;
let friend: string;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

const post = (body: unknown, cookie: string | null, now = NOW) => matchPost(apiRequest('POST', '/api/match', { body, cookie: cookie ?? undefined }), at(now));
const get = (query: string, cookie: string, now = NOW) => matchGet(apiRequest('GET', `/api/match${query}`, { cookie }), at(now));
const data = async (response: Response | Promise<Response>) => {
  const body = await (await response).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};

/** A party of neel and friend, started and waiting for its places. */
async function preparing(settings: Record<string, unknown> = SETTINGS): Promise<string> {
  const lobby = await data(post({ action: 'create', settings }, neel));
  await data(post({ action: 'join', code: lobby.code }, friend));
  await data(post({ action: 'start', matchId: lobby.id }, neel));
  return lobby.id;
}

/** A ranked duel of neel (who is to post the places) and friend, waiting for its places. */
async function duel(): Promise<string> {
  await data(post({ action: 'queue', kind: 'ranked' }, neel, NOW - 1));
  return (await data(post({ action: 'queue', kind: 'ranked' }, friend))).matchId;
}

const places = (matchId: string, list: unknown[], more: Record<string, unknown> = {}) => ({ action: 'places', matchId, places: list, ...more });

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [neel, friend] = [await signUp('neel'), await signUp('friend')];
});

describe('the places a party is played on', () => {
  it('are taken from either list, as the list has them', async () => {
    for (const list of [0, 1]) {
      await resetDb(db);
      [neel, friend] = [await signUp('neel'), await signUp('friend')];
      const sent = spreadPlaces(3, list);
      const playing = await data(post(places(await preparing(), sent), neel));
      expect(playing).toMatchObject({ phase: 'playing', places: [sent[0]] });
    }
  });

  it.each([
    ['a place nobody has heard of', (list: ReturnType<typeof spreadPlaces>) => [{ ...list[0], id: 'made-up' }, list[1], list[2]]],
    ['a place that is not where the list has it', (list: ReturnType<typeof spreadPlaces>) => [{ ...list[0], lat: (list[0]?.lat ?? 0) + 0.01 }, list[1], list[2]]],
    ['the same place twice', (list: ReturnType<typeof spreadPlaces>) => [list[0], list[0], list[2]]],
    ['places from both lists', (list: ReturnType<typeof spreadPlaces>) => [list[0], list[1], spreadPlaces(1, 1)[0]]],
  ])('are refused when they include %s, and the match goes on waiting', async (_name, change) => {
    const matchId = await preparing();
    expect(await refusal(post(places(matchId, change(spreadPlaces(3))), neel))).toEqual(NOT_ON_MAP);
    expect((await data(get(`?id=${matchId}`, neel))).phase).toBe('preparing');
    // The resolver may still post the right ones.
    expect((await data(post(places(matchId, spreadPlaces(3)), neel))).phase).toBe('playing');
  });

  it('are the first ones posted when the resolver’s browser sends two lists at the same moment', async () => {
    const matchId = await preparing();
    const [one, other] = [spreadPlaces(3), spreadPlaces(6).slice(3)];
    const replies = await Promise.all([post(places(matchId, one), neel), post(places(matchId, other), neel)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    const [stored] = await db.query<{ places: Array<{ id: string }> }>('SELECT places FROM matches WHERE id = $1', [matchId]);
    const ids = stored?.places.map((place) => place.id);
    expect([one.map((place) => place.id), other.map((place) => place.id)]).toContainEqual(ids);
    const seen = await Promise.all([data(get(`?id=${matchId}`, neel)), data(get(`?id=${matchId}`, friend))]);
    expect(seen.map((state) => state.places[0].id)).toEqual([ids?.[0], ids?.[0]]);
  });

  it('need not be spread over the world: a party is its host’s business', async () => {
    const matchId = await preparing();
    expect((await data(post(places(matchId, placesIn('FR', 3)), neel))).phase).toBe('playing');
  });

  it('are still one for each round, from the resolver only, checked in that order', async () => {
    const matchId = await preparing();
    expect(await refusal(post(places(matchId, spreadPlaces(3)), friend))).toEqual([403, 'Only the player picking the places can post them.']);
    expect(await refusal(post(places(matchId, spreadPlaces(2)), neel))).toEqual([400, 'This match needs exactly 3 places.']);
    expect(await refusal(post(places(randomUUID(), [{ id: 'x', lng: 0, lat: 0, country: 'FR' }]), neel))).toEqual([404, 'That match does not exist, or you are not in it.']);
  });

  it('are held to the country on a country map, and scored on that country’s own scale in their list', async () => {
    const matchId = await preparing({ ...SETTINGS, map: 'country:FR' });
    expect(await refusal(post(places(matchId, spreadPlaces(3)), neel))).toEqual(NOT_ON_MAP);
    const french = placesIn('FR', 3);
    await data(post(places(matchId, french, { scaleKm: 20_000 }), neel));
    expect(await db.query('SELECT scale_km FROM matches WHERE id = $1', [matchId])).toEqual([{ scale_km: scaleOf('country:FR', 0) }]);
    expect(scaleOf('country:FR', 0)).toBeLessThan(3000);
  });

  it('are held to the community map the party is on, scored on its own scale and never a smaller one than 100 km', async () => {
    const rows = [0, 1, 2, 3, 4].map((index) => [`mine-${index}`, 2 + index / 100, 48 + index / 100, 'FR']);
    const saved = await data(mapsPost(apiRequest('POST', '/api/maps', { body: { action: 'save', name: 'A few streets', description: 'Five places a short walk apart.', locations: rows }, cookie: neel }), at(NOW)));
    const matchId = await preparing({ ...SETTINGS, map: `community:${saved.slug}` });
    const sent = rows.slice(0, 3).map(([id, lng, lat, country]) => ({ id, lng, lat, country }));
    // A place of the world lists is not a place of this map.
    expect(await refusal(post(places(matchId, spreadPlaces(3)), neel))).toEqual(NOT_ON_MAP);
    expect(await refusal(post(places(matchId, [{ ...sent[0], lng: 3 }, sent[1], sent[2]]), neel))).toEqual(NOT_ON_MAP);
    await data(post(places(matchId, sent), neel));
    expect(diagonalKm(rows.map(([, lng, lat]) => ({ lng: lng as number, lat: lat as number })))).toBeLessThan(100);
    expect(await db.query('SELECT scale_km FROM matches WHERE id = $1', [matchId])).toEqual([{ scale_km: 100 }]);
  });
});

describe('the places a ranked duel is played on', () => {
  it('cannot be made up, nor scored on a scale of the resolver’s choosing', async () => {
    const matchId = await duel();
    const invented = Array.from({ length: 5 }, (_unused, index) => ({ id: `fake-${index}`, lng: 10 + index, lat: 10, country: 'FR' }));
    expect(await refusal(post(places(matchId, invented, { scaleKm: 100 }), neel))).toEqual(NOT_ON_MAP);

    const sent = spreadPlaces(5);
    await data(post(places(matchId, sent, { scaleKm: 100 }), neel));
    expect(await db.query('SELECT scale_km FROM matches WHERE id = $1', [matchId])).toEqual([{ scale_km: 20_000 }]);
    // 55 km off is nearly a full score on the world's scale; at 100 km it would have been 21.
    const round = NOW + COUNTDOWN_MS;
    await data(post({ action: 'guess', matchId, round: 0, lng: sent[0]?.lng, lat: sent[0]?.lat }, neel, round));
    const revealed = await data(post({ action: 'guess', matchId, round: 0, lng: sent[0]?.lng, lat: (sent[0]?.lat ?? 0) + 0.5 }, friend, round));
    expect(revealed.results[0].guesses.map((guess: { score: number }) => guess.score)).toEqual([5000, expect.closeTo(4863, -1)]);
  });

  it('are spread over at least three continents, as are a public game’s and a 2v2 match’s', async () => {
    const matchId = await duel();
    const french = placesIn('FR', 5);
    expect(await refusal(post(places(matchId, french), neel))).toEqual(NOT_SPREAD);
    // Two continents are not enough either.
    const japanese = placesIn('JP', 2);
    expect(await refusal(post(places(matchId, [...french.slice(0, 3), ...japanese]), neel))).toEqual(NOT_SPREAD);
    expect((await data(post(places(matchId, [...french.slice(0, 3), japanese[0], placesIn('US', 1)[0]]), neel))).phase).toBe('playing');
  });

  it('counts against the resolver as a walk-out when they never come, and the other player is back in the queue', async () => {
    const matchId = await duel();
    // Posting places that are refused is not posting places.
    expect((await post(places(matchId, placesIn('FR', 5)), neel, NOW + 10 * SECOND)).status).toBe(400);
    // Both are there throughout: nobody walked away, the places just never came.
    await get(`?id=${matchId}`, neel, NOW + 20 * SECOND);
    await get(`?id=${matchId}`, friend, NOW + 20 * SECOND);
    const ended = await data(get(`?id=${matchId}`, friend, NOW + PREPARE_MS));
    expect(ended).toMatchObject({ phase: 'finished', outcome: { winners: [], ratingChanges: [], dodgedBy: 'neel' } });
    expect(await data(get('?queue=1', friend, NOW + PREPARE_MS))).toMatchObject({ queued: true, kind: 'ranked' });
    expect(await db.query("SELECT last_dodge_at IS NOT NULL AS noted FROM users WHERE username = 'neel'")).toEqual([{ noted: true }]);
  });
});
