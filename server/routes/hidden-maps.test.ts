import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { mapsGet, mapsPost } from './maps.js';
import { matchPost } from './match.js';

// The map of a banned or a deleted account is in no list and opens for nobody
// but its maker. Nor can anyone else reach it by naming it: to like it, to
// report it, to count a play of it, or to open a party on it.
const NOW = 1_800_000_000_000;
const NO_SUCH_MAP = [404, 'There is no such map.'];
const LOCATIONS = [0, 1, 2, 3, 4].map((index) => [`p${index}`, 2 + index, 48, 'FR']);

let db: Db;
let maker: string;
let other: string;
let slug: string;

const at = (now = NOW): Context => ({ db, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

const maps = (body: unknown, cookie?: string, ip = '203.0.113.5') => mapsPost(apiRequest('POST', '/api/maps', { body, cookie, ip }), at());
const party = (cookie: string) => matchPost(apiRequest('POST', '/api/match', { body: { action: 'create', settings: { map: `community:${slug}`, mode: 'move', timeLimit: 30, rounds: 3 } }, cookie }), at());
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
const stored = () => db.query<{ likes: number; plays: number }>('SELECT likes, plays FROM community_maps WHERE slug = $1', [slug]);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [maker, other] = [await signUp('maker'), await signUp('other')];
  const saved = await maps({ action: 'save', name: 'Across France', description: 'Five places in a line across France.', locations: LOCATIONS }, maker);
  slug = (await saved.json()).data.slug;
});

describe.each([
  ['deleted', "UPDATE users SET deleted_at = now() WHERE username = 'maker'"],
  ['banned', "UPDATE users SET banned = true WHERE username = 'maker'"],
])('the map of a %s account', (state, change) => {
  beforeEach(async () => {
    await db.query(change);
  });

  it('cannot be liked, reported or counted as played by anyone else, and is left as it was', async () => {
    expect(await refusal(maps({ action: 'like', slug, liked: true }, other))).toEqual(NO_SUCH_MAP);
    expect(await refusal(maps({ action: 'report', slug, reason: 'why' }, other))).toEqual(NO_SUCH_MAP);
    expect(await refusal(maps({ action: 'play', slug }, other))).toEqual(NO_SUCH_MAP);
    expect(await stored()).toEqual([{ likes: 0, plays: 0 }]);
    expect(await db.query('SELECT 1 FROM map_likes')).toEqual([]);
    expect(await db.query('SELECT 1 FROM map_reports')).toEqual([]);
  });

  it('cannot have a party opened on it by anyone else', async () => {
    expect(await refusal(party(other))).toEqual([404, 'That map does not exist.']);
  });

  it(`is still there by its link for nobody: ${state}`, async () => {
    expect((await mapsGet(apiRequest('GET', `/api/maps?slug=${slug}`, { cookie: other }), at())).status).toBe(404);
    expect((await mapsGet(apiRequest('GET', `/api/maps?slug=${slug}`), at())).status).toBe(404);
  });
});

describe('the map of an account in good standing', () => {
  it('can be liked, reported, played and partied on as before', async () => {
    expect((await maps({ action: 'like', slug, liked: true }, other)).status).toBe(200);
    expect((await maps({ action: 'report', slug, reason: 'why' }, other)).status).toBe(200);
    expect((await maps({ action: 'play', slug }, other)).status).toBe(200);
    expect((await party(other)).status).toBe(201);
    expect(await stored()).toEqual([{ likes: 1, plays: 1 }]);
  });

  it('is its banned maker’s own to open a party on no longer, since a banned account opens none', async () => {
    await db.query("UPDATE users SET banned = true WHERE username = 'maker'");
    expect((await party(maker)).status).toBe(403);
  });
});
