import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, testDb } from '../testing.js';
import { account, accountPost, login, register } from './account.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PASSWORD = 'correct horse battery';
const NEXT = 'a brand new password';
const CODE_SHAPE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
// A code of the right shape that is nobody's.
const NOT_THE_CODE = 'AAAA-AAAA-AAAA';
const WRONG_CODE = [401, 'Wrong username or recovery code.'];
const WRONG_PASSWORD = [403, 'That is not your current password.'];
const LOCKED = [429, 'Too many attempts. Try again in 15 minutes.'];
// Every attempt hashes a password, which is slow on purpose, and a few of these tests make a dozen.
const MANY_ATTEMPTS_TIMEOUT_MS = 60_000;

let db: Db;

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

/** A new account: the browser it was made in, and the recovery code it was shown. */
async function signUp(username = 'neel'): Promise<{ cookie: string; code: string }> {
  const response = await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD } }), at(NOW));
  expect(response.status).toBe(201);
  return { cookie: cookieFrom(response), code: (await response.json()).data.recoveryCode };
}

const post = (cookie: string | undefined, body: unknown, now = NOW) => accountPost(apiRequest('POST', '/api/account', { body, cookie }), at(now));
const signIn = (password: string, now = NOW, ip?: string) =>
  login(apiRequest('POST', '/api/account/login', { body: { username: 'neel', password }, ip }), at(now));
const recover = (recoveryCode: unknown, newPassword: unknown = NEXT, more: Record<string, unknown> = {}, ip?: string) =>
  login(apiRequest('POST', '/api/account/login', { body: { username: 'neel', recoveryCode, newPassword, ...more }, ip }), at(NOW));
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
const stored = async () => (await db.query<{ password_hash: string; recovery_hash: string | null; session_version: number }>("SELECT password_hash, recovery_hash, session_version FROM users WHERE username = 'neel'"))[0];

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('a recovery code', () => {
  it('is shown once, when the account is made: twelve characters in three groups, kept only as a hash', async () => {
    const response = await register(apiRequest('POST', '/api/account/register', { body: { username: 'Neel', password: PASSWORD } }), at(NOW));
    expect(response.status).toBe(201);
    const made = (await response.json()).data;
    expect(made).toEqual({ username: 'neel', recoveryCode: expect.stringMatching(CODE_SHAPE) });

    const kept = (await stored())?.recovery_hash ?? '';
    expect(kept).toMatch(/^scrypt\$/);
    expect(kept).not.toContain(made.recoveryCode);
    const seen = await me(cookieFrom(response));
    expect(seen.hasRecoveryCode).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(made.recoveryCode);
  });

  it('is each account’s own', async () => {
    expect((await signUp('neel')).code).not.toBe((await signUp('other')).code);
  });

  it('is something an account made before there were codes does not have', async () => {
    const { cookie } = await signUp();
    await db.query('UPDATE users SET recovery_hash = NULL');
    expect((await me(cookie)).hasRecoveryCode).toBe(false);
  });
});

