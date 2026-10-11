import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { ACCOUNT_TTL_MS, accountCookieName, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, cookieFrom, resetDb, testDb } from '../testing.js';
import { account, login, logout, register } from './account.js';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const PASSWORD = 'correct horse battery';
const DAY = 24 * 60 * MINUTE;
const SIGNED_OUT = { success: true, data: { account: null, guest: null, stats: null, recentGames: [] } };
const NO_DUELS = { wins: 0, losses: 0, ties: 0, winRate: 0, rank: null };
const NO_TEAMS = { wins: 0, losses: 0, ties: 0, winRate: 0 };
/** What an account is before it has played anything, the first time it is looked at. */
const NEW_ACCOUNT = {
  country: null,
  rating: 500,
  xp: 0,
  level: 1,
  league: 'Trekker',
  bestStreak: 0,
  bestCountry: 0,
  bestContinent: 0,
  loginStreak: 1,
  duels: NO_DUELS,
  teams: NO_TEAMS,
  moderator: false,
  banned: false,
  allowFriendRequests: true,
  hideChat: false,
  hideLastSeen: false,
  hasRecoveryCode: true,
  email: 'neel@example.com',
};
const USERNAME_RULE = 'Choose a username of 3 to 20 letters, numbers or single underscores, not starting or ending with one.';
// Every attempt hashes a password, which is slow on purpose, and these tests make dozens.
const MANY_ATTEMPTS_TIMEOUT_MS = 60_000;

let db: Db;

const at = (now: number, moderators?: readonly string[]): Context => ({ db, now, secret: TEST_SECRET, ...(moderators ? { moderators } : {}) });
const emailOf = (username: string): string => `${username.trim().toLowerCase()}@example.com`;
const credentials = (username = 'neel', password = PASSWORD) => ({ username, password, email: emailOf(username) });

