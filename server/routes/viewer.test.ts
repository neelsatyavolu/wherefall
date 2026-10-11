import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_ORIGIN, TEST_SECRET, apiRequest, pausingAfter, resetDb, testDb } from '../testing.js';
import { dailyPost as viewer } from './daily.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let db: Db;

interface Ask {
  now?: number;
  /** Null is a server with no limit set. */
  limit?: number | null;
  ip?: string;
  on?: Db;
  body?: unknown;
  /** Left out, the asker is a visitor. */
  cookie?: string;
}

const context = (now: number, limit: number | null, on: Db): Context => ({ db: on, now, secret: TEST_SECRET, ...(limit === null ? {} : { viewersPerDay: limit }) });
/** Asks for a viewer. Each call comes from its own address unless one is given, so the per-address limits stay out of the way. */
let caller = 0;
const ask = ({ now = NOW, limit = 3, ip, on = db, body = { action: 'viewer' }, cookie }: Ask = {}) => {
  caller += 1;
  return viewer(apiRequest('POST', '/api/daily', { body, cookie, ip: ip ?? `10.1.${Math.floor(caller / 250)}.${caller % 250}` }), context(now, limit, on));
};
const answer = async (response: Response | Promise<Response>) => (await (await response).json()).data;

let accounts = 0;
/** The session cookie of a new account. */
async function account(): Promise<string> {
  const id = randomUUID();
  accounts += 1;
  await insertUser(db, { id, username: `player${accounts}`, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

async function guest(): Promise<string> {
  const made = await createGuest(db, NOW);
  return `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`;
}

const usedToday = () => db.query('SELECT day, used FROM viewer_days ORDER BY day');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  caller = 0;
  accounts = 0;
});

describe('POST /api/daily { action: "viewer" }', () => {
  it('needs no session, and says there is a Google viewer to be had while the day has some left', async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: { google: true, usedToday: 1, limit: 3 } });
  });

  it('counts each viewer it gives an account, and says no once the day’s limit is reached', async () => {
    const cookie = await account();
    expect(await answer(ask({ cookie }))).toEqual({ google: true, usedToday: 1, limit: 3 });
    expect(await answer(ask({ cookie }))).toEqual({ google: true, usedToday: 2, limit: 3 });
    expect(await answer(ask({ cookie }))).toEqual({ google: true, usedToday: 3, limit: 3 });
    expect(await answer(ask({ cookie }))).toEqual({ google: false, usedToday: 3, limit: 3 });
    expect(await answer(ask({ cookie }))).toEqual({ google: false, usedToday: 3, limit: 3 });
    // A request that got none is not counted.
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 3 }]);
  });

  it('starts a new count at midnight UTC', async () => {
    const lastMoment = Date.UTC(2027, 0, 15, 23, 59, 59, 999);
    const cookie = await account();
    for (let index = 0; index < 4; index += 1) {
      await ask({ now: lastMoment, cookie });
    }
    expect(await answer(ask({ now: lastMoment, cookie }))).toMatchObject({ google: false });
    expect(await answer(ask({ now: lastMoment + 1, cookie }))).toEqual({ google: true, usedToday: 1, limit: 3 });
    expect(await usedToday()).toEqual([
      { day: '2027-01-15', used: 3 },
      { day: '2027-01-16', used: 1 },
    ]);
  });

  it('hands out 150 a day when no limit is set', async () => {
    const cookie = await account();
    expect(await answer(ask({ limit: null, cookie }))).toEqual({ google: true, usedToday: 1, limit: 150 });
    await db.query('UPDATE viewer_days SET used = 149');
    expect(await answer(ask({ limit: null, cookie }))).toEqual({ google: true, usedToday: 150, limit: 150 });
    expect(await answer(ask({ limit: null, cookie }))).toEqual({ google: false, usedToday: 150, limit: 150 });
  });

  it('hands out none when the limit is 0, to an account or to anyone', async () => {
    expect(await answer(ask({ limit: 0 }))).toEqual({ google: false, usedToday: 0, limit: 0 });
    expect(await answer(ask({ limit: 0, cookie: await account() }))).toEqual({ google: false, usedToday: 0, limit: 0 });
    expect(await usedToday()).toEqual([]);
  });

  it('gives the last viewer of the day to exactly one of two requests that arrive together', async () => {
    const cookie = await account();
    await ask({ cookie });
    await ask({ cookie });
    const slow = pausingAfter(db, /viewer_days/);
    const answers = await Promise.all([answer(ask({ on: slow, cookie })), answer(ask({ on: slow, cookie }))]);
    expect(answers.map((reply) => reply.google).sort()).toEqual([false, true]);
    expect(answers.every((reply) => reply.usedToday === 3 && reply.limit === 3)).toBe(true);
  });

  it('gives out exactly the limit, however many accounts ask at once', async () => {
    const cookie = await account();
    const answers = await Promise.all(Array.from({ length: 40 }, () => answer(ask({ limit: 25, cookie }))));
    expect(answers.filter((reply) => reply.google)).toHaveLength(25);
    expect(answers.filter((reply) => reply.google).map((reply) => reply.usedToday).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_unused, index) => index + 1));
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 25 }]);
  });

  it('counts in one statement', async () => {
    const asked: string[] = [];
    const watching: Db = {
      query: (sql, params) => {
        asked.push(sql);
        return db.query(sql, params);
      },
      transaction: db.transaction,
    };
    await ask({ on: watching });
    expect(asked.filter((sql) => sql.includes('viewer_days'))).toHaveLength(1);
    // The other two are the limits on how often one address may ask: in an hour, and in a day.
    expect(asked).toHaveLength(3);
  });

  it('lets one address ask 240 times an hour, which is a class playing game after game, and refuses it after that', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 241; index += 1) {
      statuses.push((await ask({ ip: '203.0.113.7', limit: 1000 })).status);
    }
    expect(statuses).toEqual([...Array.from({ length: 240 }, () => 200), 429]);
    const refused = await ask({ ip: '203.0.113.7', limit: 1000 });
    expect(await refused.json()).toEqual({ success: false, error: 'Too many games started from this network in the last hour. Try again later.' });

    expect((await ask({ ip: '203.0.113.8', limit: 1000 })).status).toBe(200);
    expect((await ask({ ip: '203.0.113.7', limit: 1000, now: NOW + HOUR })).status).toBe(200);
  });

  it.each([
    ['another action', { action: 'reset' }],
    ['no action', {}],
    ['something that is not an object', 'viewer'],
  ])('refuses %s, counting nothing', async (_name, body) => {
    const response = await ask({ body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'That is not something that can be asked here.' });
    expect(await usedToday()).toEqual([]);
  });

  it('refuses a request sent from another site, counting nothing', async () => {
    const request = apiRequest('POST', '/api/daily', { body: { action: 'viewer' }, headers: { origin: 'https://evil.example' } });
    expect((await viewer(request, context(NOW, 3, db))).status).toBe(403);
    expect(await usedToday()).toEqual([]);
  });
});

