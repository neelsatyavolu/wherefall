import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, testDb } from '../testing.js';
import { account, accountPost, login, register } from './account.js';
import { socialGet, socialPost } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = 'correct horse battery';
const NEXT = 'a brand new password';
const WRONG_PASSWORD = [403, 'That is not your current password.'];
const DELETED = [409, 'This account was deleted. Restore it to sign in.'];
// Every attempt hashes a password, which is slow on purpose, and some of these tests make a dozen.
const MANY_ATTEMPTS_TIMEOUT_MS = 60_000;

let db: Db;

const at = (now: number, moderators: readonly string[] = []): Context => ({ db, now, secret: TEST_SECRET, moderators });

async function signUp(username = 'neel', now = NOW): Promise<string> {
  const response = await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD, email: `${username}@example.com` } }), at(now));
  expect(response.status).toBe(201);
  return cookieFrom(response);
}

const post = (cookie: string | undefined, body: unknown, now = NOW) => accountPost(apiRequest('POST', '/api/account', { body, cookie }), at(now));
const signIn = (password: string, now = NOW, more: Record<string, unknown> = {}, username = 'neel') =>
  login(apiRequest('POST', '/api/account/login', { body: { username, password, ...more } }), at(now));
const me = async (cookie: string, now = NOW) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(now))).json()).data.account;
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
const data = async (response: Response | Promise<Response>) => {
  const body = await (await response).json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const social = (query: string, cookie?: string, now = NOW) => socialGet(apiRequest('GET', `/api/social${query}`, { cookie }), at(now));
const deleteAccount = (cookie: string, now = NOW) => post(cookie, { action: 'delete', password: PASSWORD }, now);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('POST /api/account', () => {
  it('is for a signed-in account: a visitor is told to sign in, a guest to make an account', async () => {
    const body = { action: 'country', country: 'FR' };
    expect(await refusal(post(undefined, body))).toEqual([401, 'Sign in first.']);
    const guest = await createGuest(db, NOW);
    const guestCookie = `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`;
    expect(await refusal(post(guestCookie, body))).toEqual([403, 'Guests cannot do that. Make an account first.']);
  });

  it('refuses a request sent from another site, and one that asks for nothing known', async () => {
    const cookie = await signUp();
    const crossSite = apiRequest('POST', '/api/account', { body: { action: 'delete', password: PASSWORD }, cookie, headers: { origin: 'https://evil.example' } });
    expect(await refusal(accountPost(crossSite, at(NOW)))).toEqual([403, 'Request refused.']);
    for (const body of [{ action: 'promote' }, { country: 'FR' }, 'delete']) {
      expect(await refusal(post(cookie, body))).toEqual([400, 'That is not something that can be asked here.']);
    }
    expect(await me(cookie)).toMatchObject({ username: 'neel', country: null });
  });

  it('answers an account that is gone as it would a visitor', async () => {
    const cookie = await signUp();
    await db.query('DELETE FROM users');
    expect(await refusal(post(cookie, { action: 'country', country: 'FR' }))).toEqual([401, 'Sign in first.']);
  });
});

describe('changing the password', () => {
  const change = (cookie: string, current: unknown, next: unknown, now = NOW) => post(cookie, { action: 'password', current, next }, now);

  it('swaps the old password for the new one', async () => {
    const cookie = await signUp();
    const response = await change(cookie, PASSWORD, NEXT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true } });
    expect((await signIn(NEXT)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
    // The browser that changed it is given a new session and stays signed in; the old one is over, here and in every other browser.
    expect(await me(cookieFrom(response))).toMatchObject({ username: 'neel' });
    expect(await me(cookie)).toBeNull();
    expect(await refusal(post(cookie, { action: 'country', country: 'FR' }))).toEqual([401, 'Sign in first.']);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const cookie = await signUp();
    expect(await refusal(change(cookie, 'not my password', NEXT))).toEqual(WRONG_PASSWORD);
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it.each([['short'], ['x'.repeat(201)], [42], [undefined]])('refuses the new password %j', async (next) => {
    const cookie = await signUp();
    expect(await refusal(change(cookie, PASSWORD, next))).toEqual([400, 'Choose a new password of 8 to 200 characters.']);
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it('takes a new password of exactly 8 and of exactly 200 characters', async () => {
    const cookie = await signUp();
    const first = await change(cookie, PASSWORD, '12345678');
    expect(first.status).toBe(200);
    expect((await change(cookieFrom(first), '12345678', 'x'.repeat(200))).status).toBe(200);
  });

  it(
    'can be tried ten times an hour',
    async () => {
      const cookie = await signUp();
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        statuses.push((await change(cookie, 'not my password', NEXT)).status);
      }
      expect(statuses).toEqual([...Array.from({ length: 10 }, () => 403), 429]);
      // The right password is locked out with the wrong ones, and let back in an hour on.
      expect(await refusal(change(cookie, PASSWORD, NEXT))).toEqual([429, 'Too many tries at your password in the last hour. Try again later.']);
      expect((await change(cookie, PASSWORD, NEXT, NOW + HOUR)).status).toBe(200);
    },
    MANY_ATTEMPTS_TIMEOUT_MS,
  );

  it('lets one of two changes made at the same moment through, and that one is the password', async () => {
    const cookie = await signUp();
    const choices = ['the first new password', 'the second new password'];
    const replies = await Promise.all(choices.map((next) => change(cookie, PASSWORD, next)));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 403]);
    const won = choices[replies.findIndex((reply) => reply.status === 200)] ?? '';
    const lost = choices.find((choice) => choice !== won) ?? '';
    expect((await signIn(won)).status).toBe(200);
    expect((await signIn(lost)).status).toBe(401);
    expect((await signIn(PASSWORD)).status).toBe(401);
  });
});

describe('the country', () => {
  const setCountry = (cookie: string, country: unknown) => post(cookie, { action: 'country', country });

  it('is set to a two-letter code, and cleared with null', async () => {
    const cookie = await signUp();
    expect(await data(setCountry(cookie, 'FR'))).toEqual({ country: 'FR' });
    expect((await me(cookie)).country).toBe('FR');
    expect(await data(setCountry(cookie, null))).toEqual({ country: null });
    expect((await me(cookie)).country).toBeNull();
  });

  it.each([['fr'], ['FRA'], ['F'], [''], [33], [undefined]])('refuses %j', async (country) => {
    const cookie = await signUp();
    await data(setCountry(cookie, 'IN'));
    expect(await refusal(setCountry(cookie, country))).toEqual([400, 'Choose a country by its two-letter code, or none.']);
    expect((await me(cookie)).country).toBe('IN');
  });
});

describe('the settings', () => {
  const set = (cookie: string, settings: Record<string, unknown>) => post(cookie, { action: 'settings', ...settings });

  it('start with friend requests allowed, chat shown and last seen shown, and say so when nothing is changed', async () => {
    const cookie = await signUp();
    expect(await data(set(cookie, {}))).toEqual({ allowFriendRequests: true, hideChat: false, hideLastSeen: false });
  });

  it('change one at a time or together, leaving alone what is not named', async () => {
    const cookie = await signUp();
    expect(await data(set(cookie, { hideChat: true }))).toEqual({ allowFriendRequests: true, hideChat: true, hideLastSeen: false });
    expect(await data(set(cookie, { allowFriendRequests: false }))).toEqual({ allowFriendRequests: false, hideChat: true, hideLastSeen: false });
    expect(await data(set(cookie, { hideLastSeen: true }))).toEqual({ allowFriendRequests: false, hideChat: true, hideLastSeen: true });
    expect(await data(set(cookie, { allowFriendRequests: true, hideChat: false }))).toEqual({ allowFriendRequests: true, hideChat: false, hideLastSeen: true });
    await data(set(cookie, { allowFriendRequests: false }));
    expect(await me(cookie)).toMatchObject({ allowFriendRequests: false, hideChat: false, hideLastSeen: true });
    expect(await data(set(cookie, { hideLastSeen: false }))).toEqual({ allowFriendRequests: false, hideChat: false, hideLastSeen: false });
  });

  it.each([[{ hideChat: 'yes' }], [{ allowFriendRequests: 1 }], [{ hideChat: null }], [{ hideLastSeen: 'on' }], [{ hideLastSeen: 0 }]])('refuses %j', async (settings) => {
    const cookie = await signUp();
    expect(await refusal(set(cookie, settings))).toEqual([400, 'A setting is either on or off.']);
    expect(await me(cookie)).toMatchObject({ allowFriendRequests: true, hideChat: false, hideLastSeen: false });
  });
});

describe('the changes that need no password', () => {
  const SLOW_DOWN = [429, 'Too many requests. Slow down a little.'];

  it.each([
    ['country', { action: 'country', country: 'FR' }],
    ['settings', { action: 'settings', hideChat: true }],
  ])('can be made 120 times an hour to the %s, each account for itself', async (_name, body) => {
    const cookie = await signUp();
    const other = await signUp('other');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 121; attempt += 1) {
      statuses.push((await post(cookie, body)).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 120 }, () => 200), 429]);
    expect(await refusal(post(cookie, body))).toEqual(SLOW_DOWN);
    // One that would have been refused anyway is counted too, so the limit cannot be felt out for free.
    expect(await refusal(post(cookie, { action: body.action }))).toEqual(SLOW_DOWN);
    expect((await post(other, body)).status).toBe(200);
    expect((await post(cookie, body, NOW + HOUR)).status).toBe(200);
  });

  it('are counted apart: a player who has used up one can still make the other', async () => {
    const cookie = await signUp();
    for (let attempt = 0; attempt < 121; attempt += 1) {
      await post(cookie, { action: 'country', country: 'FR' });
    }
    expect((await post(cookie, { action: 'settings', hideChat: true })).status).toBe(200);
  });
});