async function signUp(username = 'neel'): Promise<string> {
  const response = await register(apiRequest('POST', '/api/account/register', { body: credentials(username) }), at(NOW));
  return cookieFrom(response);
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('register', () => {
  it('creates the account and signs the browser in', async () => {
    const response = await register(apiRequest('POST', '/api/account/register', { body: credentials(' Neel ') }), at(NOW));
    expect(response.status).toBe(201);
    // The recovery code, shown this once, is in recovery.test.ts.
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel', recoveryCode: expect.any(String) } });

    const [cookie = ''] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^__Host-plonk_account=account\./);
    expect(cookie.split('; ')).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']));

    const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response) }), at(NOW));
    expect((await me.json()).data.account).toEqual({ ...NEW_ACCOUNT, username: 'neel' });
  });

  it('leaves Secure off the cookie on localhost, where there is no https', async () => {
    const request = apiRequest('POST', '/api/account/register', {
      body: credentials(),
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    });
    const response = await register(request, at(NOW));
    const [cookie = ''] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^plonk_account=account\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');

    const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response), headers: { host: 'localhost:3000' } }), at(NOW));
    expect((await me.json()).data.account).toEqual({ ...NEW_ACCOUNT, username: 'neel' });
  });

  it('ignores a session under the unprefixed name on the live site, where a sibling subdomain could have planted it', async () => {
    const session = await signUp();
    const planted = session.replace('__Host-plonk_account=', 'plonk_account=');
    expect(planted).not.toBe(session);
    const response = await account(apiRequest('GET', '/api/account', { cookie: planted }), at(NOW));
    expect(await response.json()).toEqual(SIGNED_OUT);
  });

  it.each(['ab', 'x'.repeat(21), 'has space', 'dash-ed', '_neel', 'neel_', 'ne__el', 'shithead', 'holy_shit', 42])(
    'refuses the username %j and says what a username is',
    async (username) => {
      const response = await register(apiRequest('POST', '/api/account/register', { body: { username, password: PASSWORD } }), at(NOW));
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual({ success: false, error: USERNAME_RULE });
    },
  );

  it('takes single underscores inside a name, and a word that only contains a masked one', async () => {
    for (const username of ['a_b_c', 'scunthorpe_fc']) {
      expect((await register(apiRequest('POST', '/api/account/register', { body: credentials(username) }), at(NOW))).status).toBe(201);
    }
  });

  it.each([
    ['a short password', { username: 'neel', password: 'short' }],
    ['a missing password', { username: 'neel' }],
  ])('refuses %s and says what is needed', async (_name, body) => {
    const response = await register(apiRequest('POST', '/api/account/register', { body }), at(NOW));
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ success: false, error: 'Choose a password of at least 8 characters.' });
  });

  it('takes the country the browser guessed, and goes without one that is no country code', async () => {
    const countryOf = async (username: string, country: unknown) => {
      const response = await register(apiRequest('POST', '/api/account/register', { body: { ...credentials(username), country } }), at(NOW));
      expect(response.status).toBe(201);
      const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response) }), at(NOW));
      return (await me.json()).data.account.country;
    };
    expect(await countryOf('indian', 'IN')).toBe('IN');
    expect(await countryOf('nowhere', null)).toBeNull();
    expect(await countryOf('latin', 'es-419')).toBeNull();
    expect(await countryOf('lower', 'fr')).toBeNull();
  });

  it('refuses a username that is taken', async () => {
    await signUp('neel');
    const response = await register(apiRequest('POST', '/api/account/register', { body: credentials('NEEL', 'another password') }), at(NOW));
    expect(response.status).toBe(409);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect((await response.json()).error).toMatch(/taken/);
  });

  it('refuses a sign-up with no email, or one that is no address, once the name and the password would do', async () => {
    for (const email of [undefined, null, '', 'neel', 'neel@example', `${'a'.repeat(250)}@example.com`]) {
      const response = await register(apiRequest('POST', '/api/account/register', { body: { username: 'neel', password: PASSWORD, email } }), at(NOW));
      expect(response.status).toBe(400);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual({ success: false, error: 'Enter a valid email address.' });
    }
    expect(await db.query('SELECT id FROM users')).toEqual([]);
  });

  it('stores the email trimmed and in lower case, and shows it to the account itself', async () => {
    const body = { ...credentials(), email: '  Neel.S@Example.COM ' };
    const response = await register(apiRequest('POST', '/api/account/register', { body }), at(NOW));
    expect(response.status).toBe(201);
    expect(await db.query('SELECT email FROM users')).toEqual([{ email: 'neel.s@example.com' }]);
    const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response) }), at(NOW));
    expect((await me.json()).data.account.email).toBe('neel.s@example.com');
  });

  it('refuses an email that another account has, however it is typed, and says so', async () => {
    await signUp('neel');
    const body = { ...credentials('someone_else'), email: ' NEEL@example.com' };
    const response = await register(apiRequest('POST', '/api/account/register', { body }), at(NOW));
    expect(response.status).toBe(409);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ success: false, error: 'That email already has an account. Sign in, or use another address.' });
    expect(await db.query('SELECT username FROM users')).toEqual([{ username: 'neel' }]);
  });

  it('says the username is taken when both it and the email are', async () => {
    await signUp('neel');
    const response = await register(apiRequest('POST', '/api/account/register', { body: credentials('neel', 'another password') }), at(NOW));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: 'That username is taken. Choose another, or sign in.' });
  });

  it('refuses a moderator’s name as it does a taken one, whether or not anyone has it yet', async () => {
    const taken = { success: false, error: 'That username is taken. Choose another, or sign in.' };
    const moderators = ['keeper', 'not_registered_yet'];
    await signUp('keeper');
    for (const username of ['keeper', 'not_registered_yet', ' Not_Registered_Yet ']) {
      const response = await register(apiRequest('POST', '/api/account/register', { body: credentials(username) }), at(NOW, moderators));
      expect(response.status).toBe(409);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.json()).toEqual(taken);
    }
    expect(await db.query('SELECT username FROM users')).toEqual([{ username: 'keeper' }]);
    // A name that is on nobody's list is as free as ever.
    expect((await register(apiRequest('POST', '/api/account/register', { body: credentials('someone') }), at(NOW, moderators))).status).toBe(201);
  });

  it('refuses a request sent from another site', async () => {
    const request = apiRequest('POST', '/api/account/register', { body: credentials(), headers: { origin: 'https://evil.example' } });
    const response = await register(request, at(NOW));
    expect(response.status).toBe(403);
    expect(await db.query('SELECT id FROM users')).toEqual([]);
  });

  it('stops one network making accounts without end, then lets it try again an hour later', async () => {
    const attempt = (index: number, now: number, ip = '203.0.113.7') =>
      register(apiRequest('POST', '/api/account/register', { body: credentials(`player_${index}`), ip }), at(now));

    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push((await attempt(index, NOW)).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses[20]).toBe(429);

    expect((await attempt(100, NOW, '203.0.113.8')).status).toBe(201);
    expect((await attempt(101, NOW + 60 * MINUTE)).status).toBe(201);
  }, MANY_ATTEMPTS_TIMEOUT_MS);
});

