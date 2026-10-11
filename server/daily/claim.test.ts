import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { runToken } from '../games/runs.js';
import { dailyPlaces, dailyRounds, placesOn, roundOn } from '../games/testing.js';
import type { KnownPlace } from '../places/lists.js';
import { account } from '../routes/account.js';
import { daily, dailyPost } from '../routes/daily.js';
import { saveGame } from '../routes/games.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, testDb } from '../testing.js';
import { visitorStartDay, visitorStartToken } from './token.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const TODAY = '2027-01-15';
const SEED = 'daily20270115';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
const TOO_LATE = 'Results can only be claimed on the day an account is made.';
/** How long after it is begun a daily can first be finished. */
const PLAYED_IN = 6_000;

let db: Db;
let neel: string;

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

async function signUp(username: string, createdAt = NOW): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt });
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

async function guest(): Promise<string> {
  const made = await createGuest(db, NOW);
  return `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`;
}

/** The day `ago` days before today, and the seed of its daily. */
const day = (ago: number): string => new Date(NOW - ago * DAY).toISOString().slice(0, 10);
const seedOf = (date: string): string => `daily${date.replaceAll('-', '')}`;

/** The three rounds of a day's daily, on that day's own places, that score what is asked: one figure is the first round's, the others then scoring nothing. */
const rounds = (scores: number | number[], date = TODAY) => dailyRounds(date, typeof scores === 'number' ? [scores, 0, 0] : scores);
/** A round on a place with the guess on the far side of the world from it, claiming whatever the browser likes. */
const farOff = (place: KnownPlace, claims: Record<string, unknown> = {}) => ({
  ...roundOn(place, 0),
  guessLng: place.lng > 0 ? place.lng - 180 : place.lng + 180,
  guessLat: -place.lat,
  ...claims,
});

/** A finished daily challenge whose three rounds add up to `score`. */
const dailyGame = (scores: number | number[], change: Record<string, unknown> = {}) => ({
  map: 'world',
  mode: 'move',
  timeLimit: 60,
  seed: SEED,
  rounds: rounds(scores),
  daily: TODAY,
  ...change,
});

/** A daily result as it was stored on an earlier day, written straight into the table. */
async function played(username: string, date: string, score: number, maxScore = 15_000): Promise<void> {
  await db.query(
    `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at, daily)
     SELECT $1, id, 'world', 'move', 60, $2, 3, $3, $4, $5::timestamptz, $6 FROM users WHERE username = $7`,
    [randomUUID(), seedOf(date), score, maxScore, `${date}T12:00:00.000Z`, date, username],
  );
}

const save = (body: unknown, cookie = neel, now = NOW, on: Db = db) => saveGame(apiRequest('POST', '/api/games', { body, cookie }), at(now, on));
const today = async (cookie?: string, now = NOW, query = '') => (await (await daily(apiRequest('GET', `/api/daily${query}`, { cookie }), at(now))).json()).data;
/** A null cookie is a visitor. */
const post = (body: unknown, cookie: string | null = neel, now = NOW, on: Db = db) =>
  dailyPost(apiRequest('POST', '/api/daily', { body, cookie: cookie ?? undefined }), at(now, on));
const start = (cookie: string | null = neel, now = NOW) => post({ action: 'start' }, cookie, now);
/** Begins today's daily and saves a result for it as soon as it could have been played. */
async function play(body: unknown, cookie = neel, now = NOW, on: Db = db): Promise<Response> {
  await start(cookie, now - PLAYED_IN);
  return save(body, cookie, now, on);
}
const claim = (results: unknown, cookie: string | null = neel, now = NOW, on: Db = db) => post({ action: 'claim', results }, cookie, now, on);
/** What a visitor's start at noon on a day was answered with. */
const tokenOf = (date: string): string => visitorStartToken(Date.parse(`${date}T12:00:00Z`), TEST_SECRET);
/** A result as a visitor's browser kept it: the day, the token its start was answered with, and the rounds on that day's places. */
const result = (date: string, scores: number | number[] = 1000) => ({ daily: date, token: tokenOf(date), rounds: rounds(scores, date) });
const data = async (response: Response | Promise<Response>) => (await (await response).json()).data;
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};
const xpOf = async (cookie = neel, now = NOW) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(now))).json()).data.account.xp;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = await signUp('neel');
});

