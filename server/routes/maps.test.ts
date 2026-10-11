import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { LocationRow } from '../db/maps.js';
import { insertUser } from '../db/users.js';
import { MAX_MAPS_PER_ACCOUNT, saveMap, slugFor } from '../maps/maps.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, scoredRound, testDb } from '../testing.js';
import { account } from './account.js';
import { saveGame } from './games.js';
import { mapsGet, mapsPost } from './maps.js';
import { matchPost } from './match.js';
import { socialGet } from './social.js';

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const BAD_MAP = 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.';
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
const DESCRIPTION = 'Every arrondissement.';
const NO_SUCH_MAP = 'There is no such map.';
const NOT_YOURS = 'You have no map by that name.';

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

/** `count` places in a line across France, each with its own id. */
const places = (count: number): LocationRow[] => Array.from({ length: count }, (_unused, index) => [`place-${index}`, 2 + index / 1000, 48 + index / 1000, 'FR']);
const map = (change: Record<string, unknown> = {}) => ({ action: 'save', name: 'Paris streets', description: DESCRIPTION, locations: places(5), ...change });

async function guest(): Promise<void> {
  const made = await createGuest(db, NOW);
  cookies.set('guest', `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`);
}

interface Sender {
  as?: string | null;
  now?: number;
  ip?: string;
  on?: Db;
}

