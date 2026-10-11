import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest, deleteOldGuests } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { joinParty } from '../match/parties.js';
import { spreadPlaces } from '../places/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { matchGet, matchPost } from './match.js';

// Playing takes an account. Nothing makes a guest any more; the ones made before
// that are still rows until a day passes, and these are what they are left with.
const NOW = 1_800_000_000_000;
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 1 };
const [PLACE] = spreadPlaces(1) as [ReturnType<typeof spreadPlaces>[number]];
const GUESTS_CANNOT = [403, 'Guests cannot do that. Make an account first.'];
const SIGN_IN_FIRST = [401, 'Sign in first.'];

let db: Db;
let neel: string;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

const post = (body: unknown, cookie: string | null, now = NOW) => matchPost(apiRequest('POST', '/api/match', { body, cookie: cookie ?? undefined }), at(now));
const get = (query: string, cookie: string | null, now = NOW) => matchGet(apiRequest('GET', `/api/match${query}`, { cookie: cookie ?? undefined }), at(now));
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

/** A guest from before accounts were needed: the row, and the session its browser still holds. */
async function guest(now = NOW): Promise<{ userId: string; username: string; cookie: string }> {
  const made = await createGuest(db, now);
  return { ...made, cookie: `${accountCookieName(true)}=${createGuestSession(made.userId, now, TEST_SECRET)}` };
}

const guests = () => db.query<{ username: string }>('SELECT username FROM users WHERE guest');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = await signUp('neel');
});

describe('becoming a guest', () => {
  it('is not on offer: a visitor who asks is told to sign in, and nobody is made', async () => {
    const response = await post({ action: 'guest' }, null);
    expect([response.status, (await response.json()).error, response.headers.getSetCookie()]).toEqual([...SIGN_IN_FIRST, []]);
    expect(await guests()).toEqual([]);
  });

  it('is not something a match can be asked for by a signed-in player either', async () => {
    expect(await refusal(post({ action: 'guest' }, neel))).toEqual([400, 'That is not something a match can be asked to do.']);
    expect(await guests()).toEqual([]);
  });
});

describe('a guest left from before playing took an account', () => {
  it.each([
    ['queue for a public game', { action: 'queue', kind: 'unranked' }],
    ['join a party', { action: 'join', code: 'ABC123' }],
    ['guess', { action: 'guess', matchId: randomUUID(), round: 0, lng: PLACE.lng, lat: PLACE.lat }],
    ['move a pin', { action: 'pin', matchId: randomUUID(), round: 0, lng: PLACE.lng, lat: PLACE.lat }],
    ['post the places', { action: 'places', matchId: randomUUID(), places: [PLACE] }],
    ['pick a team', { action: 'team', matchId: randomUUID(), team: 0 }],
    ['react', { action: 'emote', matchId: randomUUID(), emote: 'gl' }],
    ['mute a player', { action: 'mute', matchId: randomUUID(), username: 'neel', muted: true }],
    ['open a party', { action: 'create', settings: SETTINGS }],
    ['queue for a ranked duel', { action: 'queue', kind: 'ranked' }],
    ['queue for 2v2', { action: 'queue', kind: 'team' }],
    ['chat', { action: 'chat', matchId: randomUUID(), text: 'hello' }],
    ['start a match', { action: 'start', matchId: randomUUID() }],
  ])('cannot %s', async (_name, body) => {
    const visitor = await guest();
    expect(await refusal(post(body, visitor.cookie))).toEqual(GUESTS_CANNOT);
    expect(await refusal(post(body, null))).toEqual(SIGN_IN_FIRST);
  });

  it('can still walk out of the party they were in, and of the queue', async () => {
    const visitor = await guest();
    const lobby = await data(post({ action: 'create', settings: SETTINGS }, neel));
    // Seated as the route once seated them.
    expect((await joinParty(db, visitor.userId, lobby.code, NOW)).ok).toBe(true);
    expect((await data(get(`?id=${lobby.id}`, visitor.cookie, NOW + SECOND))).you).toMatchObject({ username: visitor.username, guest: true });
    expect(await data(post({ action: 'leave', matchId: lobby.id }, visitor.cookie, NOW + 2 * SECOND))).toEqual({ left: true });
    expect((await post({ action: 'leaveQueue' }, visitor.cookie, NOW + 2 * SECOND)).status).toBe(200);
  });

  it('is cleared away after a day without a word from them, seat and all, while one who is still there stays', async () => {
    const gone = await guest();
    const here = await guest(NOW + 23 * HOUR);
    const lobby = await data(post({ action: 'create', settings: SETTINGS }, neel, NOW));
    expect((await joinParty(db, gone.userId, lobby.code, NOW)).ok).toBe(true);
    // Opening a party is one of the moments old rows are cleared out.
    await data(post({ action: 'leave', matchId: lobby.id }, neel, NOW + SECOND));
    await data(post({ action: 'create', settings: SETTINGS }, neel, NOW + 24 * HOUR + SECOND));
    expect((await guests()).map((row) => row.username)).toEqual([here.username]);
    expect(await db.query('SELECT 1 FROM match_players p JOIN users u ON u.id = p.user_id WHERE u.guest')).toEqual([]);
  });

  it('is not cleared away while they hold a seat in a game that is not over, and is once it is', async () => {
    const visitor = await guest();
    const lobby = await data(post({ action: 'create', settings: SETTINGS }, neel));
    expect((await joinParty(db, visitor.userId, lobby.code, NOW)).ok).toBe(true);
    await deleteOldGuests(db, NOW + 25 * HOUR);
    expect(await guests()).toHaveLength(1);
    expect((await data(get(`?id=${lobby.id}`, neel, NOW + SECOND))).players).toHaveLength(2);
    // The host walks out: a guest cannot host, so the party is over.
    await data(post({ action: 'leave', matchId: lobby.id }, neel, NOW + 2 * SECOND));
    await deleteOldGuests(db, NOW + 25 * HOUR);
    expect(await guests()).toEqual([]);
  });

  it('is not let in by a forged or an expired guest session', async () => {
    const visitor = await guest();
    expect((await get('?queue=1', `${visitor.cookie}x`)).status).toBe(401);
    expect((await get('?queue=1', visitor.cookie, NOW + 24 * HOUR - 1)).status).toBe(200);
    expect((await get('?queue=1', visitor.cookie, NOW + 24 * HOUR)).status).toBe(401);
  });
});
