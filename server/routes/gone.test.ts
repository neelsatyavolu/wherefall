import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { spreadPlaces } from '../places/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, scoredRound, testDb } from '../testing.js';
import { accountPost, register } from './account.js';
import { dailyPost } from './daily.js';
import { saveGame } from './games.js';
import { mapsGet, mapsPost } from './maps.js';
import { matchGet, matchPost } from './match.js';
import { socialGet } from './social.js';

// What a deleted account leaves behind in the parts of the site that are not
// about accounts: its seat, its likes, and the sessions of its other browsers.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PASSWORD = 'correct horse battery';
const SIGN_IN_FIRST = [401, 'Sign in first.'];
const GAME = { map: 'world', mode: 'move', timeLimit: 0, seed: 'abc', rounds: [scoredRound(4990)] };
const MAP = {
  action: 'save',
  name: 'Across France',
  description: 'Five places in a line across France.',
  locations: [0, 1, 2, 3, 4].map((index) => [`p${index}`, 2 + index, 48, 'FR']),
};
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 };

let db: Db;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });
const send = (route: (request: Request, context: Context) => Promise<Response>, path: string) => (body: unknown, cookie: string, now = NOW) =>
  route(apiRequest('POST', path, { body, cookie }), at(now));
const account = send(accountPost, '/api/account');
const game = send(saveGame, '/api/games');
const daily = send(dailyPost, '/api/daily');
const maps = send(mapsPost, '/api/maps');
const match = send(matchPost, '/api/match');

async function signUp(username: string, now = NOW): Promise<string> {
  return cookieFrom(await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD, email: `${username}@example.com` } }), at(now)));
}
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
const deleteAccount = (cookie: string, now = NOW) => data(account({ action: 'delete', password: PASSWORD }, cookie, now));
const likesOf = async (slug: string) => (await data(mapsGet(apiRequest('GET', `/api/maps?slug=${slug}`), at(NOW)))).likes;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('deleting an account', () => {
  it('takes the player out of the queue they were waiting in', async () => {
    const neel = await signUp('neel');
    const other = await signUp('other');
    await data(match({ action: 'queue', kind: 'team' }, neel));
    await data(match({ action: 'queue', kind: 'team' }, other));
    await deleteAccount(neel, NOW + 1000);
    expect(await db.query('SELECT u.username FROM match_queue q JOIN users u ON u.id = q.user_id')).toEqual([{ username: 'other' }]);
  });

  it('leaves the party they were hosting to the next player in it', async () => {
    const neel = await signUp('neel');
    const other = await signUp('other');
    const lobby = await data(match({ action: 'create', settings: SETTINGS }, neel));
    await data(match({ action: 'join', code: lobby.code }, other));
    await deleteAccount(neel, NOW + 1000);
    const seen = await data(matchGet(apiRequest('GET', `/api/match?id=${lobby.id}`, { cookie: other }), at(NOW + 2000)));
    expect(seen).toMatchObject({ phase: 'lobby', you: { username: 'other', isHost: true } });
    expect(seen.players.map((player: { username: string }) => player.username)).toEqual(['other']);
  });

  it('gives a duel they were playing to the other player', async () => {
    const neel = await signUp('neel');
    const other = await signUp('other');
    await data(match({ action: 'queue', kind: 'ranked' }, neel));
    const { matchId } = await data(match({ action: 'queue', kind: 'ranked' }, other, NOW + 1));
    await data(match({ action: 'places', matchId, places: spreadPlaces(5) }, neel, NOW + 2));
    await data(match({ action: 'guess', matchId, round: 0, lng: 0, lat: 0 }, other, NOW + 10_000));
    await deleteAccount(neel, NOW + 11_000);
    const seen = await data(matchGet(apiRequest('GET', `/api/match?id=${matchId}`, { cookie: other }), at(NOW + 12_000)));
    expect(seen).toMatchObject({ phase: 'finished', outcome: { winners: ['other'] } });
  });

  it('cannot be joined to anything new from a browser still signed in to it', async () => {
    const neel = await signUp('neel');
    await deleteAccount(neel);
    expect((await match({ action: 'create', settings: SETTINGS }, neel)).status).toBe(401);
    expect((await match({ action: 'queue', kind: 'unranked' }, neel)).status).toBe(401);
  });
});

