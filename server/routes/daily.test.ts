import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { visitorStartToken } from '../daily/token.js';
import { dailyOrder, dailyPlaces, dailyRounds, drawnFrom, placesOn, roundOn } from '../games/testing.js';
import { continentOf } from '../places/continents.js';
import type { KnownPlace } from '../places/lists.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, scoredRound, testDb } from '../testing.js';
import { account } from './account.js';
import { daily, dailyPost } from './daily.js';
import { saveGame } from './games.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const ANY_ID = expect.stringMatching(/^[0-9a-f-]{36}$/);
const TODAY = '2027-01-15';
const SEED = 'daily20270115';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 60, rounds: 3 };
const NO_STREAK = { current: 0, best: 0, atRisk: false };
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
const NOT_TODAYS = "That game could not be saved as a daily challenge: it is not today's.";
const NOT_TODAYS_PLACES = "Those are not today's places.";
const NOT_STARTED = 'Start the daily before you finish it.';
const TOO_SOON = 'That daily finished sooner than it could have been played.';
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

/** `count` accounts named p001 onwards, each with a result today: p001 scores 10, p002 scores 20 and so on. */
async function crowd(count: number): Promise<void> {
  await db.query(
    `INSERT INTO users (id, username, password_hash, created_at)
     SELECT gen_random_uuid(), 'p' || lpad(i::text, 3, '0'), 'not-a-real-hash', $1::timestamptz FROM generate_series(1, $2::int) i`,
    [new Date(NOW).toISOString(), count],
  );
  await db.query(
    `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at, daily)
     SELECT gen_random_uuid(), id, 'world', 'move', 60, $1, 3, substr(username, 2)::int * 10, 15000, $2::timestamptz, $3
       FROM users WHERE username LIKE 'p___'`,
    [SEED, new Date(NOW).toISOString(), TODAY],
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

describe('GET /api/daily', () => {
  it("gives a visitor today's challenge, when the next one starts, an empty board and nothing of their own", async () => {
    const response = await daily(apiRequest('GET', '/api/daily'), at(NOW));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        date: TODAY,
        seed: SEED,
        settings: SETTINGS,
        serverNow: '2027-01-15T08:00:00.000Z',
        nextAt: '2027-01-16T00:00:00.000Z',
        state: 'open',
        yours: null,
        streak: NO_STREAK,
        records: null,
        history: [],
        leaderboard: { entries: [], page: 1, more: false },
        distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    });
  });

  it('treats a guest as a visitor', async () => {
    expect(await today(await guest())).toMatchObject({ state: 'open', yours: null, streak: NO_STREAK, records: null, history: [] });
  });

  it('is a new challenge, with a new seed, from midnight UTC', async () => {
    const lastMoment = Date.UTC(2027, 0, 15, 23, 59, 59, 999);
    expect(await today(undefined, lastMoment)).toMatchObject({ date: TODAY, seed: SEED, nextAt: '2027-01-16T00:00:00.000Z' });
    expect(await today(undefined, lastMoment + 1)).toMatchObject({ date: '2027-01-16', seed: 'daily20270116', nextAt: '2027-01-17T00:00:00.000Z' });
  });

  it('tells a signed-in player their own result round by round, and nobody else theirs', async () => {
    expect((await today(neel)).yours).toBeNull();
    expect((await play(dailyGame([4321, 0, 1000]))).status).toBe(201);
    expect((await today(neel)).yours).toEqual({ score: 5321, maxScore: 15_000, rounds: [4321, 0, 1000], rank: 1, beat: 0, averages: null, personalBest: false });
    expect((await today(await signUp('friend'))).yours).toBeNull();
    expect((await today()).yours).toBeNull();
    expect((await today(`${neel}x`)).yours).toBeNull();
  });

  it('ranks the day by score, and equal scores by who got there first, each with their country', async () => {
    await play(dailyGame(3000), await signUp('late'), NOW + 2 * MINUTE);
    await play(dailyGame(4000), neel, NOW + MINUTE);
    const early = await signUp('early');
    await play(dailyGame(3000), early, NOW);
    await db.query(`UPDATE users SET country = 'IN' WHERE username = 'neel'`);
    expect((await today()).leaderboard).toEqual({
      entries: [
        { rank: 1, username: 'neel', country: 'IN', score: 4000 },
        { rank: 2, username: 'early', country: null, score: 3000 },
        { rank: 3, username: 'late', country: null, score: 3000 },
      ],
      page: 1,
      more: false,
    });
    expect((await today(early)).yours).toMatchObject({ rank: 2, beat: 0 });
    expect((await today(neel)).yours).toMatchObject({ rank: 1, beat: 100 });
  });

  it('shows the top hundred, twenty to a page, and tells a player below it their rank', async () => {
    await crowd(103);
    await play(dailyGame(5));
    const first = (await today()).leaderboard;
    expect(first).toMatchObject({ page: 1, more: true });
    expect(first.entries).toHaveLength(20);
    expect(first.entries[0]).toEqual({ rank: 1, username: 'p103', country: null, score: 1030 });
    expect(first.entries[19]).toMatchObject({ rank: 20, username: 'p084' });

    const second = (await today(undefined, NOW, '?page=2')).leaderboard;
    expect(second).toMatchObject({ page: 2, more: true });
    expect(second.entries.map((entry: { rank: number }) => entry.rank)).toEqual(Array.from({ length: 20 }, (_unused, index) => 21 + index));
    expect(second.entries[0]).toMatchObject({ username: 'p083' });

    const last = (await today(undefined, NOW, '?page=5')).leaderboard;
    expect(last).toMatchObject({ page: 5, more: false });
    expect(last.entries).toHaveLength(20);
    expect(last.entries[19]).toEqual({ rank: 100, username: 'p004', country: null, score: 40 });

    expect((await today(undefined, NOW, '?page=6')).leaderboard).toEqual({ entries: [], page: 6, more: false });
    expect((await today(neel)).yours).toMatchObject({ score: 5, rank: 104, beat: 0 });
  });

  it('says there are no more when the board ends on a full page', async () => {
    await crowd(20);
    expect((await today()).leaderboard).toMatchObject({ page: 1, more: false });
    expect((await today(undefined, NOW, '?page=2')).leaderboard).toEqual({ entries: [], page: 2, more: false });
  });

  it.each(['?page=0', '?page=-3', '?page=two', '?page=1.5', '?page='])('gives the first page for %s', async (query) => {
    await play(dailyGame(100));
    expect((await today(undefined, NOW, query)).leaderboard).toMatchObject({ page: 1, entries: [{ rank: 1, username: 'neel' }] });
  });

  it('counts how the day went in ten bands of 1,500 points', async () => {
    const scores = [[0, 0, 0], [1499, 0, 0], [1500, 0, 0], [5000, 5000, 3500], [5000, 5000, 5000], [5000, 2000, 0]];
    for (const [index, each] of scores.entries()) {
      await play(dailyGame(each), await signUp(`player${index}`));
    }
    expect((await today()).distribution).toEqual([2, 1, 0, 0, 1, 0, 0, 0, 0, 2]);
  });

  it('says what whole percent of the other players scored lower, rounding down', async () => {
    for (const [index, score] of [100, 200, 300].entries()) {
      await play(dailyGame(score), await signUp(`player${index}`));
    }
    const same = await signUp('same');
    await play(dailyGame(250), same);
    await play(dailyGame(250), neel, NOW + MINUTE);
    // Of the four others, two scored lower; an equal score is not a lower one.
    expect((await today(neel)).yours).toMatchObject({ rank: 3, beat: 50 });
    expect((await today(same)).yours).toMatchObject({ rank: 2, beat: 50 });
    await play(dailyGame(50), await signUp('low'));
    await play(dailyGame(60), await signUp('lower'));
    // Four of six.
    expect((await today(neel)).yours).toMatchObject({ rank: 3, beat: 66 });
  });

  it('leaves banned and deleted accounts and guests off the board, and out of the ranks, the percentage and the bands', async () => {
    await play(dailyGame(4000), await signUp('cheat'));
    await play(dailyGame(3000), await signUp('gone'));
    await play(dailyGame(100), await signUp('low'));
    await createGuest(db, NOW);
    await db.query(`UPDATE users SET username = 'ghost' WHERE guest`);
    await played('ghost', TODAY, 4500);
    await play(dailyGame(2000));
    await db.query(`UPDATE users SET banned = true WHERE username = 'cheat'`);
    await db.query(`UPDATE users SET deleted_at = $1::timestamptz WHERE username = 'gone'`, [new Date(NOW).toISOString()]);

    const seen = await today(neel);
    expect(seen.leaderboard.entries).toEqual([
      { rank: 1, username: 'neel', country: null, score: 2000 },
      { rank: 2, username: 'low', country: null, score: 100 },
    ]);
    expect(seen.yours).toMatchObject({ rank: 1, beat: 100 });
    expect(seen.distribution).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("starts each day empty: yesterday's results are not today's", async () => {
    await play(dailyGame(4000));
    const tomorrow = NOW + DAY;
    expect(await today(neel, tomorrow)).toMatchObject({
      date: '2027-01-16',
      state: 'open',
      yours: null,
      leaderboard: { entries: [] },
      distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  it('leaves a game on the same seed that did not say it was the daily off the leaderboard', async () => {
    expect((await save(dailyGame(5000, { daily: undefined }))).status).toBe(201);
    expect(await today(neel)).toMatchObject({ state: 'open', yours: null, leaderboard: { entries: [] } });
  });
});

describe('the streak, the records and the last two weeks', () => {
  it('are zeros, and fourteen empty days ending today, for an account that has never played', async () => {
    const seen = await today(neel);
    expect(seen).toMatchObject({ streak: NO_STREAK, records: { played: 0, best: 0, average: 0 } });
    expect(seen.history).toHaveLength(14);
    expect(seen.history[0]).toEqual({ date: '2027-01-02', score: null });
    expect(seen.history[13]).toEqual({ date: TODAY, score: null });
  });

  it('count a streak back from yesterday, at risk until today is played', async () => {
    for (const ago of [3, 2, 1]) {
      await played('neel', day(ago), 1000 * ago);
    }
    expect((await today(neel)).streak).toEqual({ current: 3, best: 3, atRisk: true });
    await play(dailyGame(500));
    expect((await today(neel)).streak).toEqual({ current: 4, best: 4, atRisk: false });
    expect((await today(neel, NOW + DAY)).streak).toEqual({ current: 4, best: 4, atRisk: true });
    expect((await today(neel, NOW + 3 * DAY)).streak).toEqual({ current: 0, best: 4, atRisk: false });
  });

  it('bridge one missed day in seven', async () => {
    for (const ago of [7, 6, 5, 4, 3, 1]) {
      await played('neel', day(ago), 1000);
    }
    expect((await today(neel)).streak).toEqual({ current: 6, best: 6, atRisk: true });
  });

  it('give the days played, the best and the average, and each of the last fourteen days with its score', async () => {
    await played('neel', day(20), 15_000);
    await played('neel', day(13), 3000);
    await played('neel', day(1), 6001);
    await play(dailyGame(2000));
    const seen = await today(neel);
    expect(seen.records).toEqual({ played: 4, best: 15_000, average: 6500 });
    expect(seen.history.map((entry: { date: string }) => entry.date)).toEqual(Array.from({ length: 14 }, (_unused, index) => day(13 - index)));
    expect(seen.history.filter((entry: { score: number | null }) => entry.score !== null)).toEqual([
      { date: day(13), score: 3000 },
      { date: day(1), score: 6001 },
      { date: TODAY, score: 2000 },
    ]);
  });

  it('keep a five-round daily from before out of the records, where its score does not compare, but count its day', async () => {
    await played('neel', day(1), 21_000, 25_000);
    await play(dailyGame(2000));
    const seen = await today(neel);
    expect(seen.records).toEqual({ played: 1, best: 2000, average: 2000 });
    expect(seen.streak).toEqual({ current: 2, best: 2, atRisk: false });
  });

  it("are the asker's own", async () => {
    await played('neel', day(1), 1000);
    expect(await today(await signUp('friend'))).toMatchObject({ streak: NO_STREAK, records: { played: 0 } });
  });
});

describe('the day’s average for each round', () => {
  /** `count` more accounts, each with a daily today: the first scores 1000, 100 and 0, the next 2000, 200 and 0, and so on. */
  async function others(count: number, from = 1): Promise<void> {
    for (let index = from; index < from + count; index += 1) {
      await play(dailyGame([1000 * index, 100 * index, 0]), await signUp(`other${index}`));
    }
  }

  it('is not told until five players have finished, the asker among them', async () => {
    await others(3);
    await play(dailyGame([5000, 500, 25]));
    expect((await today(neel)).yours).toMatchObject({ averages: null });
    await others(1, 4);
    // 1000, 2000, 3000, 4000 and 5000 in the first round; 100 to 500 in the second; four nothings and a 25 in the third.
    expect((await today(neel)).yours).toMatchObject({ rounds: [5000, 500, 25], averages: [3000, 300, 5] });
  });

  it('is rounded to a whole number', async () => {
    await others(4);
    await play(dailyGame([1001, 0, 3]));
    // 11,001 over five is 2200.2, and 3 over five is 0.6.
    expect((await today(neel)).yours.averages).toEqual([2200, 200, 1]);
  });

  it('is the same for everyone who has played, and is nobody’s who has not', async () => {
    await others(5);
    const first = `${accountCookieName(true)}=${createAccountSession((await db.query<{ id: string }>(`SELECT id FROM users WHERE username = 'other1'`))[0]?.id ?? '', NOW, TEST_SECRET)}`;
    expect((await today(first)).yours.averages).toEqual([3000, 300, 0]);
    expect((await today(neel)).yours).toBeNull();
  });

  it('leaves out banned and deleted accounts, as the board does, but counts the asker’s own result whatever they are', async () => {
    await others(4);
    await play(dailyGame([5000, 5000, 5000]));
    await play(dailyGame([5000, 5000, 5000]), await signUp('cheat'));
    await db.query(`UPDATE users SET banned = true WHERE username = 'cheat'`);
    // Without the cheat's 5000: (1000 + 2000 + 3000 + 4000 + 5000) / 5.
    expect((await today(neel)).yours.averages).toEqual([3000, 1200, 1000]);
    await db.query(`UPDATE users SET banned = true WHERE username = 'neel'`);
    await db.query(`UPDATE users SET deleted_at = $1::timestamptz WHERE username = 'other4'`, [new Date(NOW).toISOString()]);
    // Four are left, and the asker's own, though it is on no board, is one of them.
    expect((await today(neel)).yours.averages).toBeNull();
    await others(1, 5);
    // Now 1000, 2000, 3000 and 5000 with the asker's 5000; 100, 200, 300 and 500 with the asker's 5000.
    expect((await today(neel)).yours.averages).toEqual([3200, 1220, 1000]);
  });
});

describe('a personal best', () => {
  it('is not said of a first daily', async () => {
    await play(dailyGame(4000));
    expect((await today(neel)).yours).toMatchObject({ score: 4000, personalBest: false });
  });

  it('is a total higher than every earlier daily of the account', async () => {
    await played('neel', day(3), 2000);
    await played('neel', day(1), 3999);
    await play(dailyGame(4000));
    expect((await today(neel)).yours.personalBest).toBe(true);
  });

  it.each([
    ['equal to the best before', 4000],
    ['lower than the best before', 4001],
  ])('is not a total %s', async (_name, before) => {
    await played('neel', day(9), before);
    await played('neel', day(1), 100);
    await play(dailyGame(4000));
    expect((await today(neel)).yours.personalBest).toBe(false);
  });

  it('is by the day a daily was the challenge of, not by when it was saved, and is each account’s own', async () => {
    await played('friend', day(1), 9000);
    await play(dailyGame(4000));
    // A result of an earlier day that an account claims afterwards is still an earlier daily.
    expect(await data(claim([result(day(1), 3000)]))).toEqual({ claimed: [day(1)] });
    expect((await today(neel)).yours.personalBest).toBe(true);
  });

  it('pays no attention to a five-round daily from before, whose total does not compare', async () => {
    await played('neel', day(2), 21_000, 25_000);
    await play(dailyGame(4000));
    expect((await today(neel)).yours.personalBest).toBe(false);
    await played('neel', day(1), 3000);
    expect((await today(neel)).yours.personalBest).toBe(true);
  });
});

describe('POST /api/daily { action: "start" }', () => {
  it("marks today's attempt as begun, until the result is saved", async () => {
    expect((await today(neel)).state).toBe('open');
    const response = await start();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { state: 'started', token: null } });
    expect((await today(neel)).state).toBe('started');
    expect((await today(await signUp('friend'))).state).toBe('open');

    await save(dailyGame(1000), neel, NOW + PLAYED_IN);
    expect((await today(neel)).state).toBe('done');
    expect(await data(start())).toEqual({ state: 'done', token: null });
  });

  it('changes nothing when it is asked again', async () => {
    await start();
    expect(await data(start(neel, NOW + HOUR))).toEqual({ state: 'started', token: null });
    expect(await db.query('SELECT day, started_at FROM daily_attempts')).toEqual([{ day: TODAY, started_at: new Date(NOW) }]);
  });

  it('leaves one attempt when two requests arrive together', async () => {
    expect(await Promise.all([data(start()), data(start())])).toEqual([
      { state: 'started', token: null },
      { state: 'started', token: null },
    ]);
    expect(await db.query('SELECT day FROM daily_attempts')).toHaveLength(1);
  });

  it('is for one day: the next day is open again', async () => {
    await start();
    expect((await today(neel, NOW + DAY)).state).toBe('open');
    expect(await data(start(neel, NOW + DAY))).toEqual({ state: 'started', token: null });
    expect(await db.query('SELECT day FROM daily_attempts ORDER BY day')).toEqual([{ day: TODAY }, { day: '2027-01-16' }]);
  });

  it('refuses a request from another site', async () => {
    const crossSite = apiRequest('POST', '/api/daily', { body: { action: 'start' }, cookie: neel, headers: { origin: 'https://evil.example' } });
    expect((await dailyPost(crossSite, at(NOW))).status).toBe(403);
    expect(await db.query('SELECT day FROM daily_attempts')).toEqual([]);
  });

  it('cannot be asked without end', async () => {
    for (let index = 0; index < 30; index += 1) {
      expect((await start()).status).toBe(200);
    }
    expect(await refusal(start())).toEqual([429, 'Too many dailies started in the last hour. Try again later.']);
    expect((await start(neel, NOW + HOUR)).status).toBe(200);
  });
});

describe('POST /api/daily', () => {
  it.each([
    ['another action', { action: 'reset' }],
    ['no action', {}],
  ])('refuses %s', async (_name, body) => {
    expect(await refusal(post(body))).toEqual([400, 'That is not something that can be asked here.']);
  });
});

describe('POST /api/games with daily', () => {
  it('saves the daily like any game, so it shows in the stats and the recent games', async () => {
    const response = await play(dailyGame(4000));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      data: { id: ANY_ID, playedAt: new Date(NOW).toISOString(), map: 'world', mode: 'move', rounds: 3, score: 4000, maxScore: 15_000, xpEarned: 80, xpCapped: false },
    });
    const me = (await (await account(apiRequest('GET', '/api/account', { cookie: neel }), at(NOW))).json()).data;
    expect(me.stats).toMatchObject({ gamesPlayed: 1, roundsPlayed: 3 });
    expect(me.recentGames).toHaveLength(1);
  });

  it('answers a second daily on the same day with the first, however much later and whatever it scored', async () => {
    const first = await play(dailyGame(1000));
    const second = await play(dailyGame(5000), neel, NOW + 6 * HOUR);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await today(neel, NOW + 6 * HOUR)).toMatchObject({
      yours: { score: 1000, maxScore: 15_000 },
      leaderboard: { entries: [{ rank: 1, username: 'neel', score: 1000 }] },
    });
    expect(await db.query('SELECT id FROM games')).toHaveLength(1);
  });

  it('keeps one result when the same daily is posted twice at the same moment', async () => {
    await start(neel, NOW - PLAYED_IN);
    const slow = pausingAfter(db, /FROM games/);
    const responses = await Promise.all([save(dailyGame(2000), neel, NOW, slow), save(dailyGame(3000), neel, NOW, slow)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await db.query('SELECT id FROM games')).toHaveLength(1);
    expect((await today()).leaderboard.entries).toHaveLength(1);
    expect(await xpOf()).toBe((await db.query<{ xp_earned: number }>('SELECT xp_earned FROM games'))[0]?.xp_earned);
  });

  it('lets the player play the next day too', async () => {
    await play(dailyGame(1000));
    const tomorrow = NOW + DAY;
    const next = await play(dailyGame(2000, { daily: '2027-01-16', seed: 'daily20270116', rounds: rounds(2000, '2027-01-16') }), neel, tomorrow);
    expect(next.status).toBe(201);
    expect((await today(neel, tomorrow)).yours).toMatchObject({ score: 2000, maxScore: 15_000 });
  });

  it.each([
    ["yesterday's daily", { daily: '2027-01-14', seed: 'daily20270114' }],
    ["tomorrow's daily", { daily: '2027-01-16', seed: 'daily20270116' }],
    ["today's date on another seed", { seed: 'abc123' }],
    ['another map', { map: 'europe' }],
    ['another mode', { mode: 'no-move' }],
    ['no time limit', { timeLimit: 0 }],
    ['two minutes a round, as it used to be', { timeLimit: 120 }],
    ['two rounds', { rounds: rounds(100).slice(0, 2) }],
    ['five rounds, as it used to be', { rounds: [100, 0, 0, 0, 0].map((points) => scoredRound(points)) }],
  ])('refuses %s, saving nothing', async (_name, change) => {
    expect(await refusal(play(dailyGame(4000, change)))).toEqual([400, NOT_TODAYS]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it.each([['2027-1-15'], ['today'], [20270115], [null]])('refuses %s as a date', async (date) => {
    const response = await play(dailyGame(4000, { daily: date }));
    expect(response.status).toBe(400);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('ranks the day on the score the server worked out, not on the one a browser claimed', async () => {
    // Three guesses on the far side of the world from their places, each claiming full marks.
    const madeUp = dailyPlaces(TODAY).map((place) => farOff(place, { country: 'FR', distanceKm: 0, score: 5000 }));
    const response = await play(dailyGame(0, { rounds: madeUp }));
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ score: 0, xpEarned: 0 });
    await play(dailyGame(1200), await signUp('honest'));
    expect((await today()).leaderboard.entries).toEqual([
      { rank: 1, username: 'honest', country: null, score: 1200 },
      { rank: 2, username: 'neel', country: null, score: 0 },
    ]);
  });

  it('still refuses a visitor, and refuses a guest', async () => {
    const response = await saveGame(apiRequest('POST', '/api/games', { body: dailyGame(4000) }), at(NOW));
    expect(response.status).toBe(401);
    expect(await refusal(save(dailyGame(4000), await guest()))).toEqual([403, GUESTS_CANNOT]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });
});

describe('a daily has to be begun, and takes time', () => {
  it('is refused when the account has not begun today’s', async () => {
    expect(await refusal(save(dailyGame(4000)))).toEqual([409, NOT_STARTED]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect(await xpOf()).toBe(0);
    expect((await today(neel)).state).toBe('open');
  });

  it('is refused when only someone else has begun it, or the account began yesterday’s', async () => {
    await start(await signUp('friend'), NOW - MINUTE);
    await start(neel, NOW - DAY);
    expect(await refusal(save(dailyGame(4000)))).toEqual([409, NOT_STARTED]);
  });

  it('is refused sooner than 6 seconds after it was begun, and taken from then on', async () => {
    await start(neel, NOW);
    expect(await refusal(save(dailyGame(4000), neel, NOW))).toEqual([409, TOO_SOON]);
    expect(await refusal(save(dailyGame(4000), neel, NOW + PLAYED_IN - 1))).toEqual([409, TOO_SOON]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    // Being refused did not use the attempt up.
    expect((await today(neel, NOW + PLAYED_IN - 1)).state).toBe('started');
    expect((await save(dailyGame(4000), neel, NOW + PLAYED_IN)).status).toBe(201);
  });

  it('counts the time from the first start, whatever is asked again after it', async () => {
    await start(neel, NOW);
    await start(neel, NOW + 5_000);
    expect((await save(dailyGame(4000), neel, NOW + PLAYED_IN)).status).toBe(201);
  });

  it('checks that it is today’s, and on today’s places, before it asks whether it was begun', async () => {
    expect(await refusal(save(dailyGame(4000, { seed: 'abc123' })))).toEqual([400, NOT_TODAYS]);
    expect(await refusal(save(dailyGame(4000, { rounds: rounds(4000, day(1)) })))).toEqual([400, NOT_TODAYS_PLACES]);
  });
});

describe('the places of a daily', () => {
  /** Rounds on these places, each guess on the spot. */
  const on = (places: readonly KnownPlace[]) => places.map((place) => roundOn(place, 5000));
  const drawn = dailyPlaces(TODAY);
  const window = dailyOrder(TODAY, 100);
  /** The first two places of the hundred that share a country. */
  const twoInOneCountry = window.filter((place) => place.country === window.find((one) => window.some((other) => other !== one && other.country === one.country))?.country).slice(0, 2);

  it('are the three the day’s seed draws, from either list', async () => {
    expect((await play(dailyGame(0, { rounds: on(drawn) }))).status).toBe(201);
    const response = await play(dailyGame(0, { rounds: on(dailyPlaces(TODAY, 1)) }), await signUp('friend'));
    expect(response.status).toBe(201);
    expect((await response.json()).data.score).toBe(15_000);
  });

  it('may be others among the first hundred of the seed’s order, as when a picture was gone and the draw was made again', async () => {
    const redrawn = drawnFrom(window.slice(40));
    expect(redrawn.some((place) => !drawn.includes(place))).toBe(true);
    expect((await play(dailyGame(0, { rounds: on(redrawn) }))).status).toBe(201);
  });

  it('may be played in any order', async () => {
    expect((await play(dailyGame(0, { rounds: on([...drawn].reverse()) }))).status).toBe(201);
  });

  it.each<[string, () => KnownPlace[]]>([
    ['real places the seed does not draw', () => placesOn('world', 300).filter((place) => !window.includes(place)).slice(0, 3)],
    ['the places of yesterday’s daily', () => dailyPlaces(day(1))],
    ['places past the first hundred of the seed’s order', () => drawnFrom(dailyOrder(TODAY, 400).slice(100))],
    ['two places in one country', () => [...twoInOneCountry, ...window.filter((place) => place.country !== twoInOneCountry[0]?.country).slice(0, 1)]],
  ])('cannot be %s', async (_name, places) => {
    const chosen = places();
    expect(chosen).toHaveLength(3);
    expect(await refusal(play(dailyGame(0, { rounds: on(chosen) })))).toEqual([400, NOT_TODAYS_PLACES]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect((await today()).leaderboard.entries).toEqual([]);
  });

  it('cannot all be on one continent', async () => {
    const european = window.filter((place) => continentOf(place) === 'europe');
    // One from each of three countries, all of them in Europe.
    const three = european.filter((place, index) => european.findIndex((other) => other.country === place.country) === index).slice(0, 3);
    expect(three).toHaveLength(3);
    expect(await refusal(play(dailyGame(0, { rounds: on(three) })))).toEqual([400, NOT_TODAYS_PLACES]);
  });

  it.each<[string, () => unknown[]]>([
    ['the same place twice', () => on([drawn[0], drawn[1], drawn[0]].flatMap((place) => (place ? [place] : [])))],
    ['places from both lists', () => on([...drawn.slice(0, 2), ...dailyPlaces(TODAY, 1).slice(2)])],
    ['a place that is in no list', () => [...on(drawn.slice(0, 2)), { id: 'nowhere', lng: 1, lat: 1, guessLng: 1, guessLat: 1 }]],
    ['a place said to be somewhere it is not', () => on(drawn).map((round, index) => (index === 0 ? { ...round, lng: 1, lat: 1 } : round))],
  ])('cannot have %s', async (_name, sent) => {
    expect(await refusal(play(dailyGame(0, { rounds: sent() })))).toEqual([400, NOT_TODAYS_PLACES]);
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });
});
