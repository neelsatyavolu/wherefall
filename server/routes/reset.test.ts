import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashResetToken } from '../account/reset.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { MailError, type Mail } from '../mail/send.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, testDb } from '../testing.js';
import { account, accountPost, login, register } from './account.js';
import { reset } from './reset.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = 'correct horse battery';
const NEXT = 'a brand new password';
const APP_URL = 'https://wherefall.example';
const EMAIL = 'neel@example.com';
/** What asking for a link is always answered with, whoever asked and whatever came of it. */
const REQUESTED = { success: true, data: { requested: true } };
const LOCKED = [429, 'Too many attempts. Try again in 15 minutes.'];
const BAD_LINK = [400, 'This reset link is not valid or has expired. Ask for a new one.'];
const NEW_PASSWORD_RULE = [400, 'Choose a new password of 8 to 200 characters.'];
// Every reset hashes a password, which is slow on purpose, and some of these tests make a dozen.
const MANY_ATTEMPTS_TIMEOUT_MS = 60_000;

let db: Db;
/** Every email the site sent, in order. */
let sent: Mail[];
/** Set to make the next sends fail the way Resend refusing them does. */
let refusing: Error | null;

const mailer = async (mail: Mail): Promise<void> => {
  sent.push(mail);
  if (refusing) {
    throw refusing;
  }
};

const at = (now: number, change: Partial<Context> = {}): Context => ({ db, now, secret: TEST_SECRET, appUrl: APP_URL, sendMail: mailer, ...change });

interface Asked {
  now?: number;
  ip?: string;
  headers?: Record<string, string>;
  context?: Partial<Context>;
}

const ask = (body: unknown, { now = NOW, ip, headers, context }: Asked = {}) =>
  reset(apiRequest('POST', '/api/account/reset', { body, ...(ip ? { ip } : {}), ...(headers ? { headers } : {}) }), at(now, context));
const request = (email: unknown, asked: Asked = {}, lang?: unknown) => ask({ action: 'request', email, ...(lang === undefined ? {} : { lang }) }, asked);
const complete = (token: unknown, password: unknown, asked: Asked = {}) => ask({ action: 'complete', token, password }, asked);

const refusal = async (response: Response | Promise<Response>) => {
  const answered = await response;
  return [answered.status, (await answered.json()).error];
};
/** The status and body of a reply, to hold two replies against each other. */
const answer = async (response: Response | Promise<Response>) => {
  const answered = await response;
  return [answered.status, await answered.json(), answered.headers.getSetCookie()];
};

/** The link an email carries, as its text version has it. */
const linkIn = (mail: Mail | undefined): string => /https?:\/\/\S+/.exec(mail?.text ?? '')?.[0] ?? '';
const tokenIn = (mail: Mail | undefined): string => new URL(linkIn(mail)).searchParams.get('reset') ?? '';
const stored = () => db.query<{ token_hash: string }>('SELECT token_hash FROM password_resets');

/** An account made the way the site makes one: the browser it was made in. */
async function signUp(username = 'neel', email = `${username}@example.com`): Promise<string> {
  const response = await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD, email } }), at(NOW));
  expect(response.status).toBe(201);
  return cookieFrom(response);
}

const me = async (cookie: string, now = NOW) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(now))).json()).data.account;
const signIn = (password: string, now = NOW, ip = '198.51.100.9') =>
  login(apiRequest('POST', '/api/account/login', { body: { username: 'neel', password }, ip }), at(now));

/** Asks for a link for neel and answers with the token it carries. */
async function tokenFor(email = EMAIL, asked: Asked = {}): Promise<string> {
  const before = sent.length;
  expect(await answer(request(email, asked))).toEqual([200, REQUESTED, []]);
  expect(sent).toHaveLength(before + 1);
  return tokenIn(sent.at(-1));
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  sent = [];
  refusing = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/account/reset', () => {
  it('refuses a request sent from another site, and one that asks for nothing known', async () => {
    await signUp();
    expect(await refusal(request(EMAIL, { headers: { origin: 'https://evil.example' } }))).toEqual([403, 'Request refused.']);
    for (const body of [{ action: 'promote' }, { email: EMAIL }, 'request', null]) {
      expect(await refusal(ask(body))).toEqual([400, 'That is not something that can be asked here.']);
    }
    expect(sent).toEqual([]);
  });
});