describe('one address in one day', () => {
  it('gets forty viewers, enough for a class behind one address, however many hours it asks over', async () => {
    const start = Date.UTC(2027, 0, 15, 0, 0, 1);
    const answers = [];
    for (let hour = 0; hour < 5; hour += 1) {
      for (let index = 0; index < 30; index += 1) {
        answers.push(await answer(ask({ ip: '198.51.100.9', limit: 150, now: start + hour * HOUR + hour * 1000 })));
      }
    }
    expect(answers.slice(0, 40).every((reply) => reply.google)).toBe(true);
    expect(answers.filter((reply) => reply.google)).toHaveLength(40);
    expect(answers.slice(40).every((reply) => reply.google === false && reply.usedToday === 40 && reply.limit === 150)).toBe(true);
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 40 }]);
    expect(await answer(ask({ ip: '203.0.113.77', limit: 150, now: start + 5 * HOUR }))).toEqual({ google: true, usedToday: 41, limit: 150 });
  });

  it('gets its forty again the next day, from midnight UTC', async () => {
    const lastMoment = Date.UTC(2027, 0, 15, 23, 59, 59, 999);
    for (let index = 0; index < 42; index += 1) {
      await ask({ ip: '198.51.100.9', limit: 150, now: lastMoment - HOUR });
    }
    expect(await answer(ask({ ip: '198.51.100.9', limit: 150, now: lastMoment }))).toMatchObject({ google: false, usedToday: 40 });
    expect(await answer(ask({ ip: '198.51.100.9', limit: 150, now: lastMoment + 1 }))).toMatchObject({ google: true, usedToday: 1 });
    expect(await answer(ask({ ip: '198.51.100.9', limit: 150, now: lastMoment + 1 + DAY }))).toMatchObject({ google: true, usedToday: 1 });
  });

  it('gets forty whoever asks from it: accounts behind one address share them', async () => {
    const [first, second] = [await account(), await account()];
    const answers = [];
    for (let index = 0; index < 42; index += 1) {
      answers.push(await answer(ask({ ip: '198.51.100.9', limit: 150, cookie: index % 2 === 0 ? first : second })));
    }
    expect(answers.map((reply) => reply.google)).toEqual([...Array.from({ length: 40 }, () => true), false, false]);
    expect(await answer(ask({ ip: '198.51.100.10', limit: 150, cookie: first }))).toMatchObject({ google: true, usedToday: 41 });
  });

  it('gets exactly forty when its requests arrive together', async () => {
    const answers = await Promise.all(Array.from({ length: 55 }, () => answer(ask({ ip: '198.51.100.9', limit: 150 }))));
    expect(answers.filter((reply) => reply.google)).toHaveLength(40);
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 40 }]);
  });

  it('cannot use up the day by asking with no session and no Origin, as a script does', async () => {
    const script = (ip: string) =>
      viewer(
        new Request(`${TEST_ORIGIN}/api/daily`, {
          method: 'POST',
          headers: { host: new URL(TEST_ORIGIN).host, 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ action: 'viewer' }),
        }),
        context(NOW, 150, db),
      );
    for (let address = 1; address <= 5; address += 1) {
      for (let index = 0; index < 30; index += 1) {
        await script(`198.51.100.${address}`);
      }
    }
    // Five addresses asking 30 times each get no further than the two thirds that visitors may have between them...
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 100 }]);
    expect(await answer(ask({ ip: '203.0.113.77', limit: 150 }))).toEqual({ google: false, usedToday: 100, limit: 150 });
    // ...and the last third is still there for a signed-in account.
    expect(await answer(ask({ ip: '203.0.113.77', limit: 150, cookie: await account() }))).toEqual({ google: true, usedToday: 101, limit: 150 });
  });
});

