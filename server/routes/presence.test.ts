import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { socialGet, socialPost } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
  return id;
}

async function guest(name: string): Promise<void> {
  const made = await createGuest(db, NOW - 10 * MINUTE);
  await db.query('UPDATE users SET last_seen_at = NULL WHERE id = $1', [made.userId]);
  ids.set(name, made.userId);
  cookies.set(name, `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`);
}

const idOf = (username: string): string => ids.get(username) ?? '';
const get = (query: string, as: string | null = null, now = NOW, on: Db = db) =>
  socialGet(apiRequest('GET', `/api/social${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now, on));
const online = async (as: string | null = null, now = NOW, on: Db = db) => (await (await get('?online=1', as, now, on)).json()).data;
const act = (as: string, action: string, username: string) => socialPost(apiRequest('POST', '/api/social', { body: { action, username }, cookie: cookies.get(as) }), at(NOW));
const seenAt = async (username: string) => {
  const [row] = await db.query<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM users WHERE id = $1', [idOf(username)]);
  return row?.last_seen_at ? new Date(row.last_seen_at).getTime() : null;
};

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
  await signUp('neel');
  await signUp('friend');
});

describe('GET /api/social?online=1', () => {
  it('tells a visitor how many players are online, and writes nothing for them', async () => {
    const writes: string[] = [];
    const watching: Db = {
      query: (sql, params) => {
        if (!/^\s*SELECT/.test(sql)) {
          writes.push(sql);
        }
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    const response = await get('?online=1', null, NOW, watching);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: { online: 0 } });
    expect(writes).toEqual([]);
  });

  it('marks a signed-in caller as seen, and counts them', async () => {
    expect(await online('neel')).toEqual({ online: 1 });
    expect(await seenAt('neel')).toBe(NOW);
    expect(await seenAt('friend')).toBeNull();
    expect(await online('friend', NOW + MINUTE)).toEqual({ online: 2 });
    expect(await online()).toEqual({ online: 2 });
  });

  it('counts a guest too', async () => {
    await guest('guest');
    expect(await online('guest')).toEqual({ online: 1 });
    expect(await seenAt('guest')).toBe(NOW);
    expect(await online('neel')).toEqual({ online: 2 });
  });

  it('counts a player for two minutes after they were last seen', async () => {
    await online('neel');
    expect(await online(null, NOW + 2 * MINUTE - 1)).toEqual({ online: 1 });
    expect(await online(null, NOW + 2 * MINUTE)).toEqual({ online: 0 });
    // Each call is a fresh sighting.
    await online('neel', NOW + MINUTE);
    expect(await online(null, NOW + 3 * MINUTE - 1)).toEqual({ online: 1 });
  });

  it('counts nobody whose session is forged, and no deleted account', async () => {
    const forged = apiRequest('GET', '/api/social?online=1', { cookie: `${cookies.get('neel')}x` });
    expect((await (await socialGet(forged, at(NOW))).json()).data).toEqual({ online: 0 });
    expect(await seenAt('neel')).toBeNull();

    await db.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [idOf('friend'), new Date(NOW)]);
    expect(await online('friend')).toEqual({ online: 0 });
  });
});

describe('a friend in the friends list', () => {
  const friends = async (as: string, now = NOW) => (await (await get('?friends=1', as, now)).json()).data.friends;

  beforeEach(async () => {
    await act('neel', 'request', 'friend');
    await act('friend', 'accept', 'neel');
  });

  it('has their country, and is offline with no last sighting until their browser says it is there', async () => {
    await db.query("UPDATE users SET country = 'JP' WHERE id = $1", [idOf('friend')]);
    expect(await friends('neel')).toEqual([{ username: 'friend', country: 'JP', level: 1, league: 'Trekker', party: null, online: false, lastSeenAt: null }]);
  });

  it('is online for two minutes after each heartbeat, and after that says when they were last seen', async () => {
    await online('friend');
    const lastSeenAt = new Date(NOW).toISOString();
    expect(await friends('neel', NOW + 2 * MINUTE - 1)).toMatchObject([{ username: 'friend', online: true, lastSeenAt }]);
    expect(await friends('neel', NOW + 2 * MINUTE)).toMatchObject([{ username: 'friend', online: false, lastSeenAt }]);
    // Looking at the list is not a heartbeat.
    expect(await friends('friend', NOW + 2 * MINUTE)).toMatchObject([{ username: 'neel', online: false, lastSeenAt: null }]);
  });

  it('is only online or offline, with no last sighting, once they hide when they were last seen', async () => {
    await online('friend');
    await online('neel');
    await db.query('UPDATE users SET hide_last_seen = true WHERE id = $1', [idOf('friend')]);
    expect(await friends('neel', NOW + 2 * MINUTE - 1)).toMatchObject([{ username: 'friend', online: true, lastSeenAt: null }]);
    expect(await friends('neel', NOW + 2 * MINUTE)).toMatchObject([{ username: 'friend', online: false, lastSeenAt: null }]);
    // Hiding one's own does not hide anyone else's.
    expect(await friends('friend', NOW + 2 * MINUTE)).toMatchObject([{ username: 'neel', online: false, lastSeenAt: new Date(NOW).toISOString() }]);
    await db.query('UPDATE users SET hide_last_seen = false WHERE id = $1', [idOf('friend')]);
    expect(await friends('neel', NOW + 2 * MINUTE)).toMatchObject([{ username: 'friend', online: false, lastSeenAt: new Date(NOW).toISOString() }]);
  });
});
