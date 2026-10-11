import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { addXp, utcDay } from '../db/progress.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { socialGet, socialPost } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

async function signUp(username: string, standing: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW - DAY });
  for (const [column, value] of Object.entries(standing)) {
    // Column names here come from the tests below, never from input.
    await db.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [id, value]);
  }
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
  return id;
}

const idOf = (username: string): string => ids.get(username) ?? '';
const see = (query: string, as: string | null = null, now = NOW) =>
  socialGet(apiRequest('GET', `/api/social?profile=${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now));
const profile = async (query: string, as: string | null = null, now = NOW) => {
  const body = await (await see(query, as, now)).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const act = (as: string, action: string, username: string) => socialPost(apiRequest('POST', '/api/social', { body: { action, username }, cookie: cookies.get(as) }), at(NOW));
const viewsOf = async (username: string) => (await db.query<{ profile_views: number }>('SELECT profile_views FROM users WHERE id = $1', [idOf(username)]))[0]?.profile_views;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
  await signUp('neel');
  await signUp('other');
});

describe('a profile', () => {
  it('shows the country, the best guesser scores and the duel record with its place on the rating board', async () => {
    await db.query(
      "UPDATE users SET country = 'IN', best_country = 8000, best_continent = 10000, duel_wins = 5, duel_losses = 2, duel_ties = 1, rating = 700, rated_games = 8 WHERE id = $1",
      [idOf('neel')],
    );
    await db.query('UPDATE users SET rating = 900, rated_games = 3 WHERE id = $1', [idOf('other')]);
    expect(await profile('neel')).toMatchObject({
      country: 'IN',
      bestCountry: 8000,
      bestContinent: 10_000,
      duels: { wins: 5, losses: 2, ties: 1, winRate: 63, rank: 2 },
    });
    expect((await profile('other')).duels).toEqual({ wins: 0, losses: 0, ties: 0, winRate: 0, rank: 1 });
  });

  it('shows the 2v2 record beside the duels: wins, losses and ties, with the share won as a whole percent of them all', async () => {
    expect((await profile('neel')).teams).toEqual({ wins: 0, losses: 0, ties: 0, winRate: 0 });
    await db.query('UPDATE users SET team_wins = 5, team_losses = 2, team_ties = 1, duel_wins = 9 WHERE id = $1', [idOf('neel')]);
    expect((await profile('neel')).teams).toEqual({ wins: 5, losses: 2, ties: 1, winRate: 63 });
    expect((await profile('neel', 'neel')).teams).toEqual({ wins: 5, losses: 2, ties: 1, winRate: 63 });
    expect((await profile('other')).teams).toEqual({ wins: 0, losses: 0, ties: 0, winRate: 0 });
  });

  it('gives no rank to a player who is not on the rating board', async () => {
    expect((await profile('neel')).duels.rank).toBeNull();
    await db.query('UPDATE users SET rated_games = 3, last_seen_at = $2 WHERE id = $1', [idOf('neel'), new Date(NOW - 15 * DAY)]);
    expect((await profile('neel')).duels.rank).toBeNull();
    await db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [idOf('neel'), new Date(NOW - DAY)]);
    expect((await profile('neel')).duels.rank).toBe(1);
  });
});

describe('a profile’s view counter', () => {
  /** A look at a profile by nobody signed in, from the address given. */
  const visit = async (username: string, ip: string, now = NOW) =>
    (await (await socialGet(apiRequest('GET', `/api/social?profile=${username}`, { ip }), at(now))).json()).data;
  const MIDNIGHT = Date.UTC(2027, 0, 16);

  it('counts a view by a visitor, by a guest and by another player, and shows the count with that view in it', async () => {
    const guest = await createGuest(db, NOW);
    const guestCookie = `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`;
    expect((await visit('neel', '203.0.113.1')).views).toBe(1);
    const asGuest = await socialGet(apiRequest('GET', '/api/social?profile=neel', { cookie: guestCookie, ip: '203.0.113.2' }), at(NOW));
    expect((await asGuest.json()).data.views).toBe(2);
    expect((await profile('neel', 'other')).views).toBe(3);
    expect(await viewsOf('other')).toBe(0);
  });

  it('does not count the owner looking at their own', async () => {
    await profile('neel', 'other');
    expect((await profile('neel', 'neel')).views).toBe(1);
    expect((await profile('NEEL', 'neel')).views).toBe(1);
    expect(await viewsOf('neel')).toBe(1);
  });

  it('counts both of two views made at the same moment by two viewers', async () => {
    const seen = await Promise.all([profile('neel'), profile('neel', 'other')]);
    expect(seen.map((one) => one.views).sort()).toEqual([1, 2]);
    expect(await viewsOf('neel')).toBe(2);
  });

  it('counts an account once a day however often it looks, and again the next UTC day', async () => {
    for (let look = 0; look < 5; look += 1) {
      expect((await profile('neel', 'other', NOW + look * MINUTE)).views).toBe(1);
    }
    expect((await profile('neel', 'other', MIDNIGHT - 1)).views).toBe(1);
    expect((await profile('neel', 'other', MIDNIGHT)).views).toBe(2);
    expect((await profile('neel', 'other', MIDNIGHT + MINUTE)).views).toBe(2);
    expect(await viewsOf('neel')).toBe(2);
  });

  it('counts an account by who it is, wherever it looks from, and each account for itself', async () => {
    await signUp('third');
    const from = (as: string, ip: string) => socialGet(apiRequest('GET', '/api/social?profile=neel', { cookie: cookies.get(as), ip }), at(NOW));
    await from('other', '203.0.113.1');
    await from('other', '203.0.113.2');
    expect(await viewsOf('neel')).toBe(1);
    await from('third', '203.0.113.1');
    expect(await viewsOf('neel')).toBe(2);
  });

  it('counts a visitor by address: once a day from each, and a guest as the visitor at its address', async () => {
    expect((await visit('neel', '203.0.113.1')).views).toBe(1);
    expect((await visit('neel', '203.0.113.1', NOW + MINUTE)).views).toBe(1);
    expect((await visit('neel', '203.0.113.2')).views).toBe(2);
    // A new guest at an address that has looked today is not a new viewer: guests are free to make.
    const guest = await createGuest(db, NOW);
    const guestCookie = `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`;
    const asGuest = await socialGet(apiRequest('GET', '/api/social?profile=neel', { cookie: guestCookie, ip: '203.0.113.2' }), at(NOW));
    expect((await asGuest.json()).data.views).toBe(2);
    expect((await visit('neel', '203.0.113.1', MIDNIGHT)).views).toBe(3);
    // No address is kept as it came: only a keyed hash of it.
    const keys = (await db.query<{ key: string }>('SELECT key FROM rate_limits')).map((row) => row.key).join('\n');
    expect(keys).not.toContain('203.0.113');
  });

  it('counts each profile apart: having looked at one is not having looked at another', async () => {
    await signUp('third');
    await profile('neel', 'third');
    await profile('other', 'third');
    await profile('other', 'third');
    expect([await viewsOf('neel'), await viewsOf('other'), await viewsOf('third')]).toEqual([1, 1, 0]);
  });

  it('counts one of two looks made at the same moment by one viewer', async () => {
    const seen = await Promise.all([profile('neel', 'other'), profile('neel', 'other'), profile('neel', 'other')]);
    expect(await viewsOf('neel')).toBe(1);
    // The one that was counted shows the count with it in; the others show it as they found it.
    expect(seen.map((one) => one.views)).toContain(1);
    expect(seen.every((one) => one.views <= 1)).toBe(true);
    await Promise.all([visit('neel', '203.0.113.1'), visit('neel', '203.0.113.1'), visit('neel', '203.0.113.1')]);
    expect(await viewsOf('neel')).toBe(2);
    expect((await profile('neel', 'other', NOW + MINUTE)).views).toBe(2);
  });

  it('keeps counting for a player who changes their name: the views are the account’s', async () => {
    await profile('neel', 'other');
    await db.query("UPDATE users SET username = 'renamed' WHERE id = $1", [idOf('neel')]);
    expect((await profile('renamed', 'other')).views).toBe(1);
  });

  it('counts nothing for a name that is nobody’s', async () => {
    expect((await see('nobody')).status).toBe(404);
    expect(await db.query('SELECT 1 FROM users WHERE profile_views > 0')).toEqual([]);
  });
});

describe('what a profile says the player is to whoever is looking', () => {
  it('is nothing for a visitor or a guest', async () => {
    const guest = await createGuest(db, NOW);
    cookies.set('guest', `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`);
    expect((await profile('neel')).friend).toBeNull();
    expect((await profile('neel', 'guest')).friend).toBeNull();
  });

  it('is self, none, outgoing, incoming or friends for a signed-in player', async () => {
    expect((await profile('neel', 'neel')).friend).toBe('self');
    expect((await profile('neel', 'other')).friend).toBe('none');
    await act('other', 'request', 'neel');
    expect((await profile('neel', 'other')).friend).toBe('outgoing');
    expect((await profile('other', 'neel')).friend).toBe('incoming');
    await act('neel', 'accept', 'other');
    expect((await profile('neel', 'other')).friend).toBe('friends');
    expect((await profile('other', 'neel')).friend).toBe('friends');
  });
});

describe('whether a profile’s player is online', () => {
  it('goes by when they were last seen: within two minutes is online', async () => {
    expect(await profile('neel')).toMatchObject({ online: false, lastSeenAt: null });
    await db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [idOf('neel'), new Date(NOW)]);
    const lastSeenAt = new Date(NOW).toISOString();
    expect(await profile('neel', null, NOW + 2 * MINUTE - 1)).toMatchObject({ online: true, lastSeenAt });
    expect(await profile('neel', null, NOW + 2 * MINUTE)).toMatchObject({ online: false, lastSeenAt });
  });

  it('is all that is said of a player who hides when they were last seen: to a visitor, a guest, another player and a friend alike', async () => {
    await db.query('UPDATE users SET last_seen_at = $2, hide_last_seen = true WHERE id = $1', [idOf('neel'), new Date(NOW)]);
    const guest = await createGuest(db, NOW);
    cookies.set('guest', `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`);
    await act('other', 'request', 'neel');
    await act('neel', 'accept', 'other');
    for (const as of [null, 'guest', 'other']) {
      expect(await profile('neel', as, NOW + MINUTE)).toMatchObject({ online: true, lastSeenAt: null });
      expect(await profile('neel', as, NOW + 3 * MINUTE)).toMatchObject({ online: false, lastSeenAt: null });
    }
    // The player is still told their own.
    expect(await profile('neel', 'neel', NOW + 3 * MINUTE)).toMatchObject({ online: false, lastSeenAt: new Date(NOW).toISOString() });
    // And it is theirs to hide: another player's is shown as ever.
    await db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [idOf('other'), new Date(NOW)]);
    expect(await profile('other', 'neel', NOW + 3 * MINUTE)).toMatchObject({ online: false, lastSeenAt: new Date(NOW).toISOString() });
  });
});

describe('a profile’s history', () => {
  const days = async (query: string, now = NOW) => (await profile(query, null, now)).history.map((point: { day: string }) => point.day);
  const point = (daysAgo: number, xp: number, rating = 500) =>
    db.query('INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, $2, $3, $4)', [idOf('neel'), utcDay(NOW - daysAgo * DAY), xp, rating]);

  it('gives each day the standing and the place on both boards, with no rating place before the first rated game', async () => {
    await addXp(db, idOf('other'), 900, NOW - DAY);
    await addXp(db, idOf('neel'), 300, NOW - DAY);
    await db.query('UPDATE users SET rated_games = 1, rating = 520 WHERE id = $1', [idOf('neel')]);
    await addXp(db, idOf('neel'), 700, NOW);
    expect((await profile('neel')).history).toEqual([
      { day: '2027-01-14', xp: 300, rating: 500, xpRank: 2, ratingRank: null },
      { day: '2027-01-15', xp: 1000, rating: 520, xpRank: 1, ratingRank: 1 },
    ]);
  });

  it('has no places for a day recorded before places were kept', async () => {
    await point(3, 120);
    expect((await profile('neel')).history).toEqual([{ day: '2027-01-12', xp: 120, rating: 500, xpRank: null, ratingRank: null }]);
  });

  it('covers the last 30 days unless asked for 7 or for all, today included', async () => {
    for (const daysAgo of [0, 6, 7, 29, 30, 200]) {
      await point(daysAgo, 1000 - daysAgo);
    }
    const day = (daysAgo: number) => utcDay(NOW - daysAgo * DAY);
    expect(await days('neel')).toEqual([29, 7, 6, 0].map(day));
    expect(await days('neel&range=30')).toEqual([29, 7, 6, 0].map(day));
    expect(await days('neel&range=7')).toEqual([6, 0].map(day));
    expect(await days('neel&range=all')).toEqual([200, 30, 29, 7, 6, 0].map(day));
  });

  it('stops at the latest 365 points when asked for all, oldest of them first', async () => {
    await db.query(
      `INSERT INTO progress_days (user_id, day, xp, rating)
       SELECT $1::uuid, to_char($2::date - n, 'YYYY-MM-DD'), 1000 - n, 500 FROM generate_series(0, 399) AS n`,
      [idOf('neel'), utcDay(NOW)],
    );
    const all = await days('neel&range=all');
    expect(all).toHaveLength(365);
    expect(all[0]).toBe(utcDay(NOW - 364 * DAY));
    expect(all[364]).toBe(utcDay(NOW));
  });

  it.each(['90', '', 'week', '7;drop'])('cannot cover %j', async (range) => {
    const response = await see(`neel&range=${range}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Ask for a range of 7, 30 or all.' });
    expect(await viewsOf('neel')).toBe(0);
  });
});
