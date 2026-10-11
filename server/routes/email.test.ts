import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { beginReset } from '../account/reset.js';
import type { Db } from '../db/client.js';
import { BOARDS } from '../db/social.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, testDb } from '../testing.js';
import { account, accountPost, login, register } from './account.js';
import { daily } from './daily.js';
import { matchGet, matchPost } from './match.js';
import { socialGet, socialPost } from './social.js';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const PASSWORD = 'correct horse battery';
const EMAIL = 'neel.private@example.com';
const EMAIL_RULE = [400, 'Enter a valid email address.'];
const WRONG_PASSWORD = [403, 'That is not your current password.'];
const TAKEN = [409, 'That email already has an account. Use another address.'];
// Every attempt hashes a password, which is slow on purpose, and one of these tests makes a dozen.
const MANY_ATTEMPTS_TIMEOUT_MS = 60_000;

let db: Db;

const at = (now: number, moderators: readonly string[] = []): Context => ({ db, now, secret: TEST_SECRET, moderators });

/** An account made the way the site makes one, with an email. */
async function signUp(username: string, email = `${username}@example.com`): Promise<string> {
  const response = await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD, email } }), at(NOW));
  expect(response.status).toBe(201);
  return cookieFrom(response);
}

/** An account from before emails: it has a password and no address. */
async function olderAccount(username: string): Promise<string> {
  const cookie = await signUp(username);
  await db.query('UPDATE users SET email = NULL WHERE username = $1', [username]);
  return cookie;
}

const post = (cookie: string | undefined, body: unknown, now = NOW) => accountPost(apiRequest('POST', '/api/account', { body, cookie }), at(now));
const me = async (cookie: string, now = NOW) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(now))).json()).data.account;
const emailOf = async (username: string) => (await db.query<{ email: string | null }>('SELECT email FROM users WHERE username = $1', [username]))[0]?.email;
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

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('adding an email to an account that has none', () => {
  it('needs only the session, stores the address trimmed and in lower case, and shows it to the account', async () => {
    const cookie = await olderAccount('neel');
    expect(await me(cookie)).toMatchObject({ username: 'neel', email: null });

    expect(await data(post(cookie, { action: 'email', email: '  Neel@Example.COM ' }))).toEqual({ email: 'neel@example.com' });
    expect(await emailOf('neel')).toBe('neel@example.com');
    expect(await me(cookie)).toMatchObject({ email: 'neel@example.com' });
  });

  it('leaves the session and the password as they were', async () => {
    const cookie = await olderAccount('neel');
    const response = await post(cookie, { action: 'email', email: EMAIL });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await me(cookie)).toMatchObject({ username: 'neel' });
    expect((await login(apiRequest('POST', '/api/account/login', { body: { username: 'neel', password: PASSWORD } }), at(NOW))).status).toBe(200);
  });

  it.each([undefined, null, '', 'neel', 'neel@example', 42])('refuses %j as no address', async (email) => {
    const cookie = await olderAccount('neel');
    expect(await refusal(post(cookie, { action: 'email', email }))).toEqual(EMAIL_RULE);
    expect(await emailOf('neel')).toBeNull();
  });

  it('refuses an address another account has, however it is typed', async () => {
    await signUp('friend', 'shared@example.com');
    const cookie = await olderAccount('neel');
    expect(await refusal(post(cookie, { action: 'email', email: ' Shared@example.com' }))).toEqual(TAKEN);
    expect(await emailOf('neel')).toBeNull();
    expect(await emailOf('friend')).toBe('shared@example.com');
  });

  it('is for a signed-in account', async () => {
    expect(await refusal(post(undefined, { action: 'email', email: EMAIL }))).toEqual([401, 'Sign in first.']);
  });

  it('is not taken without end: 120 tries an hour, like the other changes that need no password', async () => {
    const cookie = await olderAccount('neel');
    const statuses: number[] = [];
    for (let index = 0; index < 120; index += 1) {
      statuses.push((await post(cookie, { action: 'email', email: 'not an address' })).status);
    }
    expect(statuses.every((status) => status === 400)).toBe(true);
    expect(await refusal(post(cookie, { action: 'email', email: EMAIL }))).toEqual([429, 'Too many requests. Slow down a little.']);
    expect((await post(cookie, { action: 'email', email: EMAIL }, NOW + HOUR)).status).toBe(200);
  });
});