describe('login', () => {
  beforeEach(async () => {
    await signUp('neel');
  });

  it('signs the browser in with the right password', async () => {
    const response = await login(apiRequest('POST', '/api/account/login', { body: credentials('Neel') }), at(NOW));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { username: 'neel' } });

    const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response) }), at(NOW));
    expect((await me.json()).data.account).toEqual({ ...NEW_ACCOUNT, username: 'neel' });
  });

  it('still signs in a name made before the username rules', async () => {
    await db.query("UPDATE users SET username = '_old__name_' WHERE username = 'neel'");
    const response = await login(apiRequest('POST', '/api/account/login', { body: credentials('_Old__Name_') }), at(NOW));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { username: '_old__name_' } });
  });

  it('answers a wrong password, an unknown username and a malformed request identically', async () => {
    const attempts = [credentials('neel', 'wrong password'), credentials('nobody'), { username: 'x' }, 'not an object'];
    const replies = [];
    for (const body of attempts) {
      const response = await login(apiRequest('POST', '/api/account/login', { body }), at(NOW));
      expect(response.headers.getSetCookie()).toEqual([]);
      replies.push({ status: response.status, body: await response.json() });
    }
    expect(new Set(replies.map((reply) => JSON.stringify(reply))).size).toBe(1);
    expect(replies[0]).toEqual({ status: 401, body: { success: false, error: 'Wrong username or password.' } });
  });

  it('refuses a request sent from another site', async () => {
    const request = apiRequest('POST', '/api/account/login', { body: credentials(), headers: { origin: 'https://evil.example' } });
    expect((await login(request, at(NOW))).status).toBe(403);
  });

  it('locks an address out after ten attempts, even with the right password, for fifteen minutes', async () => {
    const attempt = (password: string, now: number, ip = '203.0.113.7') =>
      login(apiRequest('POST', '/api/account/login', { body: credentials('neel', password), ip }), at(now));

    for (let index = 0; index < 10; index += 1) {
      expect((await attempt('wrong password', NOW)).status).toBe(401);
    }
    const locked = await attempt(PASSWORD, NOW);
    expect(locked.status).toBe(429);
    expect(locked.headers.getSetCookie()).toEqual([]);
    expect((await locked.json()).error).toMatch(/Too many attempts/);

    expect((await attempt(PASSWORD, NOW, '203.0.113.8')).status).toBe(200);
    expect((await attempt(PASSWORD, NOW + 15 * MINUTE)).status).toBe(200);
  }, MANY_ATTEMPTS_TIMEOUT_MS);

  it('slows guessing at one username from many addresses', async () => {
    const attempt = (index: number) =>
      login(apiRequest('POST', '/api/account/login', { body: credentials('neel', 'wrong password'), ip: `198.51.100.${index}` }), at(NOW));

    for (let index = 0; index < 30; index += 1) {
      expect((await attempt(index)).status).toBe(401);
    }
    expect((await attempt(31)).status).toBe(429);
  }, MANY_ATTEMPTS_TIMEOUT_MS);
});

