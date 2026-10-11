import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { LocationRow } from '../db/maps.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, testDb } from '../testing.js';
import { mapsGet, mapsPost } from './maps.js';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const DESCRIPTION = 'Every arrondissement.';
const NOT_YOURS = 'You have no map by that name.';
const TOO_MANY_PLACES = [409, "An account's maps can hold 25,000 places in all. Make this one smaller, or delete another."];

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<void> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`);
}

/** `count` places in a line across France, each with its own id. */
const places = (count: number): LocationRow[] => Array.from({ length: count }, (_unused, index) => [`place-${index}`, 2 + index / 1000, 48 + index / 1000, 'FR']);
const map = (change: Record<string, unknown> = {}) => ({ action: 'save', name: 'Paris streets', description: DESCRIPTION, locations: places(5), ...change });

interface Sender {
  as?: string;
  now?: number;
  on?: Db;
}

const post = (body: unknown, { as = 'maker', now = NOW, on = db }: Sender = {}) => mapsPost(apiRequest('POST', '/api/maps', { body, cookie: cookies.get(as) }), at(now, on));
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
const publish = async (change: Record<string, unknown> = {}): Promise<string> => (await data(post(map(change)))).slug;
const held = async (owner = 'maker') =>
  (await db.query<{ held: number }>('SELECT coalesce(sum(places), 0)::int AS held FROM community_maps WHERE owner_id = $1', [ids.get(owner)]))[0]?.held;

/** A map said to hold `count` places, written straight into the table: what is counted is the number each map keeps of its places. */
async function mapOf(slug: string, count: number, owner = 'maker'): Promise<void> {
  await db.query(
    `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, created_at, updated_at)
     VALUES ($1, $2, 'A big map', $3, $4::jsonb, $5, $6::timestamptz, $6::timestamptz)`,
    [slug, ids.get(owner), DESCRIPTION, JSON.stringify(places(5)), count, new Date(NOW - HOUR).toISOString()],
  );
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
  await signUp('maker');
  await signUp('player');
});

describe('the places an account’s maps hold in all', () => {
  it('stop at 25,000: a map that would take them past it is refused, until another is deleted or made smaller', async () => {
    for (const slug of ['big-1', 'big-2', 'big-3', 'big-4']) {
      await mapOf(slug, 5000);
    }
    // The 25,000th place is one the account may have.
    expect((await post(map({ locations: places(4995) }))).status).toBe(201);
    const small = await publish();
    expect(await held()).toBe(25_000);

    expect(await refusal(post(map()))).toEqual(TOO_MANY_PLACES);
    expect(await held()).toBe(25_000);
    // It is the account's own: another's maps are another's.
    expect((await post(map({ locations: places(5000) }), { as: 'player' })).status).toBe(201);

    await data(post({ action: 'delete', slug: small }));
    expect((await post(map())).status).toBe(201);
    expect(await refusal(post(map()))).toEqual(TOO_MANY_PLACES);
  });

  it('count a map that is saved over at its new size, not at both', async () => {
    for (const slug of ['big-1', 'big-2', 'big-3', 'big-4']) {
      await mapOf(slug, 5000);
    }
    await mapOf('nearly', 4995);
    const small = await publish();
    expect(await held()).toBe(25_000);

    // The same size again, with a new name: nothing more is held.
    expect((await post(map({ slug: small, name: 'Renamed' }))).status).toBe(200);
    // One place more is one too many, and the map stays as it was.
    expect(await refusal(post(map({ slug: small, name: 'Grown', locations: places(6) })))).toEqual(TOO_MANY_PLACES);
    const kept = await data(mapsGet(apiRequest('GET', `/api/maps?slug=${small}`), at(NOW)));
    expect(kept).toMatchObject({ name: 'Renamed', places: 5 });

    // Making one smaller makes room in another.
    expect((await post(map({ slug: 'nearly' }))).status).toBe(200);
    expect((await post(map({ slug: small, locations: places(4995) }))).status).toBe(200);
    expect(await held()).toBe(25_000);
    expect(await refusal(post(map({ slug: small, locations: places(4996) })))).toEqual(TOO_MANY_PLACES);
  });

  it('are not what is said of a map that is not the account’s to save over, however full the account is', async () => {
    const theirs = await publish();
    for (const slug of ['big-1', 'big-2', 'big-3', 'big-4', 'big-5']) {
      await mapOf(slug, 5000, 'player');
    }
    expect(await refusal(post(map({ slug: theirs }), { as: 'player' }))).toEqual([404, NOT_YOURS]);
    expect(await refusal(post(map({ slug: 'no-such-map' }), { as: 'player' }))).toEqual([404, NOT_YOURS]);
    expect(await refusal(post(map(), { as: 'player' }))).toEqual(TOO_MANY_PLACES);
  });

  it('let one of two new maps through when both arrive with room for one', async () => {
    for (const slug of ['big-1', 'big-2', 'big-3', 'big-4']) {
      await mapOf(slug, 5000);
    }
    const slow = pausingAfter(db, /FROM community_maps/);
    const replies = await Promise.all([post(map({ locations: places(3000) }), { on: slow }), post(map({ locations: places(3000) }), { on: slow })]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
    expect(await held()).toBe(23_000);
  });

  it('let one of two maps grow when both are saved over at once with room for one', async () => {
    for (const slug of ['big-1', 'big-2', 'big-3']) {
      await mapOf(slug, 5000);
    }
    await mapOf('rest', 4990);
    const first = await publish({ name: 'The first' });
    const second = await publish({ name: 'The second' });
    expect(await held()).toBe(20_000);
    const slow = pausingAfter(db, /FROM community_maps/);
    const replies = await Promise.all([first, second].map((slug) => post(map({ slug, locations: places(3000) }), { on: slow })));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    expect(await held()).toBe(22_995);
  });

  it('let one through of a new map and a map saved over that arrive together with room for one', async () => {
    for (const slug of ['big-1', 'big-2', 'big-3', 'big-4']) {
      await mapOf(slug, 5000);
    }
    const small = await publish();
    const slow = pausingAfter(db, /FROM community_maps/);
    const replies = await Promise.all([post(map({ slug: small, locations: places(3000) }), { on: slow }), post(map({ locations: places(3000) }), { on: slow })]);
    expect(replies.map((reply) => reply.status).filter((status) => status === 409)).toHaveLength(1);
    expect(await held()).toBeLessThanOrEqual(25_000);
  });
});

describe('deleting maps', () => {
  it('cannot be asked for without end: 60 times an hour, each account for itself, banned or not', async () => {
    const slug = await publish();
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await post({ action: 'delete', slug: 'no-such-map' })).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 60 }, () => 404), 429]);
    expect(await refusal(post({ action: 'delete', slug }))).toEqual([429, 'Too many requests. Slow down a little.']);
    expect(await db.query('SELECT slug FROM community_maps')).toEqual([{ slug }]);
    expect((await post({ action: 'delete', slug: 'no-such-map' }, { as: 'player' })).status).toBe(404);
    expect(await data(post({ action: 'delete', slug }, { now: NOW + HOUR }))).toEqual({ deleted: true });

    // A banned account may still take its maps down, and is held to the same limit.
    await db.query('UPDATE users SET banned = true WHERE id = $1', [ids.get('player')]);
    for (let index = 0; index < 59; index += 1) {
      await post({ action: 'delete', slug: 'no-such-map' }, { as: 'player' });
    }
    expect((await post({ action: 'delete', slug: 'no-such-map' }, { as: 'player' })).status).toBe(429);
  });
});