describe('asking for a reset link', () => {
  it('sends the account’s address one email, with a link that carries the token and is built on the site’s own address', async () => {
    await signUp();
    // whatever host the request names, the link is on the address the server is set up with
    const response = await request(EMAIL, { headers: { 'x-forwarded-host': 'evil.example', host: 'evil.example', origin: 'https://evil.example' } });
    expect(await answer(response)).toEqual([200, REQUESTED, []]);

    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail?.to).toBe(EMAIL);
    expect(mail?.subject).toBe('Reset your Wherefall password');
    expect(linkIn(mail)).toMatch(/^https:\/\/wherefall\.example\/\?reset=[A-Za-z0-9_-]{43}$/);
    expect(mail?.html).toContain(`href="${linkIn(mail)}"`);
    expect(mail?.html).toContain('your Wherefall account neel.');
    expect(mail?.html).toContain('<html lang="en">');
    expect(mail?.html).not.toContain('evil.example');
    expect(mail?.text).toContain('This link works once and expires in 1 hour.');
  });

  it('keeps only the hash of the token', async () => {
    await signUp();
    const token = await tokenFor();
    expect(await stored()).toEqual([{ token_hash: hashResetToken(token) }]);
    expect(JSON.stringify(await db.query('SELECT * FROM password_resets'))).not.toContain(token);
  });

  it('finds the account however the address is typed', async () => {
    await signUp();
    await tokenFor('  NEEL@Example.com ');
    expect(sent[0]?.to).toBe(EMAIL);
  });

  it('answers an address no account has exactly as it answers one that has, and sends nothing', async () => {
    await signUp();
    const known = await answer(request(EMAIL, { ip: '203.0.113.1' }));
    const unknown = await answer(request('nobody@example.com', { ip: '203.0.113.2' }));
    expect(unknown).toEqual(known);
    expect(unknown).toEqual([200, REQUESTED, []]);
    expect(sent.map((mail) => mail.to)).toEqual([EMAIL]);
    expect(await stored()).toHaveLength(1);
  });

  it.each([undefined, null, '', 'neel', 'neel@example', 42])('refuses %j as no address', async (email) => {
    await signUp();
    expect(await refusal(request(email))).toEqual([400, 'Enter a valid email address.']);
    expect(sent).toEqual([]);
  });

  it.each([
    ['es', 'Restablece tu contraseña de Wherefall'],
    ['fr', 'Réinitialisez votre mot de passe Wherefall'],
    ['de', 'Setze dein Wherefall-Passwort zurück'],
    ['ru', 'Сброс пароля Wherefall'],
  ])('writes the email in the language the page was in: %s', async (lang, subject) => {
    await signUp();
    await request(EMAIL, {}, lang);
    expect(sent[0]?.subject).toBe(subject);
    expect(sent[0]?.html).toContain(`<html lang="${lang}">`);
    expect(sent[0]?.html).toContain('neel');
    expect(linkIn(sent[0])).toMatch(/^https:\/\/wherefall\.example\/\?reset=[A-Za-z0-9_-]{43}$/);
  });

  it.each(['pt', 'EN', '', 42, null, { lang: 'fr' }])('writes it in English when the language is %j, which is none of the five', async (lang) => {
    await signUp();
    expect(await answer(request(EMAIL, {}, lang))).toEqual([200, REQUESTED, []]);
    expect(sent[0]?.subject).toBe('Reset your Wherefall password');
    expect(sent[0]?.html).toContain('<html lang="en">');
  });

  it('sends nothing to a deleted account, as signing in tells nobody without the password that it was there', async () => {
    const cookie = await signUp();
    expect((await accountPost(apiRequest('POST', '/api/account', { body: { action: 'delete', password: PASSWORD }, cookie }), at(NOW))).status).toBe(200);
    expect(await answer(request(EMAIL))).toEqual([200, REQUESTED, []]);
    expect(sent).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('sends a banned account its link, since a banned account can still sign in', async () => {
    await signUp();
    await db.query("UPDATE users SET banned = true WHERE username = 'neel'");
    await tokenFor();
  });

  it('sends nothing for an address that is only a guest’s name', async () => {
    await db.query("INSERT INTO users (id, username, password_hash, created_at, guest) VALUES ($1, 'Guest #4821', '', $2, true)", [randomUUID(), new Date(NOW).toISOString()]);
    expect(await answer(request('guest@example.com'))).toEqual([200, REQUESTED, []]);
    expect(sent).toEqual([]);
  });

  it('replaces the link sent before with the new one', async () => {
    await signUp();
    const first = await tokenFor(EMAIL, { ip: '203.0.113.1' });
    const second = await tokenFor(EMAIL, { ip: '203.0.113.2' });
    expect(second).not.toBe(first);
    expect(await stored()).toEqual([{ token_hash: hashResetToken(second) }]);
    expect(await refusal(complete(first, NEXT))).toEqual(BAD_LINK);
    expect((await complete(second, NEXT)).status).toBe(200);
  });

  it('takes five requests from one network in 15 minutes, then refuses until they are over', async () => {
    await signUp();
    const from = (now: number, ip = '203.0.113.7') => request(`someone${now}@example.com`, { now, ip });
    for (let index = 0; index < 5; index += 1) {
      expect((await from(NOW + index)).status).toBe(200);
    }
    expect(await refusal(from(NOW + 5))).toEqual(LOCKED);
    expect(await refusal(request(EMAIL, { now: NOW + 6, ip: '203.0.113.7' }))).toEqual(LOCKED);
    expect(sent).toEqual([]);
    expect((await from(NOW + 7, '203.0.113.8')).status).toBe(200);
    expect((await from(NOW + 15 * MINUTE)).status).toBe(200);
  });

  it('sends one address three emails an hour, and answers the fourth request the same without sending', async () => {
    await signUp();
    const from = (index: number, now = NOW) => answer(request(EMAIL, { now, ip: `203.0.113.${index}` }));
    for (let index = 0; index < 3; index += 1) {
      expect(await from(index)).toEqual([200, REQUESTED, []]);
    }
    expect(sent).toHaveLength(3);
    const kept = await stored();

    expect(await from(3)).toEqual([200, REQUESTED, []]);
    expect(await from(4, NOW + 59 * MINUTE)).toEqual([200, REQUESTED, []]);
    expect(sent).toHaveLength(3);
    // the link already sent still works: a request that sent nothing replaced nothing
    expect(await stored()).toEqual(kept);

    expect(await from(5, NOW + HOUR)).toEqual([200, REQUESTED, []]);
    expect(sent).toHaveLength(4);
  });

  it('counts an address no account has against the same limit, so the limit says nothing about it', async () => {
    const statuses: unknown[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push(await answer(request('nobody@example.com', { ip: `203.0.113.${index}` })));
    }
    expect(statuses.every((status) => JSON.stringify(status) === JSON.stringify([200, REQUESTED, []]))).toBe(true);
    expect(await db.query("SELECT key FROM rate_limits WHERE key LIKE '%nobody%'")).toEqual([]);
  });

  it('sends 50 reset emails a day across the whole site, then answers the same and sends none until the day is over', async () => {
    const CAP = 50;
    for (let index = 0; index <= CAP + 1; index += 1) {
      await insertUser(db, { id: randomUUID(), username: `player${index}`, passwordHash: 'not-a-real-hash', createdAt: NOW, email: `player${index}@example.com` });
    }
    const from = (index: number, now = NOW) => answer(request(`player${index}@example.com`, { now, ip: `198.51.${index}.1` }));
    for (let index = 0; index < CAP; index += 1) {
      expect(await from(index)).toEqual([200, REQUESTED, []]);
    }
    expect(sent).toHaveLength(CAP);

    expect(await from(CAP)).toEqual([200, REQUESTED, []]);
    expect(await from(CAP, NOW + 23 * HOUR)).toEqual([200, REQUESTED, []]);
    expect(sent).toHaveLength(CAP);

    expect(await from(CAP + 1, NOW + DAY)).toEqual([200, REQUESTED, []]);
    expect(sent).toHaveLength(CAP + 1);
    expect(sent.at(-1)?.to).toBe(`player${CAP + 1}@example.com`);
  });

  it('does not count an address no account has against the day, so strangers cannot use it up', async () => {
    await signUp();
    for (let index = 0; index < 60; index += 1) {
      await request(`nobody${index}@example.com`, { ip: `198.51.${index}.1` });
    }
    await tokenFor(EMAIL, { ip: '203.0.113.200' });
  });

  it('says the email could not be sent when Resend refuses it, logs why without the token, and leaves no link behind', async () => {
    await signUp();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refusing = new MailError(422);

    expect(await refusal(request(EMAIL))).toEqual([502, 'The email could not be sent. Try again later.']);
    expect(sent).toHaveLength(1);
    expect(await stored()).toEqual([]);

    const written = JSON.stringify(logged.mock.calls);
    expect(written).toContain('Resend refused the email (HTTP 422)');
    expect(written).not.toContain(tokenIn(sent[0]));
    expect(written).not.toContain(EMAIL);
  });

  it('says the same when Resend could not be reached', async () => {
    await signUp();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refusing = new TypeError('fetch failed');
    expect(await refusal(request(EMAIL))).toEqual([502, 'The email could not be sent. Try again later.']);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(tokenIn(sent[0]));
  });

  it('writes the link to the server log, and calls nothing, where no email can be sent', async () => {
    await signUp();
    const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await answer(request(EMAIL, { context: { sendMail: undefined } }))).toEqual([200, REQUESTED, []]);

    expect(sent).toEqual([]);
    const written = logged.mock.calls.map((call) => call.join(' ')).join('\n');
    const link = /https:\/\/wherefall\.example\/\?reset=[A-Za-z0-9_-]{43}/.exec(written)?.[0] ?? '';
    expect(link).not.toBe('');
    expect(written).toContain('neel');
    // and the link it wrote is one that works
    const token = new URL(link).searchParams.get('reset') ?? '';
    expect((await complete(token, NEXT)).status).toBe(200);
  });

  it('fails, rather than guess from the request, when it was not told the address of the site', async () => {
    await signUp();
    await expect(request(EMAIL, { context: { appUrl: undefined } })).rejects.toThrow('APP_URL');
    expect(sent).toEqual([]);
  });
});