describe('changing the email of an account that has one', () => {
  it('needs the current password, since the address is a way back in', async () => {
    const cookie = await signUp('neel');
    expect(await refusal(post(cookie, { action: 'email', email: EMAIL }))).toEqual(WRONG_PASSWORD);
    expect(await refusal(post(cookie, { action: 'email', email: EMAIL, password: 'not the password' }))).toEqual(WRONG_PASSWORD);
    expect(await refusal(post(cookie, { action: 'email', email: EMAIL, password: '' }))).toEqual(WRONG_PASSWORD);
    expect(await emailOf('neel')).toBe('neel@example.com');

    expect(await data(post(cookie, { action: 'email', email: EMAIL, password: PASSWORD }))).toEqual({ email: EMAIL });
    expect(await emailOf('neel')).toBe(EMAIL);
    expect(await me(cookie)).toMatchObject({ email: EMAIL });
  });

  it('looks at the address before the password, so a mistyped one costs no try', async () => {
    const cookie = await signUp('neel');
    expect(await refusal(post(cookie, { action: 'email', email: 'nope', password: 'not the password' }))).toEqual(EMAIL_RULE);
  });

  it('refuses an address another account has, with the right password', async () => {
    await signUp('friend', 'shared@example.com');
    const cookie = await signUp('neel');
    expect(await refusal(post(cookie, { action: 'email', email: 'shared@example.com', password: PASSWORD }))).toEqual(TAKEN);
    expect(await emailOf('neel')).toBe('neel@example.com');
  });

  it('ends every reset link sent to the old address', async () => {
    const cookie = await signUp('neel');
    const [row] = await db.query<{ id: string }>("SELECT id FROM users WHERE username = 'neel'");
    await beginReset(db, row?.id ?? '', NOW);
    expect(await db.query('SELECT 1 FROM password_resets')).toHaveLength(1);
    await data(post(cookie, { action: 'email', email: EMAIL, password: PASSWORD }));
    expect(await db.query('SELECT 1 FROM password_resets')).toEqual([]);
  });

  it(
    'shares the hour’s tries at the password with every other action that checks it',
    async () => {
      const cookie = await signUp('neel');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect(await refusal(post(cookie, { action: 'email', email: EMAIL, password: 'not the password' }))).toEqual(WRONG_PASSWORD);
      }
      const locked = [429, 'Too many tries at your password in the last hour. Try again later.'];
      expect(await refusal(post(cookie, { action: 'email', email: EMAIL, password: PASSWORD }))).toEqual(locked);
      expect(await refusal(post(cookie, { action: 'password', current: PASSWORD, next: 'a brand new password' }))).toEqual(locked);
      expect(await emailOf('neel')).toBe('neel@example.com');
      expect((await post(cookie, { action: 'email', email: EMAIL, password: PASSWORD }, NOW + HOUR)).status).toBe(200);
    },
    MANY_ATTEMPTS_TIMEOUT_MS,
  );
});

describe('an account’s email', () => {
  const MODERATORS = ['keeper'];
  const social = (query: string, cookie?: string) => socialGet(apiRequest('GET', `/api/social${query}`, { cookie }), at(NOW, MODERATORS));
  const act = (cookie: string, body: unknown) => socialPost(apiRequest('POST', '/api/social', { body, cookie }), at(NOW, MODERATORS));
  const match = (cookie: string, body: unknown) => matchPost(apiRequest('POST', '/api/match', { body, cookie }), at(NOW, MODERATORS));

  /** Whatever a reply says, as the text that crossed the wire. */
  const sentBy = async (response: Response | Promise<Response>): Promise<string> => {
    const sent = await response;
    expect(sent.status).toBeLessThan(300);
    return JSON.stringify(await sent.json());
  };

  it('is in the account’s own view and in nothing anyone else is sent about them', async () => {
    const neel = await signUp('neel', EMAIL);
    const friend = await signUp('friend');
    const keeper = await signUp('keeper');
    // on every board, so every board has a row about them
    await db.query("UPDATE users SET xp = 5000, best_streak = 7, rated_games = 3, rating = 640, last_seen_at = $1 WHERE username = 'neel'", [new Date(NOW).toISOString()]);
    await data(act(friend, { action: 'request', username: 'neel' }));
    const asked = await sentBy(social('?friends=1', neel));
    await data(act(neel, { action: 'accept', username: 'friend' }));
    await data(act(friend, { action: 'report', username: 'neel', category: 'other', reason: 'rude' }));
    const party = await data(match(neel, { action: 'create', settings: { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 } }));
    const joined = await sentBy(match(friend, { action: 'join', code: party.code }));

    const seen: Record<string, string> = {
      'the friends list while the request waits': asked,
      'a friend’s list of friends': await sentBy(social('?friends=1', friend)),
      'their profile, to a friend': await sentBy(social('?profile=neel', friend)),
      'their profile, to a visitor': await sentBy(social('?profile=neel')),
      'who is online': await sentBy(social('?online=1', friend)),
      'what a reporter is shown of their reports': await sentBy(social('?reports=1', friend)),
      'what a moderator is shown': await sentBy(social('?moderation=1', keeper)),
      'the party, to whoever joins it': joined,
      'the party, when it is asked for again': await sentBy(matchGet(apiRequest('GET', `/api/match?id=${party.id}`, { cookie: friend }), at(NOW, MODERATORS))),
      'the daily leaderboard': await sentBy(daily(apiRequest('GET', '/api/daily', { cookie: friend }), at(NOW, MODERATORS))),
    };
    for (const board of BOARDS) {
      seen[`the ${board} leaderboard`] = await sentBy(social(`?leaderboard=${board}`, friend));
      seen[`the ${board} leaderboard, to a visitor`] = await sentBy(social(`?leaderboard=${board}`));
    }

    for (const [what, text] of Object.entries(seen)) {
      expect(text, what).not.toContain(EMAIL);
      expect(text, what).not.toContain('neel.private');
      expect(text, what).not.toMatch(/"email"/i);
    }
    // each of these is about them, so there was something to leave the address out of
    const about = Object.entries(seen).filter(([, text]) => text.includes('"neel"'));
    expect(about.map(([what]) => what)).toEqual(expect.arrayContaining(['their profile, to a visitor', 'a friend’s list of friends', 'what a moderator is shown', 'the party, to whoever joins it', 'the rating leaderboard']));

    expect((await me(neel)).email).toBe(EMAIL);
    expect((await me(friend)).email).toBe('friend@example.com');
  });
});