describe('logout', () => {
  it('clears the session cookie', async () => {
    const cookie = await signUp();
    const response = await logout(apiRequest('POST', '/api/account/logout', { cookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { signedIn: false } });

    const [cleared = ''] = response.headers.getSetCookie();
    expect(cleared).toMatch(/^__Host-plonk_account=;/);
    expect(cleared).toContain('Max-Age=0');

    const me = await account(apiRequest('GET', '/api/account', { cookie: cookieFrom(response) }), at(NOW));
    expect(await me.json()).toEqual(SIGNED_OUT);
  });

  it('works when nobody is signed in', async () => {
    expect((await logout(apiRequest('POST', '/api/account/logout'))).status).toBe(200);
  });

  it('refuses a request sent from another site', async () => {
    const request = apiRequest('POST', '/api/account/logout', { headers: { origin: 'https://evil.example' } });
    const response = await logout(request);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('account', () => {
  it('says nobody is signed in when there is no session', async () => {
    const response = await account(apiRequest('GET', '/api/account'), at(NOW));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(SIGNED_OUT);
  });

  it('gives a new account its name, empty stats and no games', async () => {
    const cookie = await signUp();
    const response = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW));
    expect(await response.json()).toEqual({
      success: true,
      data: {
        account: { ...NEW_ACCOUNT, username: 'neel' },
        guest: null,
        stats: { gamesPlayed: 0, roundsPlayed: 0, averageRoundScore: 0, bestRoundScore: 0, perfectRounds: 0, bestGame: null, ratedGames: 0 },
        recentGames: [],
      },
    });
  });

  it('reports the rating with its league, the XP with its level, the best streak, and the ranked duels played', async () => {
    const cookie = await signUp();
    await db.query('UPDATE users SET rating = 1348, rated_games = 3, xp = 2300, best_streak = 12');
    const { data } = await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json();
    expect(data.account).toEqual({
      ...NEW_ACCOUNT,
      username: 'neel',
      rating: 1348,
      xp: 2300,
      level: 4,
      league: 'Nomad',
      bestStreak: 12,
      duels: { ...NO_DUELS, rank: 1 },
    });
    expect(data.stats.ratedGames).toBe(3);
  });

  it('treats a forged or expired session as signed out', async () => {
    const cookie = await signUp();
    const forged = await account(apiRequest('GET', '/api/account', { cookie: `${cookie}x` }), at(NOW));
    expect(await forged.json()).toEqual(SIGNED_OUT);

    const stillGood = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW + ACCOUNT_TTL_MS - 1));
    expect((await stillGood.json()).data.account).toEqual({ ...NEW_ACCOUNT, username: 'neel' });
    const expired = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW + ACCOUNT_TTL_MS));
    expect(await expired.json()).toEqual(SIGNED_OUT);
  });

  it('signs the browser out when its account no longer exists', async () => {
    const cookie = await signUp();
    await db.query('DELETE FROM users');
    const response = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW));
    expect(await response.json()).toEqual(SIGNED_OUT);
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-plonk_account=;.*Max-Age=0/);
  });

  it('reports the country, the best guesser scores and the settings', async () => {
    const cookie = await signUp();
    await db.query("UPDATE users SET country = 'IN', best_country = 7000, best_continent = 10000, allow_requests = false, hide_chat = true");
    const { data } = await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json();
    expect(data.account).toMatchObject({ country: 'IN', bestCountry: 7000, bestContinent: 10_000, allowFriendRequests: false, hideChat: true, hideLastSeen: false });
    await db.query('UPDATE users SET hide_last_seen = true');
    expect((await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json()).data.account.hideLastSeen).toBe(true);
  });

  it('tells a guest its name and nothing else', async () => {
    const guest = await createGuest(db, NOW);
    const cookie = `${accountCookieName(true)}=${createGuestSession(guest.userId, NOW, TEST_SECRET)}`;
    const response = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW));
    expect(await response.json()).toEqual({ success: true, data: { account: null, guest: guest.username, stats: null, recentGames: [] } });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.query('SELECT login_streak, login_day FROM users')).toEqual([{ login_streak: 0, login_day: null }]);

    await db.query('DELETE FROM users');
    const gone = await account(apiRequest('GET', '/api/account', { cookie }), at(NOW));
    expect(await gone.json()).toEqual(SIGNED_OUT);
    expect(gone.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
  });
});