describe('POST /api/daily { action: "start" } with no account', () => {
  const visit = (ip: string, now = NOW, cookie?: string) => dailyPost(apiRequest('POST', '/api/daily', { body: { action: 'start' }, ip, cookie }), at(now));

  it('is refused: a visitor is told to sign in, a guest to make an account, and nothing is marked', async () => {
    expect(await refusal(visit('203.0.113.5'))).toEqual([401, 'Sign in first.']);
    expect(await refusal(visit('203.0.113.5', NOW, await guest()))).toEqual([403, GUESTS_CANNOT]);
    expect(await db.query('SELECT day FROM daily_attempts')).toEqual([]);
    expect(await db.query('SELECT 1 FROM rate_limits')).toEqual([]);
  });

  it('is refused for a browser whose session has ended, and for one whose account is gone', async () => {
    await db.query(`UPDATE users SET session_version = session_version + 1 WHERE username = 'neel'`);
    expect(await refusal(visit('203.0.113.5', NOW, neel))).toEqual([401, 'Sign in first.']);
    await db.query(`DELETE FROM users WHERE username = 'neel'`);
    expect(await refusal(visit('203.0.113.5', NOW, neel))).toEqual([401, 'Sign in first.']);
    expect(await db.query('SELECT day FROM daily_attempts')).toEqual([]);
  });
});

// Starts were answered with these while a visitor could play. One kept in a browser can still be claimed.
describe("the token a visitor's start was answered with", () => {
  it('says which day the start was on, by UTC', () => {
    const lastMoment = Date.UTC(2027, 0, 15, 23, 59, 59, 999);
    expect(visitorStartDay(visitorStartToken(lastMoment, TEST_SECRET), TEST_SECRET)).toBe(TODAY);
    expect(visitorStartDay(visitorStartToken(lastMoment + 1, TEST_SECRET), TEST_SECRET)).toBe('2027-01-16');
  });

  it('is one nothing else can be made from or passed off as', async () => {
    const token = visitorStartToken(NOW, TEST_SECRET);
    expect(visitorStartDay(`${token}x`, TEST_SECRET)).toBeNull();
    expect(visitorStartDay(token, Buffer.alloc(32, 9))).toBeNull();
    expect(visitorStartDay(createAccountSession(randomUUID(), NOW, TEST_SECRET), TEST_SECRET)).toBeNull();
    expect(visitorStartDay(runToken(randomUUID(), 'streak', NOW, TEST_SECRET), TEST_SECRET)).toBeNull();
    // Nor is it anyone's session.
    expect(await today(`${accountCookieName(true)}=${token}`)).toMatchObject({ state: 'open', records: null });
  });
});