describe('a browser still signed in to a deleted account', () => {
  let neel: string;
  let slug: string;

  beforeEach(async () => {
    neel = await signUp('neel');
    slug = (await data(maps(MAP, await signUp('mapmaker')))).slug;
    await deleteAccount(neel);
  });

  it.each([
    ['save a game', () => game(GAME, neel)],
    ['claim daily results', () => daily({ action: 'claim', results: [] }, neel)],
    ['publish a map', () => maps({ ...MAP, name: 'Another one' }, neel)],
    ['like a map', () => maps({ action: 'like', slug, liked: true }, neel)],
    ['report a map', () => maps({ action: 'report', slug, reason: 'wrong' }, neel)],
    ['start the daily', () => daily({ action: 'start' }, neel)],
    ['count a play of a map', () => maps({ action: 'play', slug }, neel)],
  ])('cannot %s', async (_name, ask) => {
    expect(await refusal(ask())).toEqual(SIGN_IN_FIRST);
  });

  it('is answered the same once the account is gone for good, rather than with an error', async () => {
    const later = NOW + 30 * DAY;
    await signUp('newcomer', later);
    expect(await db.query("SELECT 1 FROM users WHERE username = 'neel'")).toEqual([]);
    expect(await refusal(game(GAME, neel, later))).toEqual(SIGN_IN_FIRST);
    expect(await refusal(daily({ action: 'claim', results: [] }, neel, later))).toEqual(SIGN_IN_FIRST);
    expect(await refusal(maps({ action: 'like', slug, liked: true }, neel, later))).toEqual(SIGN_IN_FIRST);
  });

  it('marks nothing as begun or played when it asks', async () => {
    await daily({ action: 'start' }, neel);
    await maps({ action: 'play', slug }, neel);
    expect(await db.query('SELECT 1 FROM daily_attempts')).toEqual([]);
    expect(await db.query('SELECT plays FROM community_maps WHERE slug = $1', [slug])).toEqual([{ plays: 0 }]);
  });
});

describe('an account gone for good', () => {
  it('takes its likes with it, and the maps it liked count one fewer', async () => {
    const neel = await signUp('neel');
    const fan = await signUp('fan');
    const slug = (await data(maps(MAP, await signUp('mapmaker')))).slug;
    const other = (await data(maps({ ...MAP, name: 'Another one' }, await signUp('second')))).slug;
    for (const liked of [slug, other]) {
      await data(maps({ action: 'like', slug: liked, liked: true }, neel));
    }
    await data(maps({ action: 'like', slug, liked: true }, fan));
    expect([await likesOf(slug), await likesOf(other)]).toEqual([2, 1]);

    await deleteAccount(neel);
    // Hidden, not gone: the like still stands for as long as the account can be restored.
    expect([await likesOf(slug), await likesOf(other)]).toEqual([2, 1]);
    await signUp('newcomer', NOW + 30 * DAY);
    expect([await likesOf(slug), await likesOf(other)]).toEqual([1, 0]);
    await signUp('later', NOW + 31 * DAY);
    expect([await likesOf(slug), await likesOf(other)]).toEqual([1, 0]);
  });
});

describe("the day's XP board", () => {
  const board = async (cookie: string, now: number) =>
    (await data(socialGet(apiRequest('GET', '/api/social?leaderboard=xp&period=day', { cookie }), at(now)))).entries.map(
      (entry: { username: string; value: number }) => [entry.username, entry.value],
    );

  it('counts what was earned today, even for an account whose XP was never recorded by day', async () => {
    const neel = await signUp('neel');
    await db.query("UPDATE users SET xp = 900 WHERE username = 'neel'");
    await data(game(GAME, neel));
    await data(game({ ...GAME, seed: 'def' }, neel, NOW + MINUTE));
    expect(await board(neel, NOW + 2 * MINUTE)).toEqual([['neel', 200]]);
    expect(await board(neel, NOW + DAY)).toEqual([]);
    await data(game({ ...GAME, seed: 'ghi' }, neel, NOW + DAY));
    expect(await board(neel, NOW + DAY + MINUTE)).toEqual([['neel', 100]]);
  });
});