const get = (query: string, { as = null, now = NOW, on = db }: Sender = {}) =>
  mapsGet(apiRequest('GET', `/api/maps${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now, on));
const post = (body: unknown, { as = 'maker', now = NOW, ip, on = db }: Sender = {}) =>
  mapsPost(apiRequest('POST', '/api/maps', { body, cookie: as === null ? undefined : cookies.get(as), ip }), at(now, on));
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

/** Publishes a map and gives back its slug. */
const publish = async (change: Record<string, unknown> = {}, sender: Sender = {}): Promise<string> => (await data(post(map(change), sender))).slug;
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
/** The count of likes a map keeps, beside the likes there really are. */
const counted = async (slug: string) =>
  (await db.query<{ likes: number; rows: number }>(
    'SELECT m.likes, (SELECT count(*) FROM map_likes l WHERE l.slug = m.slug)::int AS "rows" FROM community_maps m WHERE m.slug = $1',
    [slug],
  ))[0] ?? { likes: -1, rows: -1 };

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

describe('saving a map', () => {
  it('publishes it under a slug made from its name, and answers with the map as anyone will see it', async () => {
    const response = await post(map());
    expect(response.status).toBe(201);
    const saved = (await response.json()).data;
    expect(saved).toEqual({
      slug: expect.stringMatching(/^paris-streets-[0-9a-f]{6}$/),
      name: 'Paris streets',
      maker: 'maker',
      places: 5,
      plays: 0,
      likes: 0,
      liked: false,
      description: DESCRIPTION,
      details: '',
      createdAt: new Date(NOW).toISOString(),
      mine: true,
      locations: places(5),
    });
    expect(await data(get(`?slug=${saved.slug}`, { as: 'maker' }))).toEqual(saved);
  });

  it('gives two maps of the same name different slugs', async () => {
    expect(await publish()).not.toBe(await publish());
  });

  it('tidies the name and the description onto one line each, and masks the listed words in both', async () => {
    const saved = await data(post(map({ name: '  Shit   roads\nof Europe ', description: 'Fucking\n\n hard   roads, all of them.  ' })));
    expect(saved).toMatchObject({ name: '**** roads of Europe', description: '******* hard roads, all of them.' });
    expect(saved.slug).toMatch(/^roads-of-europe-[0-9a-f]{6}$/);
    expect(JSON.stringify(await stored('SELECT name, description FROM community_maps'))).not.toMatch(/shit|fuck/i);
  });

  it('keeps the long description with its line breaks, trimmed, and masks the listed words in it', async () => {
    const saved = await data(post(map({ details: '  Start in the north.\n\nThe south is shit.  ' })));
    expect(saved.details).toBe('Start in the north.\n\nThe south is ****.');
    expect(await data(get(`?slug=${saved.slug}`))).toMatchObject({ description: DESCRIPTION, details: saved.details });
    expect(JSON.stringify(await stored('SELECT details FROM community_maps'))).not.toMatch(/shit/i);
  });

  it('needs no long description', async () => {
    expect((await data(post(map({ details: undefined })))).details).toBe('');
    expect((await data(post(map({ details: '   ' })))).details).toBe('');
  });

  it.each([
    ['5 places', { locations: places(5) }],
    ['5000 places', { locations: places(5000) }],
    ['a name of 3 characters', { name: 'abc' }],
    ['a name of 30 characters', { name: 'n'.repeat(30) }],
    ['a description of 20 characters', { description: 'd'.repeat(20) }],
    ['a description of 100 characters', { description: 'd'.repeat(100) }],
    ['a long description of 1000 characters', { details: 'd'.repeat(1000) }],
    ['a place id of 64 characters', { locations: [['i'.repeat(64), 0, 0, 'FR'], ...places(4)] }],
    ['places at the corners of the map', { locations: [['a', -180, -90, 'AQ'], ['b', 180, 90, 'RU'], ...places(3)] }],
  ])('takes %s', async (_name, change) => {
    expect((await post(map(change))).status).toBe(201);
  });

  it('gives back all 5000 places, in the order they were sent', async () => {
    const slug = await publish({ locations: places(5000) });
    const read = await data(get(`?slug=${slug}`));
    expect(read.places).toBe(5000);
    expect(read.locations).toEqual(places(5000));
  });

  const row = (change: unknown[]): unknown[] => [change, ...places(4)];

  it.each([
    ['no name', { name: undefined }],
    ['a name of 2 characters', { name: 'ab' }],
    ['a name of 31 characters', { name: 'n'.repeat(31) }],
    ['a name that is only spaces', { name: '      ' }],
    ['a name that is not text', { name: 42 }],
    ['no description', { description: undefined }],
    ['an empty description', { description: '' }],
    ['a description of 19 characters', { description: 'd'.repeat(19) }],
    ['a description that is 20 characters only with its spaces', { description: `${' '.repeat(10)}${'d'.repeat(10)}` }],
    ['a description of 101 characters', { description: 'd'.repeat(101) }],
    ['a description that is not text', { description: ['x'] }],
    ['a long description of 1001 characters', { details: 'd'.repeat(1001) }],
    ['a long description that is not text', { details: 7 }],
    ['no places', { locations: undefined }],
    ['4 places', { locations: places(4) }],
    ['5001 places', { locations: places(5001) }],
    ['places that are not a list', { locations: 'everywhere' }],
    ['a place that is not a row', { locations: [{ id: 'a', lng: 0, lat: 0, country: 'FR' }, ...places(4)] }],
    ['a row with no country', { locations: row(['a', 0, 0]) }],
    ['a row with a fifth value', { locations: row(['a', 0, 0, 'FR', 'extra']) }],
    ['a place with no id', { locations: row(['', 0, 0, 'FR']) }],
    ['a place id of 65 characters', { locations: row(['i'.repeat(65), 0, 0, 'FR']) }],
    ['a place id that is not text', { locations: row([7, 0, 0, 'FR']) }],
    ['a longitude off the map', { locations: row(['a', 180.01, 0, 'FR']) }],
    ['a latitude off the map', { locations: row(['a', 0, -90.01, 'FR']) }],
    ['coordinates as text', { locations: row(['a', '2.35', '48.85', 'FR']) }],
    ['a country in small letters', { locations: row(['a', 0, 0, 'fr']) }],
    ['a country of three letters', { locations: row(['a', 0, 0, 'FRA']) }],
    ['a slug that could not be one', { slug: 'Not A Slug' }],
  ])('refuses %s, saving nothing', async (_name, change) => {
    expect(await refusal(post(map(change)))).toEqual([400, BAD_MAP]);
    expect(await stored('SELECT slug FROM community_maps')).toEqual([]);
  });

  it('refuses a visitor, a guest, a request from another site, and something that is not an action', async () => {
    expect(await refusal(post(map(), { as: null }))).toEqual([401, 'Sign in first.']);
    await guest();
    expect(await refusal(post(map(), { as: 'guest' }))).toEqual([403, GUESTS_CANNOT]);
    const crossSite = apiRequest('POST', '/api/maps', { body: map(), cookie: cookies.get('maker'), headers: { origin: 'https://evil.example' } });
    expect((await mapsPost(crossSite, at(NOW))).status).toBe(403);
    for (const body of [{ action: 'publish' }, { name: 'No action' }, 'save']) {
      expect(await refusal(post(body))).toEqual([400, 'That is not something a map can be asked to do.']);
    }
    expect(await stored('SELECT slug FROM community_maps')).toEqual([]);
  });

  it('answers an account that is gone as signed out', async () => {
    await db.query('DELETE FROM users WHERE id = $1', [ids.get('maker')]);
    expect((await post(map())).status).toBe(401);
  });

  it('stops at 20 maps an account, until one is deleted', async () => {
    const slugs: string[] = [];
    for (let index = 0; index < MAX_MAPS_PER_ACCOUNT; index += 1) {
      slugs.push(await publish({ name: `Map number ${index}` }));
    }
    expect(await refusal(post(map()))).toEqual([409, 'You have 20 maps, which is the most an account can have. Delete one first.']);
    expect((await post(map(), { as: 'player' })).status).toBe(201);
    // Saving over one of the twenty is not a twenty-first.
    expect((await post(map({ slug: slugs[0], name: 'Renamed' }))).status).toBe(200);

    await data(post({ action: 'delete', slug: slugs[1] }));
    expect((await post(map())).status).toBe(201);
  });

  it('lets one of two saves through when both arrive with one map to go', async () => {
    const maker = ids.get('maker') ?? '';
    for (let index = 0; index < MAX_MAPS_PER_ACCOUNT - 1; index += 1) {
      await saveMap(db, maker, { name: `Map ${index}`, description: DESCRIPTION, details: '', locations: places(5) }, NOW);
    }
    const slow = pausingAfter(db, /FROM community_maps/);
    const replies = await Promise.all([post(map(), { on: slow }), post(map(), { on: slow })]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
    expect(await stored('SELECT slug FROM community_maps')).toHaveLength(MAX_MAPS_PER_ACCOUNT);
  });

  it('cannot be done without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      statuses.push((await post(map({ locations: places(4) }))).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 30 }, () => 400), 429]);
  });
});

describe('slugFor', () => {
  const ending = () => 'abc123';

  it.each([
    ['Paris streets', 'paris-streets-abc123'],
    ['  --Côte d’Azur!!  ', 'c-te-d-azur-abc123'],
    ['100% Coverage (v2)', '100-coverage-v2-abc123'],
    ['日本の道', 'map-abc123'],
    ['***', 'map-abc123'],
    ['A name that is as long as a name can be!', 'a-name-that-is-as-long-as-a-name-abc123'],
  ])('turns %s into %s', (name, slug) => {
    expect(slugFor(name, ending)).toBe(slug);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(48);
  });

  it('ends in six random characters', () => {
    expect(slugFor('Paris')).toMatch(/^paris-[0-9a-f]{6}$/);
    expect(slugFor('Paris')).not.toBe(slugFor('Paris'));
  });

  it('tries again when a slug is taken, and gives up after a few tries', async () => {
    const maker = ids.get('maker') ?? '';
    const content = { name: 'Paris', description: DESCRIPTION, details: '', locations: places(5) };
    const endings = ['same', 'same', 'other'];
    const next = () => endings.shift() ?? 'spent';
    expect((await saveMap(db, maker, content, NOW, next)).ok).toBe(true);
    expect(await saveMap(db, maker, content, NOW, next)).toMatchObject({ ok: true, data: { slug: 'paris-other' } });
    await expect(saveMap(db, maker, content, NOW, () => 'same')).rejects.toThrow('Could not find a free map slug');
    expect(await stored('SELECT slug FROM community_maps ORDER BY slug')).toEqual([{ slug: 'paris-other' }, { slug: 'paris-same' }]);
  });
});

describe('saving over a map', () => {
  it('changes what it holds and keeps its slug, its plays, its likes and the day it was made', async () => {
    const slug = await publish();
    await data(post({ action: 'like', slug, liked: true }, { as: 'player' }));
    await data(post({ action: 'play', slug }, { as: 'player' }));

    const change = { slug, name: 'Paris, all of it', description: 'Both banks of the river.', details: 'Left, then right.', locations: places(8) };
    const response = await post(map(change), { now: NOW + HOUR });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      slug,
      name: 'Paris, all of it',
      maker: 'maker',
      places: 8,
      plays: 1,
      likes: 1,
      liked: false,
      description: 'Both banks of the river.',
      details: 'Left, then right.',
      createdAt: new Date(NOW).toISOString(),
      mine: true,
      locations: places(8),
    });
    expect(await stored('SELECT slug FROM community_maps')).toHaveLength(1);
    // Saved again without its long description, it has none.
    expect((await data(post(map({ slug })))).details).toBe('');
  });

  it("answers 404 for someone else's map, in the same words as for one that does not exist, and changes nothing", async () => {
    const slug = await publish();
    expect(await refusal(post(map({ slug, name: 'Taken over' }), { as: 'player' }))).toEqual([404, NOT_YOURS]);
    expect(await refusal(post(map({ slug: 'no-such-map' })))).toEqual([404, NOT_YOURS]);
    expect((await data(get(`?slug=${slug}`))).name).toBe('Paris streets');
  });
});

describe('deleting a map', () => {
  it('takes it away, with its likes and its reports', async () => {
    const slug = await publish();
    await data(post({ action: 'like', slug, liked: true }, { as: 'player' }));
    await data(post({ action: 'report', slug, reason: 'not a real place' }, { as: 'player' }));
    expect(await data(post({ action: 'delete', slug }))).toEqual({ deleted: true });
    expect((await get(`?slug=${slug}`)).status).toBe(404);
    for (const table of ['community_maps', 'map_likes', 'map_reports']) {
      expect(await stored(`SELECT 1 FROM ${table}`)).toEqual([]);
    }
  });

  it("answers 404 for someone else's map, a map that does not exist and a slug that could not be one, alike", async () => {
    const slug = await publish();
    for (const target of [slug, 'no-such-map', 'Not A Slug', undefined]) {
      expect(await refusal(post({ action: 'delete', slug: target }, { as: 'player' }))).toEqual([404, NOT_YOURS]);
    }
    expect(await stored('SELECT slug FROM community_maps')).toEqual([{ slug }]);
    expect((await post({ action: 'delete', slug }, { as: null })).status).toBe(401);
  });

  // How often it may be asked for, and how many places an account's maps may hold in all, are in map-limits.test.ts.
});

describe('GET /api/maps?slug=', () => {
  it('shows a visitor the map, not liked and not theirs, and nothing about who owns it but the name', async () => {
    const slug = await publish();
    const response = await get(`?slug=${slug}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const seen = (await response.json()).data;
    expect(seen).toMatchObject({ slug, maker: 'maker', liked: false, mine: false });
    expect(Object.keys(seen).sort()).toEqual(['createdAt', 'description', 'details', 'liked', 'likes', 'locations', 'maker', 'mine', 'name', 'places', 'plays', 'slug']);
    expect(JSON.stringify(seen)).not.toContain(ids.get('maker'));
  });

  it('tells the maker it is theirs, and a player who likes it that they do', async () => {
    const slug = await publish();
    await data(post({ action: 'like', slug, liked: true }, { as: 'player' }));
    expect(await data(get(`?slug=${slug}`, { as: 'maker' }))).toMatchObject({ mine: true, liked: false, likes: 1 });
    expect(await data(get(`?slug=${slug}`, { as: 'player' }))).toMatchObject({ mine: false, liked: true, likes: 1 });
  });

  it('reads a map of 500 places in one query, after the one that checks the session', async () => {
    const slug = await publish({ locations: places(500) });
    let queries = 0;
    const counting: Db = {
      query: (sql, params) => {
        queries += 1;
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    expect((await data(get(`?slug=${slug}`, { as: 'player', on: counting }))).locations).toHaveLength(500);
    expect(queries).toBe(2);
  });

  it.each(['no-such-map', 'Not%20A%20Slug', '', "x'%20OR%201=1", 'a'.repeat(49)])('answers 404 for %s', async (slug) => {
    await publish();
    expect(await refusal(get(`?slug=${slug}`))).toEqual([404, NO_SUCH_MAP]);
  });

  it('answers 404 for the map of a banned account to everyone but its maker, until the ban is lifted', async () => {
    const slug = await publish();
    await db.query('UPDATE users SET banned = true WHERE id = $1', [ids.get('maker')]);
    for (const as of [null, 'player']) {
      expect(await refusal(get(`?slug=${slug}`, { as }))).toEqual([404, NO_SUCH_MAP]);
    }
    expect(await data(get(`?slug=${slug}`, { as: 'maker' }))).toMatchObject({ slug, maker: 'maker', mine: true });
    await db.query('UPDATE users SET banned = false WHERE id = $1', [ids.get('maker')]);
    expect(await data(get(`?slug=${slug}`))).toMatchObject({ slug, maker: 'maker', mine: false });
  });

  it('answers 404 for the map of a deleted account, to a browser still signed in to it too, until the account is restored', async () => {
    const slug = await publish();
    await db.query('UPDATE users SET deleted_at = $2::timestamptz WHERE id = $1', [ids.get('maker'), new Date(NOW).toISOString()]);
    for (const as of [null, 'player', 'maker']) {
      expect(await refusal(get(`?slug=${slug}`, { as }))).toEqual([404, NO_SUCH_MAP]);
    }
    await db.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [ids.get('maker')]);
    expect((await get(`?slug=${slug}`)).status).toBe(200);
  });

  it('refuses a request for neither a map nor a list', async () => {
    expect((await get('')).status).toBe(400);
  });
});