describe('asking for a new recovery code', () => {
  const issue = (cookie: string | undefined, password?: unknown, now = NOW) => post(cookie, { action: 'recoveryCode', password }, now);

  it('takes the current password, and replaces the code there was', async () => {
    const { cookie, code } = await signUp();
    const issued = await data(issue(cookie, PASSWORD));
    expect(issued).toEqual({ recoveryCode: expect.stringMatching(CODE_SHAPE) });
    expect(issued.recoveryCode).not.toBe(code);
    // The browser that asked stays signed in.
    expect(await me(cookie)).toMatchObject({ username: 'neel', hasRecoveryCode: true });

    expect(await refusal(recover(code))).toEqual(WRONG_CODE);
    expect((await recover(issued.recoveryCode)).status).toBe(200);
  });

  it('gives one to an account that had none', async () => {
    const { cookie } = await signUp();
    await db.query('UPDATE users SET recovery_hash = NULL');
    const issued = await data(issue(cookie, PASSWORD));
    expect((await me(cookie)).hasRecoveryCode).toBe(true);
    expect((await recover(issued.recoveryCode)).status).toBe(200);
  });

  it('refuses a wrong or a missing password, and leaves the code as it was', async () => {
    const { cookie, code } = await signUp();
    const before = await stored();
    expect(await refusal(issue(cookie, 'not my password'))).toEqual(WRONG_PASSWORD);
    expect(await refusal(issue(cookie))).toEqual(WRONG_PASSWORD);
    expect(await refusal(issue(cookie, 42))).toEqual(WRONG_PASSWORD);
    expect(await stored()).toEqual(before);
    expect((await recover(code)).status).toBe(200);
  });

  it('counts against the same ten tries an hour as changing the password and deleting the account', async () => {
    const { cookie } = await signUp();
    // A try with no password is a try all the same, and costs no hashing.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await issue(cookie)).status).toBe(403);
    }
    expect(await refusal(issue(cookie, PASSWORD))).toEqual([429, 'Too many tries at your password in the last hour. Try again later.']);
    expect((await post(cookie, { action: 'password', current: PASSWORD, next: NEXT })).status).toBe(429);
    expect((await post(cookie, { action: 'delete', password: PASSWORD })).status).toBe(429);
    expect((await issue(cookie, PASSWORD, NOW + HOUR)).status).toBe(200);
  });

  it('is for a signed-in account', async () => {
    expect(await refusal(issue(undefined, PASSWORD))).toEqual([401, 'Sign in first.']);
    const guest = await createGuest(db, NOW);
    const guestCookie = `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`;
    expect(await refusal(issue(guestCookie, PASSWORD))).toEqual([403, 'Guests cannot do that. Make an account first.']);
  });

  it('gives way to a recovery made at the same moment: the code the recovery was shown is the one that stands', async () => {
    const { cookie, code } = await signUp();
    const [issued, recovered] = await Promise.all([issue(cookie, PASSWORD), recover(code)]);
    // Either the new code was issued first, which spent the old one, or the recovery got there first: it changed the
    // password the request had checked (403), or had already ended the session that asked (401).
    expect(['200 401', '403 200', '401 200']).toContain(`${issued.status} ${recovered.status}`);
    const standing = (await (issued.status === 200 ? issued : recovered).json()).data.recoveryCode;
    expect((await recover(standing, 'whichever one stood')).status).toBe(200);
  });

  it('asked for twice at the same moment, leaves the account with one of the two codes, and that one works', async () => {
    const { cookie, code } = await signUp();
    const issued = await Promise.all([issue(cookie, PASSWORD), issue(cookie, PASSWORD)]);
    expect(issued.map((reply) => reply.status)).toEqual([200, 200]);
    const codes = await Promise.all(issued.map(async (reply) => (await reply.json()).data.recoveryCode as string));
    expect(new Set([code, ...codes]).size).toBe(3);
    // Whichever was stored last replaced the other, as it would have a minute later.
    const statuses = [(await recover(codes[0], 'the first new password')).status, (await recover(codes[1], 'the second new password')).status];
    expect(statuses.sort()).toEqual([200, 401]);
  });
});