describe('the login streak', () => {
  const streakAt = async (cookie: string, now: number, on: Db = db) =>
    (await (await account(apiRequest('GET', '/api/account', { cookie }), { ...at(now), db: on })).json()).data.account.loginStreak;
  // 08:00 UTC, so sixteen hours on is the next day.
  const MIDNIGHT = NOW + 16 * 60 * MINUTE;

  it('starts at one, and counts each UTC day in a row the account is looked at', async () => {
    const cookie = await signUp();
    expect(await streakAt(cookie, NOW)).toBe(1);
    expect(await streakAt(cookie, MIDNIGHT - 1)).toBe(1);
    expect(await streakAt(cookie, MIDNIGHT)).toBe(2);
    expect(await streakAt(cookie, MIDNIGHT + DAY)).toBe(3);
  });

  it('starts again at one after a day is missed', async () => {
    const cookie = await signUp();
    await streakAt(cookie, NOW);
    await streakAt(cookie, NOW + DAY);
    expect(await streakAt(cookie, NOW + 3 * DAY)).toBe(1);
    expect(await streakAt(cookie, NOW + 4 * DAY)).toBe(2);
  });

  it('writes once a day: later calls that day change nothing', async () => {
    const cookie = await signUp();
    const written: number[] = [];
    const watching: Db = {
      query: async <T>(sql: string, params?: unknown[]) => {
        const rows = await db.query<T>(sql, params);
        if (/^\s*UPDATE/.test(sql)) {
          written.push(rows.length);
        }
        return rows;
      },
      transaction: db.transaction,
    };
    await streakAt(cookie, NOW, watching);
    await streakAt(cookie, NOW + MINUTE, watching);
    await streakAt(cookie, NOW + 2 * MINUTE, watching);
    expect(written).toEqual([1, 0, 0]);
  });

  it('counts a day once when its first two calls arrive together', async () => {
    const cookie = await signUp();
    await streakAt(cookie, NOW);
    expect(await Promise.all([streakAt(cookie, NOW + DAY), streakAt(cookie, NOW + DAY)])).toEqual([2, 2]);
    expect(await db.query('SELECT login_streak FROM users')).toEqual([{ login_streak: 2 }]);
  });
});

describe('the duel record', () => {
  const duelsOf = async (cookie: string) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json()).data.account.duels;

  it('counts wins, losses and ties, with the share won as a whole percent', async () => {
    const cookie = await signUp();
    await db.query('UPDATE users SET duel_wins = 2, duel_losses = 3, duel_ties = 1');
    expect(await duelsOf(cookie)).toEqual({ wins: 2, losses: 3, ties: 1, winRate: 33, rank: null });
  });

  it('gives the place on the rating board, and none to an account that is not on it', async () => {
    const cookie = await signUp('neel');
    const other = await signUp('other');
    const banned = await signUp('banned');
    await db.query("UPDATE users SET rating = 900, rated_games = 5 WHERE username = 'other'");
    await db.query("UPDATE users SET rating = 950, rated_games = 5, banned = true WHERE username = 'banned'");
    expect((await duelsOf(cookie)).rank).toBeNull();

    await db.query("UPDATE users SET rating = 700, rated_games = 2 WHERE username = 'neel'");
    expect((await duelsOf(cookie)).rank).toBe(2);
    expect((await duelsOf(other)).rank).toBe(1);
    expect((await duelsOf(banned)).rank).toBeNull();
  });
});

describe('the 2v2 record', () => {
  const teamsOf = async (cookie: string) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json()).data.account.teams;

  it('counts wins, losses and ties beside the duels, with the share won as a whole percent of them all', async () => {
    const cookie = await signUp();
    expect(await teamsOf(cookie)).toEqual(NO_TEAMS);
    await db.query('UPDATE users SET team_wins = 2, team_losses = 3, team_ties = 1, duel_wins = 9');
    expect(await teamsOf(cookie)).toEqual({ wins: 2, losses: 3, ties: 1, winRate: 33 });
    await db.query('UPDATE users SET team_wins = 0, team_losses = 0, team_ties = 4');
    expect(await teamsOf(cookie)).toEqual({ wins: 0, losses: 0, ties: 4, winRate: 0 });
  });
});
