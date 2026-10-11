import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { LocationRow } from '../db/maps.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { MAPS_PER_PAGE, mapsGet, mapsPost } from './maps.js';

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const BAD_MAP = 'A map needs a name of 3 to 30 characters, a description of 20 to 100, and 5 to 5000 places.';
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
const DESCRIPTION = 'Every arrondissement.';

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

/** A map as one saved before descriptions had a least length, written straight into the table. */
async function oldMap(slug: string, description: string, owner = 'maker'): Promise<void> {
  await db.query(
    `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, created_at, updated_at)
     VALUES ($1, $2, 'An old map', $3, $4::jsonb, 5, $5::timestamptz, $5::timestamptz)`,
    [slug, ids.get(owner), description, JSON.stringify(places(5)), new Date(NOW - HOUR).toISOString()],
  );
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

describe('GET /api/maps?list=', () => {
  /** Publishes maps a minute apart, oldest first, and gives back their slugs. */
  async function publishAll(names: string[], as = 'maker'): Promise<string[]> {
    const slugs: string[] = [];
    for (const [index, name] of names.entries()) {
      slugs.push(await publish({ name }, { as, now: NOW + index * MINUTE }));
    }
    return slugs;
  }
  const names = async (query: string, sender: Sender = {}): Promise<string[]> => (await data(get(query, sender))).maps.map((entry: { name: string }) => entry.name);

  it('lists the newest first, each with its short description and without its places or its long one', async () => {
    const [first, second] = await publishAll(['First map', 'Second map']);
    await data(post(map({ slug: second, name: 'Second map', details: 'A long word about it.' })));
    const response = await get('?list=newest');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        maps: [
          { slug: second, name: 'Second map', maker: 'maker', description: DESCRIPTION, places: 5, plays: 0, likes: 0, liked: false },
          { slug: first, name: 'First map', maker: 'maker', description: DESCRIPTION, places: 5, plays: 0, likes: 0, liked: false },
        ],
        page: 1,
        more: false,
      },
    });
  });

  it('lists the most liked first; among equally liked maps the most played, and then the newest', async () => {
    await signUp('third');
    const [played, loved, liked, , newer] = await publishAll(['Played', 'Loved', 'Liked', 'Older', 'Newer']);
    for (const as of ['maker', 'player', 'third']) {
      await data(post({ action: 'like', slug: loved, liked: true }, { as }));
    }
    await data(post({ action: 'like', slug: liked, liked: true }, { as: 'player' }));
    for (const as of ['maker', 'player', 'third']) {
      await data(post({ action: 'play', slug: played }, { as }));
    }
    expect(await names('?list=popular')).toEqual(['Loved', 'Liked', 'Played', 'Newer', 'Older']);
    expect((await data(get('?list=popular'))).maps[0]).toMatchObject({ likes: 3, plays: 0 });
    expect(newer).toBeDefined();
  });

  it("lists a player's own maps, and refuses a visitor or a guest who asks for theirs", async () => {
    await publishAll(['By the maker']);
    await publishAll(['By the player'], 'player');
    expect(await names('?list=mine', { as: 'player' })).toEqual(['By the player']);
    expect(await names('?list=mine', { as: 'maker' })).toEqual(['By the maker']);
    expect(await refusal(get('?list=mine'))).toEqual([401, 'Sign in first.']);
    await guest();
    expect(await refusal(get('?list=mine', { as: 'guest' }))).toEqual([403, GUESTS_CANNOT]);
  });

  it('lists the maps a player likes, whoever made them, newest first, and refuses a visitor or a guest who asks for theirs', async () => {
    const [first, , third] = await publishAll(['First', 'Second', 'Third']);
    const [own] = await publishAll(['My own'], 'player');
    for (const slug of [first, third, own]) {
      await data(post({ action: 'like', slug, liked: true }, { as: 'player' }));
    }
    await data(post({ action: 'like', slug: first, liked: true }, { as: 'maker' }));
    const mine = await data(get('?list=liked', { as: 'player' }));
    expect(mine).toMatchObject({ page: 1, more: false });
    expect(mine.maps.map((entry: { name: string; liked: boolean }) => [entry.name, entry.liked])).toEqual([
      ['Third', true],
      ['First', true],
      ['My own', true],
    ]);
    expect(await names('?list=liked', { as: 'maker' })).toEqual(['First']);
    expect(await names('?list=liked&q=thi', { as: 'player' })).toEqual(['Third']);

    await data(post({ action: 'like', slug: third, liked: false }, { as: 'player' }));
    expect(await names('?list=liked', { as: 'player' })).toEqual(['First', 'My own']);

    expect(await refusal(get('?list=liked'))).toEqual([401, 'Sign in first.']);
    await guest();
    expect(await refusal(get('?list=liked', { as: 'guest' }))).toEqual([403, GUESTS_CANNOT]);
  });

  it('pages the liked maps like any list', async () => {
    await signUp('second');
    const all = [
      ...(await publishAll(Array.from({ length: 20 }, (_unused, index) => `Map ${index}`))),
      ...(await publishAll(Array.from({ length: 6 }, (_unused, index) => `More ${index}`), 'second')),
    ];
    await db.query('INSERT INTO map_likes (slug, user_id) SELECT slug, $1 FROM community_maps', [ids.get('player')]);
    const first = await data(get('?list=liked', { as: 'player' }));
    const second = await data(get('?list=liked&page=2', { as: 'player' }));
    expect([first.maps.length, first.more, second.maps.length, second.more]).toEqual([MAPS_PER_PAGE, true, 2, false]);
    expect([...first.maps, ...second.maps].map((entry: { slug: string }) => entry.slug).sort()).toEqual([...all].sort());
  });

  it('leaves the maps of a banned or a deleted account out of every list but its own', async () => {
    await signUp('banned');
    await signUp('gone');
    await publishAll(['Fair map']);
    const [byBanned] = await publishAll(['Banned map'], 'banned');
    const [byGone] = await publishAll(['Gone map'], 'gone');
    for (const slug of [byBanned, byGone]) {
      await data(post({ action: 'like', slug, liked: true }, { as: 'player' }));
    }
    await db.query('UPDATE users SET banned = true WHERE id = $1', [ids.get('banned')]);
    await db.query('UPDATE users SET deleted_at = $2::timestamptz WHERE id = $1', [ids.get('gone'), new Date(NOW).toISOString()]);
    expect(await names('?list=newest')).toEqual(['Fair map']);
    expect(await names('?list=popular')).toEqual(['Fair map']);
    expect(await names('?list=liked', { as: 'player' })).toEqual([]);
    expect(await names('?list=mine', { as: 'banned' })).toEqual(['Banned map']);
  });

  it('lists and shows a map saved before a description was needed, and holds it to the rules when it is next saved', async () => {
    await oldMap('old-empty', '');
    await oldMap('old-short', 'Short.');
    expect((await data(get('?list=newest'))).maps.map((entry: { slug: string; description: string }) => [entry.slug, entry.description])).toEqual([
      ['old-empty', ''],
      ['old-short', 'Short.'],
    ]);
    expect(await data(get('?slug=old-short'))).toMatchObject({ description: 'Short.', details: '', places: 5, likes: 0 });
    expect(await data(post({ action: 'like', slug: 'old-empty', liked: true }, { as: 'player' }))).toMatchObject({ description: '', likes: 1, liked: true });
    expect(await names('?list=liked', { as: 'player' })).toEqual(['An old map']);

    expect(await refusal(post(map({ slug: 'old-short', description: 'Short.' })))).toEqual([400, BAD_MAP]);
    expect((await data(post(map({ slug: 'old-short' })))).description).toBe(DESCRIPTION);
  });

  it('says for each map whether the asker likes it', async () => {
    const [liked] = await publishAll(['Liked', 'Not liked']);
    await data(post({ action: 'like', slug: liked, liked: true }, { as: 'player' }));
    const flags = async (as: string | null) => (await data(get('?list=newest', { as }))).maps.map((entry: { liked: boolean; likes: number }) => [entry.liked, entry.likes]);
    expect(await flags('player')).toEqual([
      [false, 0],
      [true, 1],
    ]);
    expect(await flags('maker')).toEqual([
      [false, 0],
      [false, 1],
    ]);
    expect(await flags(null)).toEqual([
      [false, 0],
      [false, 1],
    ]);
  });

  it('gives 24 to a page, says whether there are more, and never repeats or skips a map between pages', async () => {
    await signUp('second');
    const all = [
      ...(await publishAll(Array.from({ length: 20 }, (_unused, index) => `Map ${index}`))),
      ...(await publishAll(Array.from({ length: 10 }, (_unused, index) => `More ${index}`), 'second')),
    ];
    // Every map made at the same moment, so only the slug tells them apart.
    await db.query('UPDATE community_maps SET created_at = $1', [new Date(NOW)]);

    const first = await data(get('?list=newest'));
    const second = await data(get('?list=newest&page=2'));
    const third = await data(get('?list=newest&page=3'));
    expect([first.maps.length, first.page, first.more]).toEqual([MAPS_PER_PAGE, 1, true]);
    expect([second.maps.length, second.page, second.more]).toEqual([6, 2, false]);
    expect(third).toEqual({ maps: [], page: 3, more: false });
    const listed = [...first.maps, ...second.maps].map((entry: { slug: string }) => entry.slug);
    expect([...listed].sort()).toEqual([...all].sort());
    expect(listed).toEqual([...all].sort());
    expect(await data(get('?list=newest&page=1'))).toEqual(first);
    expect(await data(get('?list=newest&page=0'))).toEqual(first);
  });

  it('says there are no more when a page is exactly full', async () => {
    await signUp('second');
    await publishAll(Array.from({ length: 20 }, (_unused, index) => `Map ${index}`));
    await publishAll(Array.from({ length: 4 }, (_unused, index) => `More ${index}`), 'second');
    expect(await data(get('?list=popular'))).toMatchObject({ page: 1, more: false });
  });

  it('finds maps by a part of their name, whatever the capitals', async () => {
    await publishAll(['Streets of Paris', 'PARIS at night', 'Rural France', 'Comparison']);
    expect(await names('?list=newest&q=paris')).toEqual(['Comparison', 'PARIS at night', 'Streets of Paris']);
    expect(await names('?list=newest&q=%20%20Rural%20')).toEqual(['Rural France']);
    expect(await names('?list=popular&q=nowhere')).toEqual([]);
    expect(await names('?list=mine&q=night', { as: 'maker' })).toEqual(['PARIS at night']);
  });

  it('finds maps by a part of their description or of their maker’s name too, but not of their long description', async () => {
    await signUp('cartographer');
    await publish({ name: 'Alpine passes', description: 'Hairpins above the TREELINE.', details: 'Bring a jacket.' }, { now: NOW });
    await publish({ name: 'Lowlands', description: 'Flat roads and windmills.' }, { now: NOW + MINUTE });
    await publish({ name: 'Somewhere else', description: 'Nothing to do with the others.' }, { as: 'cartographer', now: NOW + 2 * MINUTE });
    expect(await names('?list=newest&q=treeline')).toEqual(['Alpine passes']);
    expect(await names('?list=newest&q=WINDMILL')).toEqual(['Lowlands']);
    expect(await names('?list=newest&q=cartog')).toEqual(['Somewhere else']);
    expect(await names('?list=newest&q=Mak')).toEqual(['Lowlands', 'Alpine passes']);
    expect(await names('?list=popular&q=jacket')).toEqual([]);
  });

  it('searches from 3 characters, and ignores anything shorter', async () => {
    await publishAll(['Abc roads', 'Xyz roads']);
    expect(await names('?list=newest&q=abc')).toEqual(['Abc roads']);
    expect(await names('?list=newest&q=ab')).toEqual(['Xyz roads', 'Abc roads']);
    expect(await names('?list=newest&q=%20%20ab%20%20')).toEqual(['Xyz roads', 'Abc roads']);
    expect(await names('?list=newest&q=')).toEqual(['Xyz roads', 'Abc roads']);
  });

  it('searches for a percent sign, an underscore or a backslash as themselves, not as wildcards', async () => {
    await publishAll(['100% Europe', '100 Europe', 'a_b roads', 'axb roads', 'back\\slash', 'backslash']);
    expect(await names(`?list=newest&q=${encodeURIComponent('100%')}`)).toEqual(['100% Europe']);
    expect(await names(`?list=newest&q=${encodeURIComponent('a_b')}`)).toEqual(['a_b roads']);
    expect(await names(`?list=newest&q=${encodeURIComponent('back\\s')}`)).toEqual(['back\\slash']);
    expect(await names(`?list=newest&q=${encodeURIComponent('%%%')}`)).toEqual([]);
    expect(await names(`?list=newest&q=${encodeURIComponent('___')}`)).toEqual([]);
    expect(await names(`?list=newest&q=${encodeURIComponent("' OR 1=1 --")}`)).toEqual([]);
  });

  it('reads a page in one query after the one that checks the session, and never the places', async () => {
    await publishAll(['One', 'Two']);
    const asked: string[] = [];
    const watching: Db = {
      query: (sql, params) => {
        asked.push(sql);
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    await data(get('?list=popular&q=one', { as: 'player', on: watching }));
    await data(get('?list=liked', { as: 'player', on: watching }));
    expect(asked).toHaveLength(4);
    expect(asked.join()).not.toContain('locations');
    // The likes are read from the map's own count, not counted again for every row.
    expect(asked.join()).not.toContain('count(');
  });

  it.each(['?list=best', '?list=', '?list=newest&page=-1', '?list=newest&page=two', '?list=newest&page=1.5', '?list=newest&page=10001'])(
    'refuses %s',
    async (query) => {
      expect((await get(query)).status).toBe(400);
    },
  );
});
