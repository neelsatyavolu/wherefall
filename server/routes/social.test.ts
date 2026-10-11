import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { createParty, joinParty } from '../match/parties.js';
import { rename as renameUser } from '../db/social.js';
import { leaveMatch, startMatch } from '../match/play.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, scoredRound, testDb } from '../testing.js';
import { account, login, register } from './account.js';
import { saveGame } from './games.js';
import { RENAME_EVERY_MS, socialGet, socialPost } from './social.js';

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 } as const;
const NO_FRIENDS = { friends: [], incoming: [], outgoing: [], invites: [] };

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

/** An account made `madeAt`, with whatever standing it is given, and a browser signed in to it. */
async function signUp(username: string, standing: Record<string, number> = {}, madeAt = NOW): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: madeAt });
  for (const [column, value] of Object.entries(standing)) {
    // Column names here come from the tests below, never from input.
    await db.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [id, value]);
  }
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
  return id;
}

const idOf = (username: string): string => ids.get(username) ?? '';
const get = (query: string, as: string | null = null, now = NOW, on: Db = db) =>
  socialGet(apiRequest('GET', `/api/social${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now, on));
const post = (as: string | null, body: unknown, now = NOW, on: Db = db) =>
  socialPost(apiRequest('POST', '/api/social', { body, cookie: as === null ? undefined : cookies.get(as) }), at(now, on));
const data = async (response: Response | Promise<Response>) => {
  const body = await (await response).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const friendsOf = (as: string, now = NOW) => data(get('?friends=1', as, now));
const act = (as: string, action: string, username: string, now = NOW) => post(as, { action, username }, now);

/** Makes two players friends. */
async function befriend(a: string, b: string): Promise<void> {
  await data(act(a, 'request', b));
  await data(act(b, 'accept', a));
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
});

describe('GET /api/social?leaderboard=', () => {
  it('ranks the rated players by rating for a visitor, with each one’s level and league and nothing else', async () => {
    await signUp('nomad', { rating: 1350, rated_games: 4, xp: 1000 });
    await signUp('legend', { rating: 1800, rated_games: 9, xp: 250 });
    await signUp('explorer', { rating: 940, rated_games: 2 });
    await db.query("UPDATE users SET country = 'JP' WHERE username = 'legend'");
    const response = await get('?leaderboard=rating');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        board: 'rating',
        period: 'all',
        inactive: false,
        entries: [
          { rank: 1, username: 'legend', country: 'JP', value: 1800, level: 2, league: 'Legend' },
          { rank: 2, username: 'nomad', country: null, value: 1350, level: 3, league: 'Nomad' },
          { rank: 3, username: 'explorer', country: null, value: 940, level: 1, league: 'Explorer' },
        ],
        you: null,
      },
    });
  });

  it('ranks by XP and by best streak too', async () => {
    await signUp('walker', { xp: 5000, best_streak: 3 });
    await signUp('sprinter', { xp: 400, best_streak: 31 });
    expect((await data(get('?leaderboard=xp'))).entries).toEqual([
      { rank: 1, username: 'walker', country: null, value: 5000, level: 5, league: 'Trekker' },
      { rank: 2, username: 'sprinter', country: null, value: 400, level: 2, league: 'Trekker' },
    ]);
    expect((await data(get('?leaderboard=streak'))).entries.map((entry: { username: string; value: number }) => [entry.username, entry.value])).toEqual([
      ['sprinter', 31],
      ['walker', 3],
    ]);
  });

  it('lists only players who have something to rank on that board', async () => {
    await signUp('unrated', { rating: 1000, xp: 60 });
    await signUp('rated', { rating: 980, rated_games: 1 });
    await signUp('newcomer');
    expect((await data(get('?leaderboard=rating'))).entries.map((entry: { username: string }) => entry.username)).toEqual(['rated']);
    expect((await data(get('?leaderboard=xp'))).entries.map((entry: { username: string }) => entry.username)).toEqual(['unrated']);
    expect(await data(get('?leaderboard=streak'))).toEqual({ board: 'streak', period: 'all', inactive: false, entries: [], you: null });
  });

  it('breaks a tie the same way every time: whoever made their account first', async () => {
    await signUp('third', { xp: 700 }, NOW + 2 * MINUTE);
    await signUp('first', { xp: 700 }, NOW);
    await signUp('second', { xp: 700 }, NOW + MINUTE);
    await signUp('ahead', { xp: 701 }, NOW + 3 * MINUTE);
    for (let read = 0; read < 3; read += 1) {
      expect((await data(get('?leaderboard=xp'))).entries.map((entry: { rank: number; username: string }) => [entry.rank, entry.username])).toEqual([
        [1, 'ahead'],
        [2, 'first'],
        [3, 'second'],
        [4, 'third'],
      ]);
    }
    expect((await data(get('?leaderboard=xp', 'second'))).you).toEqual({ rank: 3, value: 700 });
  });

  it('shows the top 100, and tells a player further down exactly where they stand', async () => {
    for (let index = 0; index < 110; index += 1) {
      await signUp(`player${index}`, { xp: 10_000 - index * 10 }, NOW + index);
    }
    const board = await data(get('?leaderboard=xp', 'player106'));
    expect(board.entries).toHaveLength(100);
    expect(board.entries[0]).toMatchObject({ rank: 1, username: 'player0', value: 10_000 });
    expect(board.entries[99]).toMatchObject({ rank: 100, username: 'player99', value: 9010 });
    expect(board.you).toEqual({ rank: 107, value: 8940 });
    expect((await data(get('?leaderboard=xp', 'player109'))).you).toEqual({ rank: 110, value: 8910 });
  });

  it('tells a player in the top 100 their place as well, and one who is not on the board nothing', async () => {
    await signUp('leader', { best_streak: 40 });
    await signUp('runner', { best_streak: 12 });
    await signUp('newcomer');
    expect((await data(get('?leaderboard=streak', 'runner'))).you).toEqual({ rank: 2, value: 12 });
    expect((await data(get('?leaderboard=streak', 'leader'))).you).toEqual({ rank: 1, value: 40 });
    expect((await data(get('?leaderboard=streak', 'newcomer'))).you).toBeNull();
  });

  it('reads a board, and the asker’s place on it, in one query', async () => {
    for (let index = 0; index < 105; index += 1) {
      await signUp(`player${index}`, { rating: 1500 - index, rated_games: 1 }, NOW + index);
    }
    let queries = 0;
    const counting: Db = {
      query: (sql, params) => {
        queries += 1;
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    expect((await data(get('?leaderboard=rating', 'player104', NOW, counting))).you).toEqual({ rank: 105, value: 1396 });
    // One for the board, after the one that checks the asker's session.
    expect(queries).toBe(2);
    expect((await data(get('?leaderboard=rating&period=day', 'player104', NOW, counting))).you).toBeNull();
    expect(queries).toBe(4);
  });

  it.each(['?leaderboard=money', '?leaderboard=', '?leaderboard=rating;drop'])('refuses %s', async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'There is a leaderboard for rating, for xp and for streak.' });
  });

  it('refuses a request for nothing in particular', async () => {
    expect((await get('')).status).toBe(400);
  });
});

describe('GET /api/social?profile=', () => {
  it('shows anyone a player’s standing and latest games, and nothing private', async () => {
    await signUp('neel', { rating: 1512, rated_games: 14, xp: 2300, best_streak: 9 });
    const body = { map: 'world', mode: 'move', timeLimit: 0, seed: 'abc', rounds: [scoredRound(4990)] };
    const saved = await data(saveGame(apiRequest('POST', '/api/games', { body, cookie: cookies.get('neel') }), at(NOW + MINUTE)));

    const response = await get('?profile=neel');
    expect(response.status).toBe(200);
    const profile = (await response.json()).data;
    expect(profile).toEqual({
      username: 'neel',
      country: null,
      joinedAt: new Date(NOW).toISOString(),
      xp: 2300 + 100,
      level: 4,
      rating: 1512,
      league: 'Nomad',
      ratedGames: 14,
      gamesPlayed: 1,
      bestStreak: 9,
      bestCountry: 0,
      bestContinent: 0,
      duels: { wins: 0, losses: 0, ties: 0, winRate: 0, rank: 1 },
      teams: { wins: 0, losses: 0, ties: 0, winRate: 0 },
      views: 1,
      friend: null,
      online: false,
      lastSeenAt: null,
      recentGames: [{ id: saved.id, playedAt: new Date(NOW + MINUTE).toISOString(), map: 'world', mode: 'move', rounds: 1, score: 4990, maxScore: 5000 }],
      history: [{ day: '2027-01-15', xp: 2400, rating: 1512, xpRank: 1, ratingRank: 1 }],
    });
    expect(JSON.stringify(profile)).not.toContain(idOf('neel'));
    expect(JSON.stringify(profile)).not.toContain('not-a-real-hash');
  });

  it('finds a player whatever capitals the name is typed in', async () => {
    await signUp('neel');
    expect((await data(get('?profile=%20NeeL'))).username).toBe('neel');
  });

  it('shows at most the ten latest games', async () => {
    await signUp('neel');
    for (let index = 0; index < 12; index += 1) {
      const body = { map: 'world', mode: 'move', timeLimit: 0, seed: `s${index}`, rounds: [scoredRound(index)] };
      await saveGame(apiRequest('POST', '/api/games', { body, cookie: cookies.get('neel') }), at(NOW + index * MINUTE));
    }
    const profile = await data(get('?profile=neel'));
    expect(profile.gamesPlayed).toBe(12);
    expect(profile.recentGames).toHaveLength(10);
  });

  it('does not show who a player’s friends are, to a visitor or to another player', async () => {
    await signUp('neel');
    await signUp('buddy');
    await signUp('stranger');
    await befriend('neel', 'buddy');
    expect(JSON.stringify(await data(get('?profile=neel', 'stranger')))).not.toContain('buddy');
    expect(JSON.stringify(await data(get('?profile=neel')))).not.toContain('buddy');
    expect(await friendsOf('stranger')).toEqual(NO_FRIENDS);
  });

  it.each(['?profile=nobody', '?profile=', '?profile=no%20such%20name', "?profile=x'%20OR%201=1"])('answers 404 for %s', async (query) => {
    await signUp('neel');
    const response = await get(query);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'No player by that name.' });
  });
});

describe('friends', () => {
  beforeEach(async () => {
    await signUp('neel', { xp: 1000, rating: 1320 });
    await signUp('friend', { xp: 300 });
    await signUp('other');
  });

  it('are the signed-in player’s own business: a visitor is refused', async () => {
    const response = await get('?friends=1');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Sign in first.' });
    expect((await post(null, { action: 'request', username: 'neel' })).status).toBe(401);
  });

  it('are not for guests, who are told to make an account', async () => {
    const guest = await createGuest(db, NOW);
    cookies.set('guest', `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`);
    const refused = { success: false, error: 'Guests cannot do that. Make an account first.' };
    for (const response of [await get('?friends=1', 'guest'), await act('guest', 'request', 'neel'), await post('guest', { action: 'rename', username: 'a_name' })]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(refused);
    }
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
  });

  it('cannot be asked of a player who has turned friend requests off', async () => {
    await db.query('UPDATE users SET allow_requests = false WHERE id = $1', [idOf('friend')]);
    const response = await act('neel', 'request', 'friend');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'That player is not accepting friend requests.' });
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
  });

  it('can still be made by a player who has turned requests off: they ask, and the other accepts either way', async () => {
    await db.query('UPDATE users SET allow_requests = false WHERE id = $1', [idOf('friend')]);
    await data(act('friend', 'request', 'neel'));
    expect((await data(act('neel', 'accept', 'friend'))).friends).toMatchObject([{ username: 'friend' }]);
    await data(act('neel', 'remove', 'friend'));
    await data(act('friend', 'request', 'neel'));
    // Asking someone who has already asked you is accepting them.
    expect((await data(act('neel', 'request', 'friend'))).friends).toMatchObject([{ username: 'friend' }]);
    // And asking a friend again stays the harmless thing it was.
    expect((await act('neel', 'request', 'friend')).status).toBe(200);
  });

  it('start with nobody', async () => {
    expect(await friendsOf('neel')).toEqual(NO_FRIENDS);
  });

  it('begin with a request, which the asker sees as outgoing and the other as incoming', async () => {
    const response = await act('neel', 'request', 'friend');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ ...NO_FRIENDS, outgoing: ['friend'] });
    expect(await friendsOf('friend')).toEqual({ ...NO_FRIENDS, incoming: ['neel'] });
    expect(await friendsOf('other')).toEqual(NO_FRIENDS);
  });

  it('are made when the request is accepted, each seeing the other’s level and league', async () => {
    await data(act('neel', 'request', 'friend'));
    expect(await data(act('friend', 'accept', 'neel'))).toEqual({ ...NO_FRIENDS, friends: [{ username: 'neel', country: null, level: 3, league: 'Nomad', party: null, online: false, lastSeenAt: null }] });
    expect(await friendsOf('neel')).toEqual({ ...NO_FRIENDS, friends: [{ username: 'friend', country: null, level: 2, league: 'Trekker', party: null, online: false, lastSeenAt: null }] });
  });

  it('are made at once by asking someone who has already asked you', async () => {
    await data(act('neel', 'request', 'friend'));
    expect((await data(act('friend', 'request', 'neel'))).friends).toMatchObject([{ username: 'neel' }]);
    expect(await friendsOf('neel')).toMatchObject({ friends: [{ username: 'friend' }], outgoing: [] });
    expect(await db.query('SELECT accepted FROM friendships')).toEqual([{ accepted: true }]);
  });

  it('are made once when two players ask each other at the same moment', async () => {
    const slow = pausingAfter(db, /FROM friendships/);
    const ask = (as: string, username: string) => post(as, { action: 'request', username }, NOW, slow);
    const replies = await Promise.all([ask('neel', 'friend'), ask('friend', 'neel')]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(await db.query('SELECT accepted FROM friendships')).toEqual([{ accepted: true }]);
    expect((await friendsOf('neel')).friends).toHaveLength(1);
    expect((await friendsOf('friend')).friends).toHaveLength(1);
  });

  it('are asked once, however often the request is repeated, and stay friends when asked again', async () => {
    await data(act('neel', 'request', 'friend'));
    expect(await data(act('neel', 'request', 'friend'))).toEqual({ ...NO_FRIENDS, outgoing: ['friend'] });
    await data(act('friend', 'accept', 'neel'));
    expect((await data(act('neel', 'request', 'friend'))).friends).toHaveLength(1);
    expect((await data(act('friend', 'accept', 'neel'))).friends).toHaveLength(1);
    expect(await db.query('SELECT accepted FROM friendships')).toEqual([{ accepted: true }]);
  });

  it('cannot be made by accepting a request that was never sent, or one’s own', async () => {
    const never = await act('friend', 'accept', 'neel');
    expect(never.status).toBe(404);
    expect(await never.json()).toEqual({ success: false, error: 'That player has not asked to be your friend.' });
    await data(act('neel', 'request', 'friend'));
    expect((await act('neel', 'accept', 'friend')).status).toBe(404);
    expect(await friendsOf('neel')).toEqual({ ...NO_FRIENDS, outgoing: ['friend'] });
  });

  it('do not come of a request that is declined, and declining twice is harmless', async () => {
    await data(act('neel', 'request', 'friend'));
    expect(await data(act('friend', 'decline', 'neel'))).toEqual(NO_FRIENDS);
    expect(await data(act('friend', 'decline', 'neel'))).toEqual(NO_FRIENDS);
    expect(await friendsOf('neel')).toEqual(NO_FRIENDS);
  });

  it('are not undone by declining: that only answers a request', async () => {
    await befriend('neel', 'friend');
    expect((await data(act('neel', 'decline', 'friend'))).friends).toHaveLength(1);
    await data(act('neel', 'request', 'other'));
    expect((await data(act('neel', 'decline', 'other'))).outgoing).toEqual(['other']);
  });

  it('end, for both, when either removes the other', async () => {
    await befriend('neel', 'friend');
    expect(await data(act('friend', 'remove', 'neel'))).toEqual(NO_FRIENDS);
    expect(await friendsOf('neel')).toEqual(NO_FRIENDS);
    expect(await data(act('friend', 'remove', 'neel'))).toEqual(NO_FRIENDS);
  });

  it('can take back a request with remove', async () => {
    await data(act('neel', 'request', 'friend'));
    expect(await data(act('neel', 'remove', 'friend'))).toEqual(NO_FRIENDS);
    expect(await friendsOf('friend')).toEqual(NO_FRIENDS);
  });

  it.each(['request', 'accept', 'decline', 'remove'])('say only "No player by that name" when asked to %s someone who does not exist', async (action) => {
    for (const username of ['nobody', 'not a username!', '', 42]) {
      const response = await post('neel', { action, username });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ success: false, error: 'No player by that name.' });
    }
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
  });

  it('cannot be oneself', async () => {
    const response = await act('neel', 'request', 'NEEL');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'That is your own username.' });
  });

  it('stop at 100, counting requests still waiting, for the asker and for whoever accepts', async () => {
    const full = idOf('neel');
    for (let index = 0; index < 99; index += 1) {
      const id = await signUp(`filler${index}`);
      await db.query('INSERT INTO friendships (requester_id, addressee_id, accepted, created_at) VALUES ($1, $2, $3, $4)', [full, id, index % 2 === 0, new Date(NOW)]);
    }
    expect((await act('neel', 'request', 'friend')).status).toBe(200);
    const over = await act('neel', 'request', 'other');
    expect(over.status).toBe(409);
    expect((await over.json()).error).toBe('You have 100 friends and requests, which is the most there can be. Remove one first.');

    // Someone asks the full player: the full player cannot accept until there is room.
    await data(act('other', 'request', 'neel'));
    expect((await act('neel', 'accept', 'other')).status).toBe(409);
    await data(act('neel', 'remove', 'filler0'));
    expect((await act('neel', 'accept', 'other')).status).toBe(200);
  });

  it('show the code of the party lobby a friend is in, and only while it is a lobby', async () => {
    await befriend('neel', 'friend');
    await data(act('other', 'request', 'neel'));
    const lobby = await createParty(db, idOf('friend'), SETTINGS, NOW);
    const otherLobby = await createParty(db, idOf('other'), SETTINGS, NOW);
    if (!lobby.ok || !otherLobby.ok) {
      throw new Error('no lobby');
    }
    const seen = await friendsOf('neel');
    expect(seen.friends).toEqual([{ username: 'friend', country: null, level: 2, league: 'Trekker', party: lobby.data.code, online: false, lastSeenAt: null }]);
    // Someone who has only asked is not a friend, so their lobby is not shown.
    expect(JSON.stringify(seen)).not.toContain(otherLobby.data.code);

    await joinParty(db, idOf('neel'), lobby.data.code ?? '', NOW);
    await startMatch(db, idOf('friend'), lobby.data.id, NOW);
    expect((await friendsOf('neel')).friends[0].party).toBeNull();
  });

  it('refuse a request sent from another site, and one that asks for nothing known', async () => {
    const body = { action: 'request', username: 'friend' };
    const crossSite = apiRequest('POST', '/api/social', { body, cookie: cookies.get('neel'), headers: { origin: 'https://evil.example' } });
    expect((await socialPost(crossSite, at(NOW))).status).toBe(403);
    for (const body of [{ action: 'block', username: 'friend' }, { username: 'friend' }, 'request']) {
      const response = await post('neel', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, error: 'That is not something that can be asked here.' });
    }
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
  });

  it('cannot be requested without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await act('neel', 'request', 'nobody')).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect((await act('neel', 'request', 'friend', NOW + HOUR)).status).toBe(200);
  });

  it.each(['accept', 'decline', 'remove'])('cannot be asked to %s without end: 120 times an hour, each account for itself', async (action) => {
    const statuses: number[] = [];
    for (let index = 0; index < 121; index += 1) {
      statuses.push((await act('neel', action, 'nobody')).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 120 }, () => 404), 429]);
    const refused = await act('neel', action, 'friend');
    expect([refused.status, (await refused.json()).error]).toEqual([429, 'Too many requests. Slow down a little.']);
    expect((await act('other', action, 'nobody')).status).toBe(404);
    expect((await act('neel', action, 'nobody', NOW + HOUR)).status).toBe(404);
  });

  it('are counted apart: a player who has declined too often can still accept and remove', async () => {
    for (let index = 0; index < 121; index += 1) {
      await act('neel', 'decline', 'nobody');
    }
    expect((await act('neel', 'decline', 'friend')).status).toBe(429);
    await data(act('friend', 'request', 'neel'));
    expect((await act('neel', 'accept', 'friend')).status).toBe(200);
    expect((await act('neel', 'remove', 'friend')).status).toBe(200);
  });

  it('answer a player whose account is gone, or whose friend’s is, without leaving anything behind', async () => {
    await db.query('DELETE FROM users WHERE id = $1', [idOf('other')]);
    expect((await act('other', 'request', 'friend')).status).toBe(401);
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
  });
});

describe('party invites', () => {
  let code: string;
  let matchId: string;

  beforeEach(async () => {
    await signUp('host');
    await signUp('friend');
    await signUp('stranger');
    await befriend('host', 'friend');
    const lobby = await createParty(db, idOf('host'), SETTINGS, NOW);
    if (!lobby.ok) {
      throw new Error('no lobby');
    }
    code = lobby.data.code ?? '';
    matchId = lobby.data.id;
  });

  const inviteTo = (username: unknown, as = 'host', now = NOW, to: unknown = code) => post(as, { action: 'invite', username, code: to }, now);

  it('reach a friend, who sees who invited them and the code to join with', async () => {
    const response = await inviteTo('friend');
    expect(response.status).toBe(200);
    expect((await response.json()).data.friends).toMatchObject([{ username: 'friend' }]);
    expect((await friendsOf('friend')).invites).toEqual([{ from: 'host', code }]);
    expect((await friendsOf('host')).invites).toEqual([]);
    expect((await friendsOf('stranger')).invites).toEqual([]);
  });

  it('take the code as it is typed, in any capitals', async () => {
    expect((await inviteTo('friend', 'host', NOW, ` ${code.toLowerCase()} `)).status).toBe(200);
    expect((await friendsOf('friend')).invites).toEqual([{ from: 'host', code }]);
  });

  it('are for friends only', async () => {
    const response = await inviteTo('stranger');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'You can only invite your friends.' });
    await data(act('stranger', 'request', 'host'));
    expect((await inviteTo('stranger')).status).toBe(403);
    expect((await inviteTo('host')).status).toBe(403);
    expect(await db.query('SELECT 1 FROM party_invites')).toEqual([]);
  });

  it('need the inviter to be in that lobby', async () => {
    const outside = await inviteTo('host', 'friend');
    expect(outside.status).toBe(409);
    expect(await outside.json()).toEqual({ success: false, error: 'You can only invite a friend to a party whose lobby you are in.' });
    expect((await inviteTo('friend', 'host', NOW, 'ZZZZZZ')).status).toBe(409);

    await signUp('guest');
    await befriend('host', 'guest');
    await joinParty(db, idOf('guest'), code, NOW);
    await startMatch(db, idOf('host'), matchId, NOW);
    expect((await inviteTo('friend')).status).toBe(409);
  });

  it.each([
    ['nobody', 404, 'No player by that name.'],
    ['not a name!', 400, 'Invite a friend by their username, to a party by its code.'],
  ])('answer an invitation to %s plainly', async (username, status, error) => {
    const response = await inviteTo(username);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error });
  });

  it('refuse a code that could not be one', async () => {
    expect((await inviteTo('friend', 'host', NOW, 'nope')).status).toBe(400);
    expect((await inviteTo('friend', 'host', NOW, null)).status).toBe(400);
    expect((await post('host', { action: 'invite', username: 'friend' })).status).toBe(400);
  });

  it('last ten minutes', async () => {
    await data(inviteTo('friend'));
    expect((await friendsOf('friend', NOW + 10 * MINUTE - 1)).invites).toHaveLength(1);
    expect((await friendsOf('friend', NOW + 10 * MINUTE)).invites).toEqual([]);
  });

  it('go when the party starts or ends, and when the two stop being friends', async () => {
    await data(inviteTo('friend'));
    await data(act('friend', 'remove', 'host'));
    expect((await friendsOf('friend')).invites).toEqual([]);
    await befriend('host', 'friend');
    expect((await friendsOf('friend')).invites).toHaveLength(1);

    await leaveMatch(db, idOf('host'), matchId, NOW);
    expect((await friendsOf('friend')).invites).toEqual([]);
  });

  it('are replaced by a newer one from the same player, and old ones are cleared away', async () => {
    await data(inviteTo('friend'));
    await leaveMatch(db, idOf('host'), matchId, NOW);
    const next = await createParty(db, idOf('host'), SETTINGS, NOW + 11 * MINUTE);
    if (!next.ok) {
      throw new Error('no lobby');
    }
    const stale = [idOf('friend'), idOf('stranger'), 'OLDOLD', new Date(NOW)];
    await db.query('INSERT INTO party_invites (from_id, to_id, code, sent_at) VALUES ($1, $2, $3, $4)', stale);
    await data(inviteTo('friend', 'host', NOW + 11 * MINUTE, next.data.code));
    expect((await friendsOf('friend', NOW + 11 * MINUTE)).invites).toEqual([{ from: 'host', code: next.data.code }]);
    expect(await db.query('SELECT code FROM party_invites')).toEqual([{ code: next.data.code }]);
  });

  it('cannot be sent without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await inviteTo('friend')).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});

describe('rename', () => {
  beforeEach(async () => {
    await signUp('neel');
    await signUp('friend');
  });

  const rename = (as: string, username: unknown, now = NOW, on: Db = db) => post(as, { action: 'rename', username }, now, on);
  const whoAmI = async (as: string, now = NOW) => (await (await account(apiRequest('GET', '/api/account', { cookie: cookies.get(as) }), at(now))).json()).data.account?.username;

  it('changes the username, for the same session, everywhere it is shown', async () => {
    await befriend('neel', 'friend');
    const response = await rename('neel', ' Neel_The_2nd ');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel_the_2nd' } });

    expect(await whoAmI('neel')).toBe('neel_the_2nd');
    expect((await data(get('?profile=neel_the_2nd'))).username).toBe('neel_the_2nd');
    expect((await get('?profile=neel')).status).toBe(404);
    expect((await friendsOf('friend')).friends).toMatchObject([{ username: 'neel_the_2nd' }]);
    expect((await db.query('SELECT id FROM users WHERE username = $1', ['neel_the_2nd']))[0]).toEqual({ id: idOf('neel') });
  });

  it('frees the old name for someone else', async () => {
    await data(rename('neel', 'somebody_new'));
    expect((await rename('friend', 'neel')).status).toBe(200);
  });

  it.each([['ab'], ['has spaces'], ['way_too_long_for_a_username'], ['émile'], [''], [42], [undefined], ['_neel'], ['neel_'], ['ne__el'], ['bitchin_name']])(
    'follows the sign-up rules: refuses %s',
    async (username) => {
      const response = await rename('neel', username);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        error: 'A username is 3 to 20 letters, numbers or single underscores, not starting or ending with one.',
      });
      expect(await whoAmI('neel')).toBe('neel');
    },
  );

  it('still finds a player whose name was made before the rules, to befriend or to look at', async () => {
    await db.query("UPDATE users SET username = '_old__name_' WHERE id = $1", [idOf('friend')]);
    expect((await data(get('?profile=_old__name_'))).username).toBe('_old__name_');
    expect((await data(act('neel', 'request', '_Old__Name_'))).outgoing).toEqual(['_old__name_']);
  });

  it('refuses a name that is taken, whatever its capitals, and that does not use up the change', async () => {
    const taken = await rename('neel', 'FRIEND');
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ success: false, error: 'That username is taken. Choose another.' });
    expect((await rename('neel', 'free_name')).status).toBe(200);
  });

  it('refuses the name the player already has, and that does not use up the change either', async () => {
    const same = await rename('neel', 'Neel');
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ success: false, error: 'That is already your username.' });
    expect((await rename('neel', 'free_name')).status).toBe(200);
  });

  it('is allowed once every 30 days', async () => {
    await data(rename('neel', 'first_change'));
    const tooSoon = await rename('neel', 'second_change', NOW + RENAME_EVERY_MS - 1);
    expect(tooSoon.status).toBe(409);
    expect(await tooSoon.json()).toEqual({ success: false, error: 'You can change your username once every 30 days.' });
    expect(await whoAmI('neel', NOW + RENAME_EVERY_MS - 1)).toBe('first_change');
    // Thirty days is also how long a session lasts, so by then the player has signed in again.
    cookies.set('neel', `${accountCookieName(true)}=${createAccountSession(idOf('neel'), NOW + RENAME_EVERY_MS - 1, TEST_SECRET)}`);
    expect((await rename('neel', 'second_change', NOW + RENAME_EVERY_MS)).status).toBe(200);
  });

  it('gives a name to one of two players who ask for it at the same moment', async () => {
    const replies = await Promise.all([rename('neel', 'the_one'), rename('friend', 'the_one')]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await db.query('SELECT 1 FROM users WHERE username = $1', ['the_one'])).toHaveLength(1);
    const loser = replies[0]?.status === 409 ? 'neel' : 'friend';
    expect(await whoAmI(loser)).toBe(loser);
    // Losing the race did not use up the loser's change.
    expect((await rename(loser, 'another_one')).status).toBe(200);
  });

  it('lets one of a player’s own two changes through when both arrive at the same moment', async () => {
    const replies = await Promise.all([rename('neel', 'this_one'), rename('neel', 'that_one')]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(['this_one', 'that_one']).toContain(await whoAmI('neel'));
  });

  it('refuses a visitor, a request from another site, and an account that is gone', async () => {
    expect((await post(null, { action: 'rename', username: 'anyone' })).status).toBe(401);
    const body = { action: 'rename', username: 'anyone' };
    const crossSite = apiRequest('POST', '/api/social', { body, cookie: cookies.get('neel'), headers: { origin: 'https://evil.example' } });
    expect((await socialPost(crossSite, at(NOW))).status).toBe(403);
    await db.query('DELETE FROM users WHERE id = $1', [idOf('neel')]);
    expect((await rename('neel', 'anyone')).status).toBe(401);
  });

  it('does not mistake a failing database for a taken name', async () => {
    const failing: Db = { query: () => Promise.reject(new Error('connection lost')), transaction: db.transaction };
    await expect(renameUser(failing, idOf('neel'), 'anything', NOW, NOW - RENAME_EVERY_MS)).rejects.toThrow('connection lost');
  });

  it('cannot be tried without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      statuses.push((await rename('neel', 'friend')).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 10 }, () => 409), 429]);
  });

  it('keeps the password: the player signs in under the new name, and no longer under the old', async () => {
    const credentials = { username: 'traveller', password: 'correct horse battery', email: 'traveller@example.com' };
    const registered = await register(apiRequest('POST', '/api/account/register', { body: credentials }), at(NOW));
    const cookie = registered.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const renamed = await socialPost(apiRequest('POST', '/api/social', { body: { action: 'rename', username: 'wanderer' }, cookie }), at(NOW));
    expect(renamed.status).toBe(200);

    const signIn = (username: string) => login(apiRequest('POST', '/api/account/login', { body: { ...credentials, username } }), at(NOW));
    expect((await signIn('wanderer')).status).toBe(200);
    expect((await signIn('traveller')).status).toBe(401);
  });
});