describe('deleting the account', () => {
  it('needs the password', async () => {
    const cookie = await signUp();
    expect(await refusal(post(cookie, { action: 'delete', password: 'not my password' }))).toEqual(WRONG_PASSWORD);
    expect(await refusal(post(cookie, { action: 'delete' }))).toEqual(WRONG_PASSWORD);
    expect(await me(cookie)).toMatchObject({ username: 'neel' });
  });

  it('answers with how long it can be restored, and signs the browser out', async () => {
    const cookie = await signUp();
    const response = await deleteAccount(cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { deleted: true, restoreUntil: new Date(NOW + 30 * DAY).toISOString() } });
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-plonk_account=;.*Max-Age=0/);
  });

  it('signs out every other browser the next time it asks who it is', async () => {
    const cookie = await signUp();
    const elsewhere = cookieFrom(await signIn(PASSWORD));
    await deleteAccount(cookie);
    const response = await account(apiRequest('GET', '/api/account', { cookie: elsewhere }), at(NOW + DAY));
    expect(await response.json()).toEqual({ success: true, data: { account: null, guest: null, stats: null, recentGames: [] } });
    expect(response.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
    // Being looked at did not count a day of the login streak.
    expect(await db.query('SELECT login_streak FROM users')).toEqual([{ login_streak: 0 }]);
    expect(await refusal(post(elsewhere, { action: 'country', country: 'FR' }))).toEqual([401, 'Sign in first.']);
    expect(await refusal(deleteAccount(elsewhere))).toEqual([401, 'Sign in first.']);
  });

  // What it leaves behind in queues, matches and maps is in gone.test.ts.

  it('is not open to a moderator, whose name is what makes them one', async () => {
    const cookie = await signUp('mod');
    const request = apiRequest('POST', '/api/account', { body: { action: 'delete', password: PASSWORD }, cookie });
    expect(await refusal(accountPost(request, at(NOW, ['mod'])))).toEqual([409, "A moderator's account cannot be deleted."]);
    expect(await db.query('SELECT deleted_at FROM users')).toEqual([{ deleted_at: null }]);
  });

  it('counts wrong passwords against the same ten tries an hour as changing the password', async () => {
    const cookie = await signUp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await post(cookie, { action: 'delete', password: 'not my password' })).status).toBe(403);
    }
    expect((await deleteAccount(cookie)).status).toBe(429);
    expect((await post(cookie, { action: 'password', current: PASSWORD, next: NEXT })).status).toBe(429);
    expect((await deleteAccount(cookie, NOW + HOUR)).status).toBe(200);
  }, MANY_ATTEMPTS_TIMEOUT_MS);
});

