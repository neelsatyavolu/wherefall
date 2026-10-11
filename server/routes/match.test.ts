import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { COUNTDOWN_MS, QUEUE_LAPSE_MS, REVEAL_MS } from '../match/types.js';
import { spreadPlaces } from '../places/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { matchGet, matchPost } from './match.js';

const NOW = 1_800_000_000_000;
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 };
// Three real places, as a browser would send them: made-up ones are refused.
const PLACES = spreadPlaces(3);
const [FIRST] = PLACES as [(typeof PLACES)[number]];
const SOME_MATCH = randomUUID();

let db: Db;
let neel: string;
let friend: string;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

/** An account and the session cookie of a browser signed in to it. */
async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

/** A null cookie is a visitor. */
const post = (body: unknown, cookie: string | null = neel, now = NOW) =>
  matchPost(apiRequest('POST', '/api/match', { body, cookie: cookie ?? undefined }), at(now));
const get = (query: string, cookie: string | null = neel, now = NOW) =>
  matchGet(apiRequest('GET', `/api/match${query}`, { cookie: cookie ?? undefined }), at(now));

/** The data of a reply that should have succeeded. */
async function data(response: Response | Promise<Response>) {
  const body = await (await response).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
}

const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = await signUp('neel');
  friend = await signUp('friend');
});