describe('the last third of the day’s viewers', () => {
  it('is kept for accounts: a visitor and a guest are told no once two thirds are used', async () => {
    await db.query(`INSERT INTO viewer_days (day, used) VALUES ('2027-01-15', 99)`);
    expect(await answer(ask({ limit: 150 }))).toEqual({ google: true, usedToday: 100, limit: 150 });
    expect(await answer(ask({ limit: 150 }))).toEqual({ google: false, usedToday: 100, limit: 150 });
    expect(await answer(ask({ limit: 150, cookie: await guest() }))).toEqual({ google: false, usedToday: 100, limit: 150 });
    expect(await answer(ask({ limit: 150, cookie: await account() }))).toEqual({ google: true, usedToday: 101, limit: 150 });
    // Asking did not use any of what is kept.
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 101 }]);
  });

  it('is what is left of a limit that does not divide by three', async () => {
    // Two thirds of 10, rounded down, is 6.
    const answers = [];
    for (let index = 0; index < 8; index += 1) {
      answers.push((await answer(ask({ limit: 10 }))).google);
    }
    expect(answers).toEqual([true, true, true, true, true, true, false, false]);
    const cookie = await account();
    for (let index = 0; index < 4; index += 1) {
      expect(await answer(ask({ limit: 10, cookie }))).toMatchObject({ google: true, usedToday: 7 + index });
    }
    expect(await answer(ask({ limit: 10, cookie }))).toEqual({ google: false, usedToday: 10, limit: 10 });
  });

  it('cannot be taken by visitors, however many addresses they ask from at once', async () => {
    const answers = await Promise.all(Array.from({ length: 140 }, () => answer(ask({ limit: 150 }))));
    expect(answers.filter((reply) => reply.google)).toHaveLength(100);
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 100 }]);
    expect(await answer(ask({ limit: 150, cookie: await account() }))).toEqual({ google: true, usedToday: 101, limit: 150 });
  });

  it('is not for a session that has ended, or one that is forged', async () => {
    await db.query(`INSERT INTO viewer_days (day, used) VALUES ('2027-01-15', 100)`);
    const cookie = await account();
    expect(await answer(ask({ limit: 150, cookie: `${cookie}x` }))).toMatchObject({ google: false });
    await db.query('UPDATE users SET session_version = session_version + 1');
    expect(await answer(ask({ limit: 150, cookie }))).toMatchObject({ google: false });
    expect(await usedToday()).toEqual([{ day: '2027-01-15', used: 100 }]);
  });
});