describe('forgot password', () => {
  it('sets the new password, signs this browser in and every other one out, and gives a new code for the one used', async () => {
    const { cookie: elsewhere, code } = await signUp();
    const response = await login(apiRequest('POST', '/api/account/login', { body: { username: ' Neel ', recoveryCode: code, newPassword: NEXT } }), at(NOW));
    expect(response.status).toBe(200);
    const recovered = (await response.json()).data;
    expect(recovered).toEqual({ username: 'neel', recoveryCode: expect.stringMatching(CODE_SHAPE) });
    expect(recovered.recoveryCode).not.toBe(code);

    expect(await me(cookieFrom(response))).toMatchObject({ username: 'neel', hasRecoveryCode: true });
    expect(await me(elsewhere)).toBeNull();
    expect(await refusal(post(elsewhere, { action: 'country', country: 'FR' }))).toEqual([401, 'Sign in first.']);

    expect((await signIn(NEXT)).status).toBe(200);
    expect((await signIn(PASSWORD)).status).toBe(401);
    // The code that was used is spent; the new one works, once.
    expect(await refusal(recover(code, 'a third password'))).toEqual(WRONG_CODE);
    expect((await recover(recovered.recoveryCode, 'a third password')).status).toBe(200);
  });

  it('reads a code whatever its capitals, spaces and hyphens', async () => {
    const { code } = await signUp();
    const typed = ` ${code.toLowerCase().replaceAll('-', '').replace(/(.{3})/g, '$1 ')}-`;
    expect(typed).not.toBe(code);
    expect((await recover(typed)).status).toBe(200);
  });

  it('answers an unknown name, an account with no code and a wrong code identically, and changes nothing', async () => {
    const { cookie, code } = await signUp();
    await signUp('codeless');
    await db.query("UPDATE users SET recovery_hash = NULL WHERE username = 'codeless'");
    const before = await stored();
    const attempts = [
      { username: 'nobody', recoveryCode: code },
      { username: 'codeless', recoveryCode: code },
      { username: 'codeless', recoveryCode: '' },
      { username: 'neel', recoveryCode: NOT_THE_CODE },
      { username: 'neel', recoveryCode: code.slice(0, -1) },
      { username: 'neel', recoveryCode: 42 },
      { username: 'x', recoveryCode: code },
    ];
    const replies = [];
    for (const [index, body] of attempts.entries()) {
      const response = await login(apiRequest('POST', '/api/account/login', { body: { ...body, newPassword: NEXT }, ip: `198.51.100.${index}` }), at(NOW));
      expect(response.headers.getSetCookie()).toEqual([]);
      replies.push({ status: response.status, body: await response.json() });
    }
    expect(new Set(replies.map((reply) => JSON.stringify(reply))).size).toBe(1);
    expect(replies[0]).toEqual({ status: 401, body: { success: false, error: 'Wrong username or recovery code.' } });
    expect(await stored()).toEqual(before);
    expect(await me(cookie)).toMatchObject({ username: 'neel' });
  });

  it.each([['short'], ['x'.repeat(201)], [42], [null]])('refuses the new password %j before it looks at the code', async (newPassword) => {
    const { code } = await signUp();
    const before = await stored();
    const tooWeak = [400, 'Choose a new password of 8 to 200 characters.'];
    expect(await refusal(recover(code, newPassword))).toEqual(tooWeak);
    expect(await refusal(recover(NOT_THE_CODE, newPassword))).toEqual(tooWeak);
    expect(await refusal(recover('not a code at all', newPassword))).toEqual(tooWeak);
    expect(await stored()).toEqual(before);
  });

  it('refuses a request with no new password in it the same way', async () => {
    const { code } = await signUp();
    const request = apiRequest('POST', '/api/account/login', { body: { username: 'neel', recoveryCode: code } });
    expect(await refusal(login(request, at(NOW)))).toEqual([400, 'Choose a new password of 8 to 200 characters.']);
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it(
    'is limited with signing in: ten tries from an address in fifteen minutes, whichever they were',
    async () => {
      const { code } = await signUp();
      const ip = '203.0.113.7';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await signIn('wrong password', NOW, ip)).status).toBe(401);
        expect(await refusal(recover(NOT_THE_CODE, NEXT, {}, ip))).toEqual(WRONG_CODE);
      }
      expect(await refusal(recover(code, NEXT, {}, ip))).toEqual(LOCKED);
      expect(await refusal(signIn(PASSWORD, NOW, ip))).toEqual(LOCKED);
      expect((await recover(code, NEXT, {}, '203.0.113.8')).status).toBe(200);
    },
    MANY_ATTEMPTS_TIMEOUT_MS,
  );

  it('is limited with signing in for one username from many addresses', async () => {
    const { code } = await signUp();
    // Thirty tries at this name's password in the last few minutes, from wherever.
    await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ('account-login-username:neel', $1::timestamptz, 30)", [new Date(NOW - MINUTE)]);
    expect(await refusal(recover(code))).toEqual(LOCKED);
    expect((await signIn(PASSWORD)).status).toBe(429);
    await db.query('DELETE FROM rate_limits');
    // And a try at the code is a try at the name.
    await db.query("INSERT INTO rate_limits (key, window_start, count) VALUES ('account-login-username:neel', $1::timestamptz, 29)", [new Date(NOW - MINUTE)]);
    expect(await refusal(recover(NOT_THE_CODE, NEXT, {}, '198.51.100.1'))).toEqual(WRONG_CODE);
    expect(await refusal(signIn(PASSWORD, NOW, '198.51.100.2'))).toEqual(LOCKED);
  });

  it('refuses a request sent from another site', async () => {
    const { code } = await signUp();
    const request = apiRequest('POST', '/api/account/login', { body: { username: 'neel', recoveryCode: code, newPassword: NEXT }, headers: { origin: 'https://evil.example' } });
    expect(await refusal(login(request, at(NOW)))).toEqual([403, 'Request refused.']);
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it('recovers a banned account, which is still banned', async () => {
    const { code } = await signUp();
    await db.query('UPDATE users SET banned = true');
    const response = await recover(code);
    expect(response.status).toBe(200);
    expect(await me(cookieFrom(response))).toMatchObject({ username: 'neel', banned: true });
  });

  it('lets one of two recoveries made with one code through, and that one sets the password', async () => {
    const { code } = await signUp();
    const choices = ['the first new password', 'the second new password'];
    const replies = await Promise.all(choices.map((newPassword) => recover(code, newPassword)));
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 401]);
    const winner = replies.findIndex((reply) => reply.status === 200);
    expect((await signIn(choices[winner] ?? '')).status).toBe(200);
    expect((await signIn(choices[1 - winner] ?? '')).status).toBe(401);
    // One code was given out for the one that was spent, and it is the one that works.
    const fresh = (await replies[winner]?.json()).data.recoveryCode;
    expect((await stored())?.session_version).toBe(1);
    expect((await recover(fresh, 'a third password')).status).toBe(200);
  });

  it('wins over a change of password made at the same moment, whichever lands first', async () => {
    const { cookie, code } = await signUp();
    const [changed, recovered] = await Promise.all([post(cookie, { action: 'password', current: PASSWORD, next: 'changed in the pane' }), recover(code)]);
    // The recovery does not depend on the old password, so it always goes through; the change does, and may find
    // the password gone (403) or its own session already ended (401).
    expect(recovered.status).toBe(200);
    expect([200, 403, 401]).toContain(changed.status);
    expect((await signIn(NEXT)).status).toBe(200);
    expect((await signIn('changed in the pane')).status).toBe(401);
    expect((await signIn(PASSWORD)).status).toBe(401);
    // The one session left is the recovery's.
    expect(await me(cookieFrom(recovered))).toMatchObject({ username: 'neel' });
    expect(await me(cookie)).toBeNull();
    if (changed.status === 200) {
      expect(await me(cookieFrom(changed))).toBeNull();
    }
  });
});