describe('a deleted account', () => {
  let cookie: string;
  let friend: string;

  beforeEach(async () => {
    cookie = await signUp('neel');
    friend = await signUp('friend');
    await db.query("UPDATE users SET xp = 900, rating = 800, rated_games = 4, best_streak = 6 WHERE username = 'neel'");
    await db.query("UPDATE users SET xp = 500, rating = 700, rated_games = 2, best_streak = 3 WHERE username = 'friend'");
    const request = (as: string, body: unknown) => socialPost(apiRequest('POST', '/api/social', { body, cookie: as }), at(NOW));
    await data(request(cookie, { action: 'request', username: 'friend' }));
    await data(request(friend, { action: 'accept', username: 'neel' }));
    await data(deleteAccount(cookie));
  });

  const act = (as: string, body: unknown, now = NOW) => socialPost(apiRequest('POST', '/api/social', { body, cookie: as }), at(now));

  it('has no profile', async () => {
    expect(await refusal(social('?profile=neel'))).toEqual([404, 'No player by that name.']);
    expect(await refusal(social('?profile=neel', friend))).toEqual([404, 'No player by that name.']);
    expect(await db.query("SELECT profile_views FROM users WHERE username = 'neel'")).toEqual([{ profile_views: 0 }]);
  });

  it('is on no leaderboard, where the players below move up', async () => {
    for (const board of ['rating', 'xp', 'streak']) {
      const seen = await data(social(`?leaderboard=${board}`, friend));
      expect(seen.entries.map((entry: { rank: number; username: string }) => [entry.rank, entry.username])).toEqual([[1, 'friend']]);
      expect(seen.you.rank).toBe(1);
      expect((await data(social(`?leaderboard=${board}`, cookie))).you).toBeNull();
    }
    expect((await me(friend)).duels.rank).toBe(1);
  });

  it('is in nobody’s friends or requests, and cannot be asked, invited or reported', async () => {
    expect(await data(social('?friends=1', friend))).toEqual({ friends: [], incoming: [], outgoing: [], invites: [] });
    for (const action of ['request', 'accept', 'decline', 'remove', 'report']) {
      expect(await refusal(act(friend, { action, username: 'neel', category: 'other' }))).toEqual([404, 'No player by that name.']);
    }
  });

  it('does not count towards the hundred friends a player may have', async () => {
    const friendId = (await db.query<{ id: string }>("SELECT id FROM users WHERE username = 'friend'"))[0]?.id;
    for (let index = 0; index < 99; index += 1) {
      const id = randomUUID();
      await db.query("INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, '', $3)", [id, `filler${index}`, new Date(NOW)]);
      await db.query('INSERT INTO friendships (requester_id, addressee_id, accepted, created_at) VALUES ($1, $2, true, $3)', [friendId, id, new Date(NOW)]);
    }
    await signUp('hundredth');
    expect((await act(friend, { action: 'request', username: 'hundredth' })).status).toBe(200);
  });

  it('can do nothing from a browser that is still signed in to it', async () => {
    expect(await refusal(social('?friends=1', cookie))).toEqual([401, 'Sign in first.']);
    for (const body of [{ action: 'request', username: 'friend' }, { action: 'report', username: 'friend' }, { action: 'rename', username: 'someone_new' }]) {
      expect(await refusal(act(cookie, body))).toEqual([401, 'Sign in first.']);
    }
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });

  it('keeps its username: nobody can register it or rename to it', async () => {
    const taken = await register(apiRequest('POST', '/api/account/register', { body: { username: 'neel', password: PASSWORD, email: 'neel@example.com' } }), at(NOW + DAY));
    expect(taken.status).toBe(409);
    expect(await refusal(act(friend, { action: 'rename', username: 'neel' }))).toEqual([409, 'That username is taken. Choose another.']);
  });

  it('cannot sign in, and says why only to whoever knows the password', async () => {
    expect(await refusal(signIn(PASSWORD))).toEqual(DELETED);
    expect(await refusal(signIn(PASSWORD, NOW, { restore: false }))).toEqual(DELETED);
    expect(await refusal(signIn('not my password'))).toEqual([401, 'Wrong username or password.']);
    expect(await refusal(signIn('not my password', NOW, { restore: true }))).toEqual([401, 'Wrong username or password.']);
    expect(await db.query("SELECT deleted_at IS NULL AS restored FROM users WHERE username = 'neel'")).toEqual([{ restored: false }]);
  });

  it('comes back as it was when restored: signed in, with its standing and its friends', async () => {
    const response = await signIn(PASSWORD, NOW + 29 * DAY, { restore: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel' } });
    const restored = cookieFrom(response);
    expect(await me(restored, NOW + 29 * DAY)).toMatchObject({ username: 'neel', xp: 900, rating: 800 });
    expect((await data(social('?profile=neel'))).username).toBe('neel');
    expect((await data(social('?friends=1', friend))).friends).toMatchObject([{ username: 'neel' }]);
    expect((await signIn(PASSWORD, NOW + 29 * DAY)).status).toBe(200);
  });

  it('is gone for good after 30 days, and its name is free', async () => {
    expect((await signIn(PASSWORD, NOW + 30 * DAY - 1, { restore: true }, 'friend')).status).toBe(200);
    expect(await db.query("SELECT 1 FROM users WHERE username = 'neel'")).toHaveLength(1);

    expect(await refusal(signIn(PASSWORD, NOW + 30 * DAY, { restore: true }))).toEqual([401, 'Wrong username or password.']);
    expect(await db.query("SELECT 1 FROM users WHERE username = 'neel'")).toEqual([]);
    expect(await db.query('SELECT 1 FROM friendships')).toEqual([]);
    const again = await register(apiRequest('POST', '/api/account/register', { body: { username: 'neel', password: NEXT, email: 'neel@example.com' } }), at(NOW + 30 * DAY));
    expect(again.status).toBe(201);
    expect(await me(cookieFrom(again), NOW + 30 * DAY)).toMatchObject({ username: 'neel', xp: 0 });
  });

  it('is cleared away by the next account made after its 30 days, without anyone asking for its name', async () => {
    await signUp('newcomer', NOW + 31 * DAY);
    expect(await db.query("SELECT 1 FROM users WHERE username = 'neel'")).toEqual([]);
  });

  it('is deleted again, or restored, whichever is asked last when both are asked at once', async () => {
    const restored = cookieFrom(await signIn(PASSWORD, NOW, { restore: true }));
    const [deleted, signedIn] = await Promise.all([deleteAccount(restored), signIn(PASSWORD, NOW, { restore: true })]);
    expect([deleted.status, signedIn.status]).toEqual([200, 200]);

    // Either order leaves an account that is wholly one thing: there to its own session and to everyone, or to nobody.
    const [{ gone } = { gone: true }] = await db.query<{ gone: boolean }>("SELECT deleted_at IS NOT NULL AS gone FROM users WHERE username = 'neel'");
    expect((await me(cookieFrom(signedIn))) === null).toBe(gone);
    expect((await social('?profile=neel')).status).toBe(gone ? 404 : 200);
    expect((await signIn(PASSWORD)).status).toBe(gone ? 409 : 200);
    expect((await signIn(PASSWORD, NOW, { restore: true })).status).toBe(200);
  });
});