describe('liking a map', () => {
  it('counts one like an account, however often it is sent, and takes it back when asked', async () => {
    const slug = await publish();
    const liked = { slug, name: 'Paris streets', maker: 'maker', description: DESCRIPTION, places: 5, plays: 0, likes: 1, liked: true };
    expect(await data(post({ action: 'like', slug, liked: true }, { as: 'player' }))).toEqual(liked);
    expect(await data(post({ action: 'like', slug, liked: true }, { as: 'player' }))).toEqual(liked);
    expect(await data(post({ action: 'like', slug, liked: true }, { as: 'maker' }))).toMatchObject({ likes: 2, liked: true });
    expect(await data(post({ action: 'like', slug, liked: false }, { as: 'player' }))).toMatchObject({ likes: 1, liked: false });
    expect(await data(post({ action: 'like', slug, liked: false }, { as: 'player' }))).toMatchObject({ likes: 1, liked: false });
    expect(await counted(slug)).toEqual({ likes: 1, rows: 1 });
  });

  it('never counts below nothing: taking back a like that was never given changes nothing', async () => {
    const slug = await publish();
    expect(await data(post({ action: 'like', slug, liked: false }, { as: 'player' }))).toMatchObject({ likes: 0, liked: false });
    expect(await counted(slug)).toEqual({ likes: 0, rows: 0 });
  });

  it('counts once when one account likes twice at the same moment', async () => {
    const slug = await publish();
    const replies = await Promise.all([post({ action: 'like', slug, liked: true }, { as: 'player' }), post({ action: 'like', slug, liked: true }, { as: 'player' })]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect((await data(get(`?slug=${slug}`))).likes).toBe(1);
    expect(await counted(slug)).toEqual({ likes: 1, rows: 1 });
  });

  it('counts every like when many accounts like at the same moment', async () => {
    const slug = await publish();
    const fans = Array.from({ length: 8 }, (_unused, index) => `fan${index}`);
    for (const fan of fans) {
      await signUp(fan);
    }
    const replies = await Promise.all(fans.map((as) => post({ action: 'like', slug, liked: true }, { as })));
    expect(replies.map((reply) => reply.status)).toEqual(fans.map(() => 200));
    expect(await counted(slug)).toEqual({ likes: 8, rows: 8 });

    // Half take theirs back while the maker and a player add theirs.
    await Promise.all([
      ...fans.slice(0, 4).map((as) => post({ action: 'like', slug, liked: false }, { as })),
      ...['maker', 'player'].map((as) => post({ action: 'like', slug, liked: true }, { as })),
    ]);
    expect(await counted(slug)).toEqual({ likes: 6, rows: 6 });
    expect((await data(get(`?slug=${slug}`))).likes).toBe(6);
  });

  it('keeps the count in step when one account likes and takes it back at the same moment', async () => {
    const slug = await publish();
    for (const start of [true, false]) {
      await data(post({ action: 'like', slug, liked: start }, { as: 'player' }));
      const replies = await Promise.all([true, false, true, false].map((liked) => post({ action: 'like', slug, liked }, { as: 'player' })));
      expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200]);
      const now = await counted(slug);
      expect(now.likes).toBe(now.rows);
      expect((await data(get(`?slug=${slug}`, { as: 'player' }))).liked).toBe(now.rows === 1);
    }
  });

  it('counts in the same statement as the like, so the two cannot come apart', async () => {
    const slug = await publish();
    const asked: string[] = [];
    const watching: Db = {
      query: (sql, params) => {
        asked.push(sql);
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    await data(post({ action: 'like', slug, liked: true }, { as: 'player', on: watching }));
    await data(post({ action: 'like', slug, liked: false }, { as: 'player', on: watching }));
    const writes = asked.filter((sql) => /map_likes/.test(sql) && /INSERT|DELETE/.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes.every((sql) => /UPDATE community_maps/.test(sql))).toBe(true);
  });

  it('refuses a visitor, a guest, a map that does not exist, and a like that does not say which way', async () => {
    const slug = await publish();
    expect((await post({ action: 'like', slug, liked: true }, { as: null })).status).toBe(401);
    await guest();
    expect(await refusal(post({ action: 'like', slug, liked: true }, { as: 'guest' }))).toEqual([403, GUESTS_CANNOT]);
    expect(await refusal(post({ action: 'like', slug: 'no-such-map', liked: true }))).toEqual([404, NO_SUCH_MAP]);
    expect(await refusal(post({ action: 'like', slug: 'no-such-map', liked: false }))).toEqual([404, NO_SUCH_MAP]);
    for (const body of [{ action: 'like', slug }, { action: 'like', slug, liked: 'yes' }, { action: 'like', liked: true }]) {
      expect(await refusal(post(body))).toEqual([400, 'Name a map and say whether you like it.']);
    }
    expect(await stored('SELECT 1 FROM map_likes')).toEqual([]);
  });

  it('cannot be done without end', async () => {
    const slug = await publish();
    const statuses = new Set<number>();
    for (let index = 0; index < 120; index += 1) {
      statuses.add((await post({ action: 'like', slug, liked: index % 2 === 0 }, { as: 'player' })).status);
    }
    expect([...statuses]).toEqual([200]);
    expect((await post({ action: 'like', slug, liked: true }, { as: 'player' })).status).toBe(429);
  });
});

describe('counting a play', () => {
  it('needs an account: a visitor is told to sign in, a guest to make one, and neither is counted', async () => {
    const slug = await publish();
    await guest();
    expect(await refusal(post({ action: 'play', slug }, { as: null, ip: '10.0.0.1' }))).toEqual([401, 'Sign in first.']);
    expect(await refusal(post({ action: 'play', slug }, { as: 'guest', ip: '10.0.0.1' }))).toEqual([403, 'Guests cannot do that. Make an account first.']);
    expect((await data(get(`?slug=${slug}`))).plays).toBe(0);
    expect(await stored('SELECT key FROM rate_limits WHERE key LIKE $1', ['map-play%'])).toEqual([]);
  });

  it('counts one play an hour from each account: once wherever they play from, and apart from others at the same address', async () => {
    const slug = await publish();
    expect(await data(post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1' }))).toEqual({ plays: 1 });
    expect(await data(post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.9', now: NOW + HOUR - 1 }))).toEqual({ plays: 1 });
    expect(await data(post({ action: 'play', slug }, { as: 'maker', ip: '10.0.0.1' }))).toEqual({ plays: 2 });
    expect(await data(post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1', now: NOW + HOUR }))).toEqual({ plays: 3 });
  });

  it('counts each map on its own', async () => {
    const [one, two] = [await publish(), await publish()];
    await data(post({ action: 'play', slug: one }, { as: 'player' }));
    expect(await data(post({ action: 'play', slug: two }, { as: 'player' }))).toEqual({ plays: 1 });
  });

  it('counts once when one player starts the same map twice at the same moment', async () => {
    const slug = await publish();
    await Promise.all([post({ action: 'play', slug }, { as: 'player' }), post({ action: 'play', slug }, { as: 'player' })]);
    expect((await data(get(`?slug=${slug}`))).plays).toBe(1);
  });

  it.each(['no-such-map', 'Not A Slug', undefined, 7])('answers 404 for %s', async (slug) => {
    await publish();
    expect(await refusal(post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1' }))).toEqual([404, NO_SUCH_MAP]);
    expect(await stored('SELECT key FROM rate_limits WHERE key LIKE $1', ['map-played:%'])).toEqual([]);
  });

  it('is limited by address, 120 an hour, and that limit is no other address’s', async () => {
    const slug = await publish();
    const statuses = new Set<number>();
    for (let index = 0; index < 120; index += 1) {
      statuses.add((await post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1' })).status);
    }
    expect([...statuses]).toEqual([200]);
    expect(await refusal(post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1' }))).toEqual([
      429,
      'Too many maps started from this network in the last hour. Try again later.',
    ]);
    expect((await post({ action: 'play', slug }, { as: 'maker', ip: '10.0.0.2' })).status).toBe(200);
    expect((await post({ action: 'play', slug }, { as: 'player', ip: '10.0.0.1', now: NOW + HOUR })).status).toBe(200);
    expect((await data(get(`?slug=${slug}`))).plays).toBe(3);
  });

  it('refuses a request from another site', async () => {
    const slug = await publish();
    const crossSite = apiRequest('POST', '/api/maps', { body: { action: 'play', slug }, headers: { origin: 'https://evil.example' } });
    expect((await mapsPost(crossSite, at(NOW))).status).toBe(403);
    expect((await data(get(`?slug=${slug}`))).plays).toBe(0);
  });
});

describe('reporting a map', () => {
  it('stores the reason, and shows it to nobody', async () => {
    const slug = await publish();
    expect(await data(post({ action: 'report', slug, reason: '  half of these are\nin Belgium ' }, { as: 'player' }))).toEqual({ reported: true });
    expect(await stored('SELECT slug, reporter_id, reason FROM map_reports')).toEqual([{ slug, reporter_id: ids.get('player'), reason: 'half of these are in Belgium' }]);

    for (const as of ['maker', 'player', null]) {
      const seen = JSON.stringify([await data(get(`?slug=${slug}`, { as })), await data(get('?list=newest', { as }))]);
      expect(seen).not.toContain('Belgium');
      expect(seen).not.toContain(ids.get('player'));
      expect(seen).not.toContain('report');
    }
  });

  it('keeps one report an account for each map: a second replaces the first', async () => {
    const slug = await publish();
    await data(post({ action: 'report', slug, reason: 'first thoughts' }, { as: 'player' }));
    await data(post({ action: 'report', slug, reason: 'second thoughts' }, { as: 'player', now: NOW + MINUTE }));
    await data(post({ action: 'report', slug }, { as: 'maker' }));
    expect((await stored('SELECT reason FROM map_reports ORDER BY reason')).map((row) => row.reason)).toEqual(['', 'second thoughts']);
  });

  it('takes a reason of 200 characters and refuses one of 201', async () => {
    const slug = await publish();
    expect((await post({ action: 'report', slug, reason: 'r'.repeat(200) }, { as: 'player' })).status).toBe(200);
    expect(await refusal(post({ action: 'report', slug, reason: 'r'.repeat(201) }, { as: 'player' }))).toEqual([
      400,
      'A report names a map and gives a reason of up to 200 characters.',
    ]);
    expect((await post({ action: 'report', slug, reason: 7 }, { as: 'player' })).status).toBe(400);
    expect((await post({ action: 'report', reason: 'no map' }, { as: 'player' })).status).toBe(400);
  });

  it('refuses a visitor and a map that does not exist', async () => {
    const slug = await publish();
    expect((await post({ action: 'report', slug, reason: 'x' }, { as: null })).status).toBe(401);
    expect(await refusal(post({ action: 'report', slug: 'no-such-map', reason: 'x' }))).toEqual([404, NO_SUCH_MAP]);
    expect(await stored('SELECT 1 FROM map_reports')).toEqual([]);
  });

  it('cannot be done without end', async () => {
    const slug = await publish();
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push((await post({ action: 'report', slug, reason: `again ${index}` }, { as: 'player' })).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 20 }, () => 200), 429]);
  });
});

describe('a community map as a map id', () => {
  const settings = (mapId: string) => ({ map: mapId, mode: 'move', timeLimit: 60, rounds: 5 });
  const createParty = (mapId: string) =>
    matchPost(apiRequest('POST', '/api/match', { body: { action: 'create', settings: settings(mapId) }, cookie: cookies.get('player') }), at(NOW));
  // A round on the first place of a map made with `places`, guessed exactly: a game on a community map takes only that map's own places.
  const [[id, lng, lat] = ['', 0, 0]] = places(1);
  const onTheMap = { id, lng, lat, guessLng: lng, guessLat: lat };
  const game = (mapId: string, rounds: unknown[] = [scoredRound(5000)]) => ({ map: mapId, mode: 'move', timeLimit: 0, seed: 'abc', rounds });
  const save = (mapId: string, rounds?: unknown[]) => saveGame(apiRequest('POST', '/api/games', { body: game(mapId, rounds), cookie: cookies.get('player') }), at(NOW));

  it('opens a party on a map that exists', async () => {
    const slug = await publish();
    const response = await createParty(`community:${slug}`);
    expect(response.status).toBe(201);
    expect((await response.json()).data.settings.map).toBe(`community:${slug}`);
  });

  it('refuses a party on a map that does not exist, or was deleted', async () => {
    const slug = await publish();
    await data(post({ action: 'delete', slug }));
    for (const gone of [slug, 'never-was']) {
      expect(await refusal(createParty(`community:${gone}`))).toEqual([404, 'That map does not exist.']);
    }
    expect(await stored('SELECT id FROM matches')).toEqual([]);
  });

  it.each(['community:', 'community:Not A Slug', 'community:-x', 'community:a--b', `community:${'a'.repeat(49)}`, 'communit:abc'])(
    'refuses %s as a map id, for a party and for a saved game',
    async (mapId) => {
      expect((await createParty(mapId)).status).toBe(400);
      expect((await save(mapId)).status).toBe(400);
    },
  );

  it('saves a game played on one, with no XP, out of the stats, but in the recent games', async () => {
    const slug = await publish();
    const response = await save(`community:${slug}`, [onTheMap]);
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ map: `community:${slug}`, score: 5000, xpEarned: 0 });

    const mine = (await (await account(apiRequest('GET', '/api/account', { cookie: cookies.get('player') }), at(NOW))).json()).data;
    expect(mine.account.xp).toBe(0);
    expect(mine.stats).toMatchObject({ gamesPlayed: 0, roundsPlayed: 0, bestRoundScore: 0, perfectRounds: 0, bestGame: null });
    expect(mine.recentGames).toMatchObject([{ map: `community:${slug}`, score: 5000 }]);

    const profile = (await (await socialGet(apiRequest('GET', '/api/social?profile=player'), at(NOW))).json()).data;
    expect(profile).toMatchObject({ gamesPlayed: 0, xp: 0, history: [] });
    expect(profile.recentGames).toHaveLength(1);
  });

  it('does not save a game on a map that has since been deleted, or with a place that is not the map’s: there is nothing to check its places against', async () => {
    const notOnMap = [400, 'That game could not be saved: its places are not on its map.'];
    expect(await refusal(save('community:long-gone-abc123', [onTheMap]))).toEqual(notOnMap);
    const slug = await publish();
    expect(await refusal(save(`community:${slug}`, [{ ...onTheMap, id: 'made-up' }]))).toEqual(notOnMap);
    expect(await refusal(save(`community:${slug}`))).toEqual(notOnMap);
    await data(post({ action: 'delete', slug }));
    expect(await refusal(save(`community:${slug}`, [onTheMap]))).toEqual(notOnMap);
  });
});