describe('finishing a reset', () => {
  it('sets the new password, signs this browser in, and ends every session there was', async () => {
    const before = await signUp();
    const [{ recovery_hash: code } = { recovery_hash: null }] = await db.query<{ recovery_hash: string | null }>('SELECT recovery_hash FROM users');
    const token = await tokenFor();

    const response = await complete(token, NEXT, { now: NOW + MINUTE });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel' } });
    const [cookie = ''] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^__Host-plonk_account=account\./);
    expect(cookie.split('; ')).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']));

    // the browser that asked is in, as the account, with its email still there
    expect(await me(cookieFrom(response), NOW + MINUTE)).toMatchObject({ username: 'neel', email: EMAIL, hasRecoveryCode: true });
    // the browser that was signed in before is out
    expect(await me(before, NOW + MINUTE)).toBeNull();
    expect((await signIn(NEXT, NOW + MINUTE)).status).toBe(200);
    expect(await refusal(signIn(PASSWORD, NOW + MINUTE))).toEqual([401, 'Wrong username or password.']);
    // the recovery code is the one it was
    expect(await db.query('SELECT recovery_hash FROM users')).toEqual([{ recovery_hash: code }]);
    expect(await stored()).toEqual([]);
  });

  it('takes a link once', async () => {
    await signUp();
    const token = await tokenFor();
    expect((await complete(token, NEXT)).status).toBe(200);
    const again = await complete(token, 'yet another password');
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(await refusal(again)).toEqual(BAD_LINK);
    expect((await signIn(NEXT)).status).toBe(200);
  });

  it('takes a link for an hour and not after', async () => {
    await signUp();
    const late = await tokenFor(EMAIL, { ip: '203.0.113.1' });
    expect(await refusal(complete(late, NEXT, { now: NOW + HOUR }))).toEqual(BAD_LINK);
    const inTime = await tokenFor(EMAIL, { ip: '203.0.113.2' });
    expect((await complete(inTime, NEXT, { now: NOW + HOUR - 1 })).status).toBe(200);
  });

  it.each([undefined, null, '', 'not-a-token', 'a'.repeat(43), 42])('answers the token %j as it answers any link that cannot be used', async (token) => {
    await signUp();
    await tokenFor();
    const response = await complete(token, NEXT);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await refusal(response)).toEqual(BAD_LINK);
    expect((await signIn(PASSWORD)).status).toBe(200);
  });

  it.each([undefined, '', 'short', 'x'.repeat(201), 42])('says what a password is when the new one is %j, and leaves the link good', async (password) => {
    await signUp();
    const token = await tokenFor();
    expect(await refusal(complete(token, password))).toEqual(NEW_PASSWORD_RULE);
    expect(await stored()).toHaveLength(1);
    expect((await complete(token, NEXT)).status).toBe(200);
  });

  it('does nothing for an account deleted since the link was sent', async () => {
    const cookie = await signUp();
    const token = await tokenFor();
    expect((await accountPost(apiRequest('POST', '/api/account', { body: { action: 'delete', password: PASSWORD }, cookie }), at(NOW))).status).toBe(200);
    expect(await refusal(complete(token, NEXT))).toEqual(BAD_LINK);
  });

  it(
    'takes ten tries from one network in 15 minutes, then refuses until they are over',
    async () => {
      await signUp();
      const token = await tokenFor();
      const ip = '203.0.113.7';
      for (let index = 0; index < 10; index += 1) {
        expect(await refusal(complete(`${'b'.repeat(42)}${index}`, NEXT, { ip }))).toEqual(BAD_LINK);
      }
      expect(await refusal(complete(token, NEXT, { ip }))).toEqual(LOCKED);
      expect((await complete(token, NEXT, { ip, now: NOW + 15 * MINUTE })).status).toBe(200);
    },
    MANY_ATTEMPTS_TIMEOUT_MS,
  );
});