describe('POST /api/match', () => {
  it('refuses a request sent from another site, even with a session', async () => {
    const body = { action: 'create', settings: SETTINGS };
    const request = apiRequest('POST', '/api/match', { body, cookie: neel, headers: { origin: 'https://evil.example' } });
    const response = await matchPost(request, at(NOW));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'Request refused.' });
    expect(await db.query('SELECT id FROM matches')).toEqual([]);
  });

  it.each([
    ['a visitor', null],
    ['a forged session', '__Host-plonk_account=account.nobody.0.forged'],
    ['a session signed with another key', `__Host-plonk_account=${createAccountSession(randomUUID(), NOW, Buffer.alloc(32, 9))}`],
  ])('refuses %s', async (_name, cookie) => {
    const response = await post({ action: 'create', settings: SETTINGS }, cookie);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Sign in first.' });
  });

  it('refuses a session whose account no longer exists', async () => {
    await db.query('DELETE FROM users');
    expect((await post({ action: 'create', settings: SETTINGS })).status).toBe(401);
    expect((await post({ action: 'join', code: 'ABCDEF' })).status).toBe(401);
    expect((await post({ action: 'queue', kind: 'ranked' })).status).toBe(401);
  });

  it.each([
    ['no action', { settings: SETTINGS }],
    ['an action it does not know', { action: 'cheat' }],
    ['something that is not an object', 'create'],
  ])('refuses %s', async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'That is not something a match can be asked to do.' });
  });

  it('refuses a body that is not declared as JSON', async () => {
    const request = new Request('https://plonk.example/api/match', { method: 'POST', headers: { cookie: neel }, body: '{"action":"leaveQueue"}' });
    expect((await matchPost(request, at(NOW))).status).toBe(400);
  });

  const CHOOSE_SETTINGS = 'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.';
  const BAD_CODE = 'A party code is 6 letters and numbers.';
  const NOT_A_MATCH = 'That is not a match.';
  const BAD_PLACES = 'Those places are not valid.';
  const BAD_GUESS = 'That guess is not valid.';
  const BAD_QUEUE = 'Choose ranked, unranked or 2v2.';
  const BAD_CHAT = 'A message is 1 to 200 characters.';
  const BAD_EMOTE = 'That is not one of the reactions.';
  const places = (change: Record<string, unknown>) => ({ action: 'places', matchId: SOME_MATCH, places: PLACES, ...change });
  const guessAt = (change: Record<string, unknown>) => ({ action: 'guess', matchId: SOME_MATCH, round: 0, lng: 1, lat: 1, ...change });

  it.each([
    ['create with no settings', { action: 'create' }, CHOOSE_SETTINGS],
    ['create with a time limit under 10 seconds', { action: 'create', settings: { ...SETTINGS, timeLimit: 5 } }, CHOOSE_SETTINGS],
    ['create with a time limit over 300 seconds', { action: 'create', settings: { ...SETTINGS, timeLimit: 310 } }, CHOOSE_SETTINGS],
    ['create with a way of talking that does not exist', { action: 'create', settings: { ...SETTINGS, communication: 'shout' } }, CHOOSE_SETTINGS],
    ['create with a team mode that does not exist', { action: 'create', settings: { ...SETTINGS, teams: 'three' } }, CHOOSE_SETTINGS],
    ['create with a time limit that is not offered', { action: 'create', settings: { ...SETTINGS, timeLimit: 45 } }, CHOOSE_SETTINGS],
    ['create with no rounds', { action: 'create', settings: { ...SETTINGS, rounds: 0 } }, CHOOSE_SETTINGS],
    ['create with 21 rounds', { action: 'create', settings: { ...SETTINGS, rounds: 21 } }, CHOOSE_SETTINGS],
    ['create on an unknown map', { action: 'create', settings: { ...SETTINGS, map: 'mars' } }, CHOOSE_SETTINGS],
    ['create in an unknown mode', { action: 'create', settings: { ...SETTINGS, mode: 'fly' } }, CHOOSE_SETTINGS],
    ['join with no code', { action: 'join' }, BAD_CODE],
    ['join with a short code', { action: 'join', code: 'ABC' }, BAD_CODE],
    ['join with a code of symbols', { action: 'join', code: "AB';--" }, BAD_CODE],
    ['start with no match', { action: 'start' }, NOT_A_MATCH],
    ['start with something that is not a match id', { action: 'start', matchId: 'm1' }, NOT_A_MATCH],
    ['leave with something that is not a match id', { action: 'leave', matchId: 42 }, NOT_A_MATCH],
    ['places with something that is not a match id', places({ matchId: "x' OR 1=1" }), BAD_PLACES],
    ['places with none', places({ places: [] }), BAD_PLACES],
    ['places with twenty-one', places({ places: Array.from({ length: 21 }, () => PLACES[0]) }), BAD_PLACES],
    ['places with a longitude off the map', places({ places: [{ ...PLACES[0], lng: 180.1 }] }), BAD_PLACES],
    ['places with a latitude off the map', places({ places: [{ ...PLACES[0], lat: -90.1 }] }), BAD_PLACES],
    ['places with a country that is not two capitals', places({ places: [{ ...PLACES[0], country: 'fra' }] }), BAD_PLACES],
    ['places with an empty id', places({ places: [{ ...PLACES[0], id: '' }] }), BAD_PLACES],
    ['places with coordinates as text', places({ places: [{ ...PLACES[0], lat: '48.8' }] }), BAD_PLACES],
    ['a guess with something that is not a match id', guessAt({ matchId: 'nope' }), BAD_GUESS],
    ['a guess for a negative round', guessAt({ round: -1 }), BAD_GUESS],
    ['a guess for a twenty-first round', guessAt({ round: 20 }), BAD_GUESS],
    ['a guess for half a round', guessAt({ round: 0.5 }), BAD_GUESS],
    ['a guess with a longitude off the map', guessAt({ lng: -180.1 }), BAD_GUESS],
    ['a guess with a latitude off the map', guessAt({ lat: 90.1 }), BAD_GUESS],
    ['a guess with no latitude', guessAt({ lat: undefined }), BAD_GUESS],
    ['a guess with no number at all', guessAt({ lng: null }), BAD_GUESS],
    ['create on a country in small letters', { action: 'create', settings: { ...SETTINGS, map: 'country:fr' } }, CHOOSE_SETTINGS],
    ['create on a country of three letters', { action: 'create', settings: { ...SETTINGS, map: 'country:FRA' } }, CHOOSE_SETTINGS],
    ['chat with no text', { action: 'chat', matchId: SOME_MATCH }, BAD_CHAT],
    ['chat with an empty line', { action: 'chat', matchId: SOME_MATCH, text: '' }, BAD_CHAT],
    ['chat with nothing but spaces and line breaks', { action: 'chat', matchId: SOME_MATCH, text: ' \n\t ' }, BAD_CHAT],
    ['chat with 201 characters', { action: 'chat', matchId: SOME_MATCH, text: 'x'.repeat(201) }, BAD_CHAT],
    ['chat with something that is not text', { action: 'chat', matchId: SOME_MATCH, text: { toString: 'hi' } }, BAD_CHAT],
    ['chat with something that is not a match id', { action: 'chat', matchId: 'm1', text: 'hi' }, BAD_CHAT],
    ['a reaction that is not one of the twenty', { action: 'emote', matchId: SOME_MATCH, emote: 'meh' }, BAD_EMOTE],
    ['a reaction with none named', { action: 'emote', matchId: SOME_MATCH }, BAD_EMOTE],
    ['a reaction with something that is not a match id', { action: 'emote', matchId: 7, emote: 'gg' }, BAD_EMOTE],
    ['queue with no kind', { action: 'queue' }, BAD_QUEUE],
    ['queue for a party', { action: 'queue', kind: 'party' }, BAD_QUEUE],
  ])('refuses %s', async (_name, body, error) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error });
    expect(await db.query('SELECT id FROM matches')).toEqual([]);
    expect(await db.query('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('plays a party from the lobby to the first reveal', async () => {
    const created = await post({ action: 'create', settings: SETTINGS });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const lobby = await data(created);
    expect(lobby).toMatchObject({ phase: 'lobby', kind: 'party', settings: SETTINGS, you: { username: 'neel', isHost: true } });

    // A code typed in lowercase, with a space after it, is still that code.
    const joined = await data(post({ action: 'join', code: ` ${lobby.code.toLowerCase()} ` }, friend));
    expect(joined).toMatchObject({ id: lobby.id, players: [{ username: 'neel' }, { username: 'friend' }] });

    expect(await data(post({ action: 'start', matchId: lobby.id }))).toMatchObject({ phase: 'preparing' });
    // A scale sent by the browser is not read: on the world map the server's is 20,000 km whatever is said.
    const playing = await data(post({ action: 'places', matchId: lobby.id, places: PLACES, scaleKm: 100 }));
    // Only the first round's place is sent: the later ones come as their rounds do.
    expect(playing).toMatchObject({ phase: 'playing', places: [FIRST], roundStartsAt: new Date(NOW + COUNTDOWN_MS).toISOString() });

    const round = NOW + COUNTDOWN_MS;
    expect(await data(post({ action: 'guess', matchId: lobby.id, round: 0, lng: FIRST.lng, lat: FIRST.lat }, neel, round))).toMatchObject({ phase: 'playing' });
    const revealed = await data(post({ action: 'guess', matchId: lobby.id, round: 0, lng: FIRST.lng + 1, lat: FIRST.lat }, friend, round));
    expect(revealed).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(round + REVEAL_MS).toISOString(), serverNow: new Date(round).toISOString() });
    expect(revealed.results[0].guesses[0]).toEqual({ username: 'neel', lng: FIRST.lng, lat: FIRST.lat, distanceKm: 0, score: 5000 });
    // A degree of longitude is at most 111 km: at the 100 km scale the browser asked for that would score next to nothing.
    expect(revealed.results[0].guesses[1].score).toBeGreaterThan(4700);

    expect(await data(post({ action: 'leave', matchId: lobby.id }, friend, round))).toEqual({ left: true });
  });

  it('opens a party on a country or on Africa', async () => {
    expect((await data(post({ action: 'create', settings: { ...SETTINGS, map: 'country:JP' } }))).settings.map).toBe('country:JP');
    expect((await data(post({ action: 'create', settings: { ...SETTINGS, map: 'africa' } }, friend))).settings.map).toBe('africa');
  });

  it('carries chat and reactions: a line of exactly 200 characters, tidied onto one line, masked, and limited to one a second', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    await data(post({ action: 'join', code: lobby.code }, friend));
    expect(lobby.chat).toEqual([]);

    const said = await data(post({ action: 'chat', matchId: lobby.id, text: '  well\n shit   that was close ' }));
    expect(said.chat).toEqual([{ id: 1, username: 'neel', text: 'well **** that was close', emote: null, at: new Date(NOW).toISOString(), scope: 'all' }]);

    const long = 'y'.repeat(200);
    expect((await data(post({ action: 'chat', matchId: lobby.id, text: long }, friend))).chat[1].text).toBe(long);

    const tooSoon = await post({ action: 'emote', matchId: lobby.id, emote: 'gg' }, neel, NOW + 999);
    expect(tooSoon.status).toBe(429);
    expect(await tooSoon.json()).toEqual({ success: false, error: 'One message a second. Try again in a moment.' });

    const reacted = await data(post({ action: 'emote', matchId: lobby.id, emote: 'gg' }, neel, NOW + SECOND));
    expect(reacted.chat[2]).toEqual({ id: 3, username: 'neel', text: null, emote: 'gg', at: new Date(NOW + SECOND).toISOString(), scope: 'all' });
    expect((await data(get(`?id=${lobby.id}`, friend, NOW + SECOND))).chat).toHaveLength(3);
  });

  // prettier-ignore
  it.each(['gg', 'gl', 'hi', 'bye', 'nice', 'wow', 'oof', 'close', 'hm', 'lol', 'ty', 'sorry', 'rip', 'yes', 'no', 'think', 'clap', 'fire', 'sad', 'heart'])('takes the reaction %s', async (emote) => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    expect((await data(post({ action: 'emote', matchId: lobby.id, emote }))).chat).toMatchObject([{ emote, text: null }]);
  });

  it('refuses chat from someone who is not in the match', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    expect((await post({ action: 'chat', matchId: lobby.id, text: 'hi' }, friend)).status).toBe(404);
  });

  it('gathers a public unranked game over a countdown that the queue state carries', async () => {
    await data(post({ action: 'queue', kind: 'unranked' }));
    const starts = new Date(NOW + SECOND + 10 * SECOND).toISOString();
    expect(await data(post({ action: 'queue', kind: 'unranked' }, friend, NOW + SECOND))).toEqual({
      queued: true,
      kind: 'unranked',
      waiting: 2,
      matchId: null,
      startsAt: starts,
      since: new Date(NOW + SECOND).toISOString(),
      serverNow: new Date(NOW + SECOND).toISOString(),
      window: null,
      typicalWaitSeconds: null,
      lockedUntil: null,
    });
    expect(await data(get('?queue=1', neel, NOW + 6 * SECOND))).toMatchObject({ waiting: 2, startsAt: starts });
    await data(get('?queue=1', friend, NOW + 6 * SECOND));

    const started = await data(get('?queue=1', friend, NOW + 11 * SECOND));
    expect(started).toEqual({ queued: false, kind: null, waiting: 0, matchId: expect.any(String), startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await data(get(`?id=${started.matchId}`, neel, NOW + 11 * SECOND))).toMatchObject({ kind: 'unranked', phase: 'preparing' });
  });

  it('cancels the countdown when leaving the queue leaves one player waiting', async () => {
    await data(post({ action: 'queue', kind: 'unranked' }));
    await data(post({ action: 'queue', kind: 'unranked' }, friend, NOW + SECOND));
    expect(await data(post({ action: 'leaveQueue' }, friend, NOW + 2 * SECOND))).toEqual({ queued: false });
    expect(await data(get('?queue=1', neel, NOW + 3 * SECOND))).toMatchObject({ queued: true, waiting: 1, startsAt: null });
  });

  it('passes on a refusal with its status and its reason', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    await data(post({ action: 'join', code: lobby.code }, friend));

    const notHost = await post({ action: 'start', matchId: lobby.id }, friend);
    expect(notHost.status).toBe(403);
    expect(await notHost.json()).toEqual({ success: false, error: 'Only the host can do that.' });

    const again = await post({ action: 'create', settings: SETTINGS }, friend);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ success: false, error: 'You are already in a match. Leave it before you start another.' });

    expect((await post({ action: 'start', matchId: SOME_MATCH })).status).toBe(404);
    expect((await post({ action: 'join', code: 'NOSUCH' }, friend)).status).toBe(404);
  });

  it('queues, pairs and unqueues', async () => {
    expect(await data(post({ action: 'queue', kind: 'ranked' }))).toEqual({ queued: true, kind: 'ranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: expect.any(Number), typicalWaitSeconds: null, lockedUntil: null });
    expect(await data(post({ action: 'leaveQueue' }))).toEqual({ queued: false });
    expect(await data(post({ action: 'queue', kind: 'ranked' }))).toMatchObject({ queued: true, waiting: 1 });

    const matched = await data(post({ action: 'queue', kind: 'ranked' }, friend, NOW + SECOND));
    expect(matched).toEqual({ queued: false, kind: null, waiting: 0, matchId: expect.any(String), startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await data(get('?queue=1', neel, NOW + 2 * SECOND))).toMatchObject({ queued: false, matchId: matched.matchId });
    expect(await data(get(`?id=${matched.matchId}`, neel, NOW + 2 * SECOND))).toMatchObject({ kind: 'ranked', phase: 'preparing', you: { isResolver: true } });

    const refused = await post({ action: 'queue', kind: 'unranked' }, friend, NOW + 3 * SECOND);
    expect(refused.status).toBe(409);
  });

  it('stops one account opening parties without end, then lets it again an hour later', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      statuses.push((await post({ action: 'create', settings: SETTINGS })).status);
    }
    expect(statuses).toEqual([201, ...Array.from({ length: 29 }, () => 409), 429]);
    expect((await post({ action: 'create', settings: SETTINGS }, friend)).status).toBe(201);
    expect((await post({ action: 'create', settings: SETTINGS }, neel, NOW + HOUR)).status).toBe(201);
  });

  it('stops one account trying party codes without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await post({ action: 'join', code: 'NOSUCH' })).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 404)).toBe(true);
    const last = await post({ action: 'join', code: 'NOSUCH' });
    expect(last.status).toBe(429);
    expect((await last.json()).error).toBe('Too many tries at joining a party in the last hour. Try again later.');
  });

  it('stops one account joining queues without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 121; index += 1) {
      statuses.push((await post({ action: 'queue', kind: 'team' })).status);
    }
    expect(statuses.slice(0, 120).every((status) => status === 200)).toBe(true);
    expect(statuses[120]).toBe(429);
  });

  it('does not count a malformed request against the limits', async () => {
    for (let index = 0; index < 35; index += 1) {
      await post({ action: 'create', settings: { ...SETTINGS, rounds: 0 } });
    }
    expect((await post({ action: 'create', settings: SETTINGS })).status).toBe(201);
  });

  it('takes 240 writes a minute from one player to one match, then asks them to slow down, and never counts a poll', async () => {
    const SLOW_DOWN = [429, 'Too many requests. Slow down a little.'];
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    await data(post({ action: 'join', code: lobby.code }, friend));
    const pin = (cookie: string, now: number) => post({ action: 'pin', matchId: lobby.id, round: 0, lng: 0, lat: 0 }, cookie, now);
    const statuses = new Set<number>();
    for (let index = 0; index < 240; index += 1) {
      statuses.add((await pin(neel, NOW + index)).status);
    }
    expect([...statuses]).toEqual([200]);
    expect(await refusal(pin(neel, NOW + 59 * SECOND))).toEqual(SLOW_DOWN);
    expect(await refusal(post({ action: 'lock', matchId: lobby.id, locked: true }, neel, NOW + 59 * SECOND))).toEqual(SLOW_DOWN);
    // Counted per player, not per match or per address: the other player in the same party is not held up.
    expect((await pin(friend, NOW + 59 * SECOND)).status).toBe(200);
    // Polls are how the match is followed, and are never refused.
    for (let index = 0; index < 5; index += 1) {
      expect((await get(`?id=${lobby.id}`, neel, NOW + 59 * SECOND)).status).toBe(200);
    }
    // A minute after the first of them, the count starts again.
    expect((await pin(neel, NOW + 60 * SECOND)).status).toBe(200);
  });

  it('takes 60 leavings of the queue a minute from one player', async () => {
    for (let index = 0; index < 60; index += 1) {
      expect((await post({ action: 'leaveQueue' })).status).toBe(200);
    }
    expect((await post({ action: 'leaveQueue' })).status).toBe(429);
    expect((await post({ action: 'leaveQueue' }, friend)).status).toBe(200);
    expect((await post({ action: 'leaveQueue' }, neel, NOW + 60 * SECOND)).status).toBe(200);
  });
});