describe('forgot password, for a deleted account', () => {
  let code: string;

  beforeEach(async () => {
    const made = await signUp();
    code = made.code;
    await data(post(made.cookie, { action: 'delete', password: PASSWORD }));
  });

  it('says the account was deleted only to whoever has the code, and spends nothing', async () => {
    const before = await stored();
    expect(await refusal(recover(code))).toEqual([409, 'This account was deleted. Restore it to sign in.']);
    expect(await refusal(recover(code, NEXT, { restore: false }))).toEqual([409, 'This account was deleted. Restore it to sign in.']);
    expect(await refusal(recover(NOT_THE_CODE))).toEqual(WRONG_CODE);
    expect(await refusal(recover(NOT_THE_CODE, NEXT, { restore: true }))).toEqual(WRONG_CODE);
    expect(await stored()).toEqual(before);
    expect(await db.query("SELECT deleted_at IS NULL AS restored FROM users WHERE username = 'neel'")).toEqual([{ restored: false }]);
  });

  it('restores it and signs in when asked to', async () => {
    const response = await recover(code, NEXT, { restore: true });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ username: 'neel', recoveryCode: expect.stringMatching(CODE_SHAPE) });
    expect(await me(cookieFrom(response))).toMatchObject({ username: 'neel' });
    expect((await signIn(NEXT)).status).toBe(200);
  });
});

describe('signing out everywhere', () => {
  it('ends every session of the account, this browser’s included, and leaves it able to sign in again', async () => {
    const { cookie } = await signUp();
    const elsewhere = cookieFrom(await signIn(PASSWORD));
    const response = await post(cookie, { action: 'signOutEverywhere' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { signedOut: true } });
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-plonk_account=;.*Max-Age=0/);

    for (const ended of [cookie, elsewhere]) {
      const asked = await account(apiRequest('GET', '/api/account', { cookie: ended }), at(NOW));
      expect((await asked.json()).data.account).toBeNull();
      expect(asked.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
      expect(await refusal(post(ended, { action: 'country', country: 'FR' }))).toEqual([401, 'Sign in first.']);
    }
    expect(await me(cookieFrom(await signIn(PASSWORD)))).toMatchObject({ username: 'neel' });
  });

  it('is for a signed-in account, and is not something another site can ask', async () => {
    expect(await refusal(post(undefined, { action: 'signOutEverywhere' }))).toEqual([401, 'Sign in first.']);
    const { cookie } = await signUp();
    const crossSite = apiRequest('POST', '/api/account', { body: { action: 'signOutEverywhere' }, cookie, headers: { origin: 'https://evil.example' } });
    expect(await refusal(accountPost(crossSite, at(NOW)))).toEqual([403, 'Request refused.']);
    expect(await me(cookie)).toMatchObject({ username: 'neel' });
  });

  it('asked twice at once, ends the sessions all the same', async () => {
    const { cookie } = await signUp();
    const replies = await Promise.all([post(cookie, { action: 'signOutEverywhere' }), post(cookie, { action: 'signOutEverywhere' })]);
    // The second may find the session already ended, which is what it asked for.
    expect(replies.map((reply) => reply.status).every((status) => status === 200 || status === 401)).toBe(true);
    expect(replies.some((reply) => reply.status === 200)).toBe(true);
    expect(await me(cookie)).toBeNull();
  });
});