describe('POST /api/daily { action: "claim" }', () => {
  it("saves a visitor's stored results to the account they have just made, scored by the server, and says which days it took", async () => {
    const response = await claim([result(day(2), [5000, 1000, 0]), result(day(1), 2500)], neel, NOW + HOUR);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { claimed: [day(2), day(1)] } });
    expect(await db.query('SELECT daily, seed, map, mode, time_limit, rounds, score, max_score, xp_earned FROM games ORDER BY daily')).toEqual([
      { daily: day(2), seed: seedOf(day(2)), map: 'world', mode: 'move', time_limit: 60, rounds: 3, score: 6000, max_score: 15_000, xp_earned: 120 },
      { daily: day(1), seed: seedOf(day(1)), map: 'world', mode: 'move', time_limit: 60, rounds: 3, score: 2500, max_score: 15_000, xp_earned: 50 },
    ]);
    expect(await xpOf()).toBe(170);
    const seen = await today(neel, NOW + HOUR);
    expect(seen).toMatchObject({ state: 'open', streak: { current: 2, best: 2, atRisk: true }, records: { played: 2, best: 6000, average: 4250 } });
    expect(seen.history.slice(-3)).toEqual([
      { date: day(2), score: 6000 },
      { date: day(1), score: 2500 },
      { date: TODAY, score: null },
    ]);
  });

  it("takes today's result too, which is then the account's one attempt", async () => {
    expect(await data(claim([result(TODAY, 3000)]))).toEqual({ claimed: [TODAY] });
    expect(await today(neel)).toMatchObject({
      state: 'done',
      yours: { score: 3000, rounds: [3000, 0, 0], rank: 1 },
      leaderboard: { entries: [{ rank: 1, username: 'neel', score: 3000 }] },
    });
    // The account never began today's daily, and need not have: it has its result.
    const again = await save(dailyGame(5000));
    expect(again.status).toBe(200);
    expect((await again.json()).data.score).toBe(3000);
    expect(await data(start())).toEqual({ state: 'done', token: null });
  });

  it('scores each round itself, whatever the browser kept', async () => {
    const madeUp = dailyPlaces(day(1)).map((place) => farOff(place, { country: 'FR', distanceKm: 0, score: 5000 }));
    expect(await data(claim([{ daily: day(1), token: tokenOf(day(1)), rounds: madeUp }]))).toEqual({ claimed: [day(1)] });
    expect(await db.query('SELECT score, xp_earned FROM games')).toEqual([{ score: 0, xp_earned: 0 }]);
  });

  it('pays a claimed result as far as the day’s cap on solo XP allows', async () => {
    await db.query(`UPDATE users SET xp = 19950, solo_xp = 19950, solo_xp_day = $1 WHERE username = 'neel'`, [TODAY]);
    expect(await data(claim([result(day(2), 5000), result(day(1), 5000)]))).toEqual({ claimed: [day(2), day(1)] });
    expect(await db.query('SELECT xp_earned FROM games ORDER BY daily')).toEqual([{ xp_earned: 50 }, { xp_earned: 0 }]);
    expect(await xpOf()).toBe(20_000);
  });

  it('skips a day the account has already played, and the second of two results for one day', async () => {
    await played('neel', day(3), 111);
    await play(dailyGame(222));
    const claimed = await data(claim([result(day(3), 5000), result(TODAY, 5000), result(day(1), 1000), result(day(1), 4000)]));
    expect(claimed).toEqual({ claimed: [day(1)] });
    expect(await db.query('SELECT daily, score FROM games ORDER BY daily')).toEqual([
      { daily: day(3), score: 111 },
      { daily: day(1), score: 1000 },
      { daily: TODAY, score: 222 },
    ]);
  });

  it.each([
    ['a day more than 14 days ago', result(day(15))],
    ['a day to come', result(day(-1))],
    ['a day that is not one', result('2027-01-32')],
    ['a date in another shape', result('15 January')],
    ['two rounds', { ...result(day(1)), rounds: rounds(1000, day(1)).slice(0, 2) }],
    ['five rounds', { ...result(day(1)), rounds: [...rounds(1000, day(1)), ...placesOn('world', 2).map((place) => roundOn(place, 0))] }],
    ['a round that names no place', { ...result(day(1)), rounds: [{ country: 'FR', distanceKm: 3, score: 4990 }, ...rounds(0, day(1)).slice(0, 2)] }],
    ['a round that is not one', { ...result(day(1)), rounds: ['a', 'b', 'c'] }],
    ['no rounds', { daily: day(1), token: tokenOf(day(1)) }],
    ['something that is not a result', 'yesterday'],
    ['a result with no token, as a browser kept it before tokens', { daily: day(1), rounds: rounds(1000, day(1)) }],
    ['a token that is not text', { ...result(day(1)), token: 7 }],
    ['a token from a start on another day', { ...result(day(1)), token: tokenOf(day(3)) }],
    ['a token from a start on the day after', { ...result(day(1)), token: tokenOf(TODAY) }],
    ['a token that was changed', { ...result(day(1)), token: `${tokenOf(day(1))}x` }],
    ['a token signed with another key', { ...result(day(1)), token: visitorStartToken(NOW - DAY, Buffer.alloc(32, 9)) }],
    ['the token of a run in place of a start’s', { ...result(day(1)), token: runToken(randomUUID(), 'streak', NOW - DAY, TEST_SECRET) }],
    ['a session in place of a token', { ...result(day(1)), token: createAccountSession(randomUUID(), NOW - DAY, TEST_SECRET) }],
    ['the places of another day', { ...result(day(1)), rounds: rounds(1000, day(3)) }],
    ['places that are no day’s', { ...result(day(1)), rounds: placesOn('country:FR', 3).map((place) => roundOn(place, 5000)) }],
    ['a place that is in no list', { ...result(day(1)), rounds: [{ id: 'nowhere', lng: 1, lat: 1, guessLng: 1, guessLat: 1 }, ...rounds(0, day(1)).slice(1)] }],
    ['a place said to be somewhere it is not', { ...result(day(1)), rounds: rounds(1000, day(1)).map((round) => ({ ...round, lng: 1, lat: 1 })) }],
    ['one of the day’s places twice', { ...result(day(1)), rounds: [...rounds(1000, day(1)).slice(0, 2), rounds(1000, day(1))[0]] }],
  ])('skips %s, and takes the rest', async (_name, skipped) => {
    expect(await data(claim([skipped, result(day(2), 700)]))).toEqual({ claimed: [day(2)] });
    expect(await db.query('SELECT daily, score FROM games')).toEqual([{ daily: day(2), score: 700 }]);
  });

  it('takes a day exactly 14 days ago', async () => {
    expect(await data(claim([result(day(14))]))).toEqual({ claimed: [day(14)] });
  });

  it('takes a result on the places the day’s seed draws from the other list', async () => {
    const other = { daily: day(1), token: tokenOf(day(1)), rounds: dailyRounds(day(1), [1200, 0, 0], 1) };
    expect(await data(claim([other]))).toEqual({ claimed: [day(1)] });
    expect(await db.query('SELECT score FROM games')).toEqual([{ score: 1200 }]);
  });

  it('answers with no days when none could be taken', async () => {
    const response = await claim([result(day(40))]);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ claimed: [] });
  });

  it('is only for the first 24 hours of an account', async () => {
    expect(await data(claim([result(day(2))], neel, NOW + DAY))).toEqual({ claimed: [day(2)] });
    expect(await refusal(claim([result(day(1))], neel, NOW + DAY + 1))).toEqual([403, TOO_LATE]);
    const old = await signUp('old', NOW - 2 * DAY);
    expect(await refusal(claim([result(day(1))], old))).toEqual([403, TOO_LATE]);
    expect(await db.query('SELECT daily FROM games')).toEqual([{ daily: day(2) }]);
  });

  it('saves each day once, and pays for it once, when two claims arrive together', async () => {
    const slow = pausingAfter(db, /FROM games/);
    const results = [result(day(2), 5000), result(day(1), 5000)];
    const claims = await Promise.all([data(claim(results, neel, NOW, slow)), data(claim(results, neel, NOW, slow))]);
    expect(claims.map((each) => each.claimed.length).sort()).toEqual([0, 2]);
    expect(await db.query('SELECT daily FROM games ORDER BY daily')).toEqual([{ daily: day(2) }, { daily: day(1) }]);
    expect(await xpOf()).toBe(200);
  });

  it.each([
    ['no results', { action: 'claim' }],
    ['an empty list', { action: 'claim', results: [] }],
    ['15 results', { action: 'claim', results: Array.from({ length: 15 }, () => result(day(1))) }],
    ['results that are not a list', { action: 'claim', results: result(day(1)) }],
  ])('refuses %s', async (_name, body) => {
    expect(await refusal(post(body))).toEqual([400, 'A claim holds 1 to 14 results.']);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('refuses a visitor, a guest, a request from another site and an account that is gone', async () => {
    expect(await refusal(claim([result(day(1))], null))).toEqual([401, 'Sign in first.']);
    expect(await refusal(claim([result(day(1))], await guest()))).toEqual([403, GUESTS_CANNOT]);
    const crossSite = apiRequest('POST', '/api/daily', { body: { action: 'claim', results: [result(day(1))] }, cookie: neel, headers: { origin: 'https://evil.example' } });
    expect((await dailyPost(crossSite, at(NOW))).status).toBe(403);
    await db.query(`DELETE FROM users WHERE username = 'neel'`);
    expect(await refusal(claim([result(day(1))]))).toEqual([401, 'Sign in first.']);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('cannot be asked without end', async () => {
    for (let index = 0; index < 10; index += 1) {
      expect((await claim([result(day(40))])).status).toBe(200);
    }
    expect((await claim([result(day(1))])).status).toBe(429);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });
});

describe('what a browser says of its daily is not taken on trust', () => {
  // A place and a guess on the same made-up spot: full marks, were anyone to believe it.
  const madeUp = { id: 'nowhere', country: 'ZZ', distanceKm: 0, score: 5000, lng: 1, lat: 1, guessLng: 1, guessLat: 1 };

  it('refuses a perfect daily on places nobody was shown, and leaves the board alone', async () => {
    expect(await refusal(play(dailyGame(0, { rounds: [madeUp, madeUp, madeUp] })))).toEqual([400, "Those are not today's places."]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect((await today()).leaderboard.entries).toEqual([]);
  });

  it('gives a new account none of fourteen made-up past dailies', async () => {
    const forged = Array.from({ length: 14 }, (_unused, index) => ({ daily: day(index), rounds: [madeUp, madeUp, madeUp] }));
    expect(await data(claim(forged))).toEqual({ claimed: [] });
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect(await xpOf()).toBe(0);
  });

  it('gives it none on the days’ real places either, with no start to show for them, or with today’s start for all of them', async () => {
    const perfect = (date: string) => dailyPlaces(date).map((place) => roundOn(place, 5000));
    const untokened = Array.from({ length: 14 }, (_unused, index) => ({ daily: day(index + 1), rounds: perfect(day(index + 1)) }));
    expect(await data(claim(untokened))).toEqual({ claimed: [] });
    const token = tokenOf(TODAY);
    const oneToken = Array.from({ length: 14 }, (_unused, index) => ({ daily: day(index + 1), token, rounds: perfect(day(index + 1)) }));
    expect(await data(claim(oneToken))).toEqual({ claimed: [] });
    expect(await xpOf()).toBe(0);
  });
});