describe('GET /api/match', () => {
  it('refuses a visitor', async () => {
    const response = await get('?queue=1', null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Sign in first.' });
    expect((await get(`?id=${SOME_MATCH}`, null)).status).toBe(401);
  });

  it.each([
    ['neither a match nor the queue', ''],
    ['something that is not a match id', '?id=m1'],
    ['an empty id', '?id='],
  ])('refuses a request for %s', async (_name, query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Ask for a match by its id, or for the queue.' });
  });

  it('answers 404 for a match that does not exist or that the asker is not in', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    expect((await get(`?id=${lobby.id}`, friend)).status).toBe(404);
    expect((await get(`?id=${SOME_MATCH}`)).status).toBe(404);
  });

  it('gives the state of a match, with the server clock, and counts as that player being there', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    const response = await get(`?id=${lobby.id}`, neel, NOW + 25 * SECOND);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await data(response)).toMatchObject({ id: lobby.id, phase: 'lobby', serverNow: new Date(NOW + 25 * SECOND).toISOString() });
    // 50 seconds after it was opened, the lobby is still there, because its host polled 25 seconds ago.
    expect(await data(get(`?id=${lobby.id}`, neel, NOW + 50 * SECOND))).toMatchObject({ phase: 'lobby', players: [{ active: true }] });
  });

  it('never limits polling', async () => {
    const lobby = await data(post({ action: 'create', settings: SETTINGS }));
    const statuses = new Set<number>();
    for (let index = 0; index < 150; index += 1) {
      statuses.add((await get(`?id=${lobby.id}`, neel, NOW + index * SECOND)).status);
      statuses.add((await get('?queue=1', friend, NOW + index * SECOND)).status);
    }
    expect([...statuses]).toEqual([200]);
  });

  it('says a player who is not waiting is not queued', async () => {
    expect(await data(get('?queue=1'))).toEqual({ queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
  });

  it('counts a look at the queue as the heartbeat that keeps the entry alive', async () => {
    await data(post({ action: 'queue', kind: 'unranked' }));
    for (let poll = 1; poll <= 3; poll += 1) {
      expect(await data(get('?queue=1', neel, NOW + poll * (QUEUE_LAPSE_MS - 1)))).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    }
    const lapsed = NOW + 3 * (QUEUE_LAPSE_MS - 1) + QUEUE_LAPSE_MS;
    expect(await data(get('?queue=1', neel, lapsed))).toEqual({ queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
  });
});
