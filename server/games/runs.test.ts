import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession, createGuestSession } from '../account/session.js';
import { visitorStartToken } from '../daily/token.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { continentOf } from '../places/continents.js';
import { placesOf } from '../places/lists.js';
import { account } from '../routes/account.js';
import { gamesGet, saveGame } from '../routes/games.js';
import { socialGet } from '../routes/social.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, pausingAfter, resetDb, testDb } from '../testing.js';
import { RUN_ROUND_MS, countRun, runToken, startedRun } from './runs.js';
import { guesserRounds, streakRounds } from './testing.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
const NOT_VALID = 'That game could not be saved: its details are not valid.';
const NOT_STARTED_HERE = 'That run was not started here.';
const NOT_KNOWN = 'That run could not be saved: its places are not known.';
const TOO_SOON = 'That run finished sooner than it could have been played.';

type Kind = 'streak' | 'country' | 'continent';
type Rounds = Array<{ id: string; answer: string | null }>;

let db: Db;
let neel: string;
let friend: string;
const ids = new Map<string, string>();

const at = (now: number, on: Db = db): Context => ({ db: on, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  ids.set(username, id);
  return `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
}

async function guest(): Promise<string> {
  const made = await createGuest(db, NOW);
  return `${accountCookieName(true)}=${createGuestSession(made.userId, NOW, TEST_SECRET)}`;
}

const post = (body: unknown, cookie: string | null = neel, now = NOW, on: Db = db) =>
  saveGame(apiRequest('POST', '/api/games', { body, cookie: cookie ?? undefined }), at(now, on));
const data = async (response: Response | Promise<Response>) => (await (await response).json()).data;
const refusal = async (response: Response | Promise<Response>) => {
  const sent = await response;
  return [sent.status, (await sent.json()).error];
};

/** Begins a run and gives back its token. */
const begin = async (kind: Kind, cookie = neel, now = NOW): Promise<string> => (await data(post({ action: 'start', kind }, cookie, now))).run;
/** When a run of these rounds begun at `from` can first be finished. */
const after = (rounds: Rounds, from = NOW): number => from + rounds.length * RUN_ROUND_MS;

/** Begins a run at `now`, plays these rounds and finishes it as soon as it could have been played. */
async function play(kind: Kind, rounds: Rounds, cookie = neel, now = NOW, extra: Record<string, unknown> = {}): Promise<Response> {
  const run = await begin(kind, cookie, now);
  return post({ kind, run, rounds, ...extra }, cookie, after(rounds, now));
}

const me = async (cookie = neel) => (await (await account(apiRequest('GET', '/api/account', { cookie }), at(NOW))).json()).data;
/** The account's own best figures, read straight from its row. */
const bests = async (username = 'neel') =>
  (await db.query<{ xp: number; best_streak: number; best_country: number; best_continent: number }>(
    'SELECT xp, best_streak, best_country, best_continent FROM users WHERE username = $1',
    [username],
  ))[0];
const nearlyCapped = () => db.query(`UPDATE users SET xp = 19950, solo_xp = 19950, solo_xp_day = '2027-01-15' WHERE username = 'neel'`);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  neel = await signUp('neel');
  friend = await signUp('friend');
});

describe('POST /api/games { action: "start" }', () => {
  it.each(['streak', 'country', 'continent'] as const)('begins a %s run, and answers with the token it is finished with', async (kind) => {
    const response = await post({ action: 'start', kind });
    expect(response.status).toBe(201);
    const { run } = (await response.json()).data;
    expect(startedRun(run, TEST_SECRET)).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), userId: ids.get('neel'), kind, startedAt: NOW });
    // Beginning writes nothing but its own count.
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
  });

  it('gives every run its own token', async () => {
    expect(await begin('streak')).not.toBe(await begin('streak'));
  });

  it.each([
    ['a kind that is none of them', { action: 'start', kind: 'marathon' }],
    ['no kind', { action: 'start' }],
  ])('refuses %s', async (_name, body) => {
    expect(await refusal(post(body))).toEqual([400, NOT_VALID]);
  });

  it('refuses a visitor, a guest and a request from another site', async () => {
    expect(await refusal(post({ action: 'start', kind: 'streak' }, null))).toEqual([401, 'Sign in first.']);
    expect(await refusal(post({ action: 'start', kind: 'streak' }, await guest()))).toEqual([403, GUESTS_CANNOT]);
    const crossSite = apiRequest('POST', '/api/games', { body: { action: 'start', kind: 'streak' }, cookie: neel, headers: { origin: 'https://evil.example' } });
    expect((await saveGame(crossSite, at(NOW))).status).toBe(403);
  });

  it('can be asked 120 times an hour, apart from the limit on saves', async () => {
    for (let index = 0; index < 120; index += 1) {
      expect((await post({ action: 'start', kind: 'streak' })).status).toBe(201);
    }
    expect(await refusal(post({ action: 'start', kind: 'streak' }))).toEqual([429, 'Too many runs started in the last hour. Try again later.']);
    expect((await post({ action: 'start', kind: 'streak' }, friend)).status).toBe(201);
    expect((await post({ action: 'start', kind: 'streak' }, neel, NOW + HOUR)).status).toBe(201);
    // None of them counted as a save.
    expect((await play('streak', streakRounds(1), neel, NOW + HOUR)).status).toBe(200);
  });
});

describe('a country-streak run', () => {
  it('earns 20 XP for each country and becomes the best streak', async () => {
    const response = await play('streak', streakRounds(7));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { bestStreak: 7, streak: 7, xpEarned: 140, xpCapped: false } });
    expect((await me()).account).toMatchObject({ xp: 140, bestStreak: 7 });
    expect((await me(friend)).account).toMatchObject({ xp: 0, bestStreak: 0 });
    expect(await db.query('SELECT kind, seed, streak, xp_earned FROM streak_runs')).toEqual([
      { kind: 'streak', seed: expect.stringMatching(/^[0-9a-f]{32}$/), streak: 7, xp_earned: 140 },
    ]);
  });

  it('is counted by the server: the countries got right before the first one got wrong', async () => {
    const rounds = streakRounds(4).map((round, index) => (index === 2 ? { ...round, answer: 'ZZ' } : round));
    // The fourth is right, but the streak ended on the third.
    expect(await data(play('streak', rounds))).toMatchObject({ streak: 2, xpEarned: 40 });
  });

  it('ends on a round with no answer', async () => {
    const rounds = streakRounds(1).map((round, index) => (index === 1 ? { ...round, answer: null } : round));
    expect(await data(play('streak', rounds))).toMatchObject({ streak: 1 });
  });

  it('counts every round when none was got wrong, and stops at 500', async () => {
    expect(await data(play('streak', streakRounds(3).slice(0, 3)))).toMatchObject({ streak: 3, bestStreak: 3 });
    const all = placesOf(0)
      .slice(0, 501)
      .map((place) => ({ id: place.id, answer: place.country }));
    expect(await data(play('streak', all, friend))).toEqual({ bestStreak: 500, streak: 500, xpEarned: 10_000, xpCapped: false });
  });

  it('keeps the best streak when a later run is shorter, and still pays for the run', async () => {
    await play('streak', streakRounds(12));
    expect(await data(play('streak', streakRounds(3), neel, NOW + MINUTE))).toEqual({ bestStreak: 12, streak: 3, xpEarned: 60, xpCapped: false });
    expect(await data(play('streak', streakRounds(20), neel, NOW + 2 * MINUTE))).toEqual({ bestStreak: 20, streak: 20, xpEarned: 400, xpCapped: false });
    expect((await me()).account).toMatchObject({ xp: 240 + 60 + 400, bestStreak: 20 });
  });

  it('counts a run that ended on the first country: nothing earned, nothing lost', async () => {
    await play('streak', streakRounds(4));
    expect(await data(play('streak', streakRounds(0), neel, NOW + MINUTE))).toEqual({ bestStreak: 4, streak: 0, xpEarned: 0, xpCapped: false });
  });

  it('is not a game: it is not in the stats, the recent games or the history', async () => {
    await play('streak', streakRounds(5));
    const mine = await me();
    expect(mine.stats.gamesPlayed).toBe(0);
    expect(mine.recentGames).toEqual([]);
    expect((await data(gamesGet(apiRequest('GET', '/api/games?page=1', { cookie: neel }), at(NOW)))).games).toEqual([]);
  });

  it('is paid as far as the day’s cap on solo XP allows, and the reply says when that was not all of it', async () => {
    await nearlyCapped();
    expect(await data(play('streak', streakRounds(5)))).toEqual({ bestStreak: 5, streak: 5, xpEarned: 50, xpCapped: true });
    expect(await data(play('streak', streakRounds(8), neel, NOW + MINUTE))).toEqual({ bestStreak: 8, streak: 8, xpEarned: 0, xpCapped: true });
    expect(await bests()).toMatchObject({ xp: 20_000, best_streak: 8 });
  });

  it.each([
    ['502 rounds', (run: string) => ({ kind: 'streak', run, rounds: placesOf(0).slice(0, 502).map((place) => ({ id: place.id, answer: place.country })) })],
    ['no rounds', (run: string) => ({ kind: 'streak', run, rounds: [] })],
    ['a count in place of rounds', (run: string) => ({ kind: 'streak', run, streak: 7 })],
    ['a country in small letters', (run: string) => ({ kind: 'streak', run, rounds: [{ id: placesOf(0)[0]?.id, answer: 'ad' }] })],
    ['a continent as the answer', (run: string) => ({ kind: 'streak', run, rounds: [{ id: placesOf(0)[0]?.id, answer: 'europe' }] })],
    ['a round with no answer given at all', (run: string) => ({ kind: 'streak', run, rounds: [{ id: placesOf(0)[0]?.id }] })],
    ['a round with no place', (run: string) => ({ kind: 'streak', run, rounds: [{ answer: 'AD' }] })],
    ['no run', () => ({ kind: 'streak', rounds: streakRounds(1) })],
    ['a mark that is not yes or no', (run: string) => ({ kind: 'streak', run, rounds: streakRounds(1), inPlay: 'yes' })],
    ['another kind', (run: string) => ({ kind: 'marathon', run, rounds: streakRounds(1) })],
  ])('refuses %s', async (_name, body) => {
    const run = await begin('streak');
    expect(await refusal(post(body(run), neel, NOW + HOUR))).toEqual([400, NOT_VALID]);
    expect((await me()).account).toMatchObject({ xp: 0, bestStreak: 0 });
  });

  it('refuses a visitor, a guest, a request from another site, and an account that is gone', async () => {
    const run = await begin('streak');
    const body = { kind: 'streak', run, rounds: streakRounds(5) };
    expect((await post(body, null, NOW + HOUR)).status).toBe(401);
    expect(await refusal(post(body, await guest(), NOW + HOUR))).toEqual([403, GUESTS_CANNOT]);
    const crossSite = apiRequest('POST', '/api/games', { body, cookie: neel, headers: { origin: 'https://evil.example' } });
    expect((await saveGame(crossSite, at(NOW + HOUR))).status).toBe(403);
    await db.query('DELETE FROM users');
    expect((await post(body, neel, NOW + HOUR)).status).toBe(401);
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
  });

  it('shares the limit on saves, so runs cannot be finished without end', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push((await play('streak', streakRounds(1))).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});

describe('the streak counted behind ordinary games', () => {
  it('sets the best streak and is on the day’s streak board, and pays no XP', async () => {
    const response = await play('streak', streakRounds(6), neel, NOW, { inPlay: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { bestStreak: 6, streak: 6, xpEarned: 0, xpCapped: false } });
    expect(await bests()).toMatchObject({ xp: 0, best_streak: 6 });
    expect(await db.query('SELECT kind, streak, xp_earned FROM streak_runs')).toEqual([{ kind: 'streak', streak: 6, xp_earned: 0 }]);
    const board = await data(socialGet(apiRequest('GET', '/api/social?leaderboard=streak&period=day'), at(NOW + MINUTE)));
    expect(board.entries).toMatchObject([{ username: 'neel', value: 6 }]);
  });

  it('pays as any streak does when it is not marked', async () => {
    expect(await data(play('streak', streakRounds(6), neel, NOW, { inPlay: false }))).toMatchObject({ xpEarned: 120 });
  });

  it('is never said to be capped: it earned nothing to cap', async () => {
    await db.query(`UPDATE users SET xp = 20000, solo_xp = 20000, solo_xp_day = '2027-01-15' WHERE username = 'neel'`);
    expect(await data(play('streak', streakRounds(6), neel, NOW, { inPlay: true }))).toEqual({ bestStreak: 6, streak: 6, xpEarned: 0, xpCapped: false });
  });
});

describe.each([
  ['country', 'best_country', 'best_continent'],
  ['continent', 'best_continent', 'best_country'],
] as const)('a run of the %s guesser', (kind, column, other) => {
  it('earns 20 XP for each right answer, and its points become the best', async () => {
    const response = await play(kind, guesserRounds(kind, 7));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { best: 7000, correct: 7, xpEarned: 140, xpCapped: false } });
    expect(await bests()).toMatchObject({ xp: 140, [column]: 7000, [other]: 0, best_streak: 0 });
    expect(await bests('friend')).toMatchObject({ xp: 0, [column]: 0 });
    expect(await db.query('SELECT kind, streak, xp_earned FROM streak_runs')).toEqual([{ kind, streak: 7, xp_earned: 140 }]);
  });

  it('is counted by the server: every right answer, wherever in the run it came', async () => {
    const rounds = guesserRounds(kind, 10).map((round, index) => (index % 2 === 0 ? { ...round, answer: null } : round));
    expect(await data(play(kind, rounds))).toMatchObject({ correct: 5, best: 5000, xpEarned: 100 });
  });

  it('may be shorter than ten rounds, and is then out of what was played', async () => {
    expect(await data(play(kind, guesserRounds(kind, 3, 4)))).toMatchObject({ correct: 3, best: 3000 });
  });

  it('keeps the best when a later run scores less, and still pays for the run', async () => {
    await play(kind, guesserRounds(kind, 8));
    expect(await data(play(kind, guesserRounds(kind, 3), neel, NOW + MINUTE))).toEqual({ best: 8000, correct: 3, xpEarned: 60, xpCapped: false });
    expect(await data(play(kind, guesserRounds(kind, 10), neel, NOW + 2 * MINUTE))).toEqual({ best: 10_000, correct: 10, xpEarned: 200, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 160 + 60 + 200, [column]: 10_000 });
  });

  it('counts a run with nothing right: nothing earned, nothing lost', async () => {
    await play(kind, guesserRounds(kind, 4));
    expect(await data(play(kind, guesserRounds(kind, 0), neel, NOW + MINUTE))).toEqual({ best: 4000, correct: 0, xpEarned: 0, xpCapped: false });
  });

  it('is paid as far as the day’s cap on solo XP allows', async () => {
    await nearlyCapped();
    expect(await data(play(kind, guesserRounds(kind, 9)))).toEqual({ best: 9000, correct: 9, xpEarned: 50, xpCapped: true });
  });

  it.each([
    ['11 rounds', (run: string) => ({ kind, run, rounds: [...guesserRounds(kind, 10), ...guesserRounds(kind, 1)] })],
    ['no rounds', (run: string) => ({ kind, run, rounds: [] })],
    ['a count in place of rounds', (run: string) => ({ kind, run, correct: 7 })],
    ['an answer of the other guesser', (run: string) => ({ kind, run, rounds: guesserRounds(kind === 'country' ? 'continent' : 'country', 1, 1) })],
    ['no run', () => ({ kind, rounds: guesserRounds(kind, 1) })],
  ])('refuses %s', async (_name, body) => {
    const run = await begin(kind);
    expect(await refusal(post(body(run), neel, NOW + HOUR))).toEqual([400, NOT_VALID]);
    expect(await bests()).toMatchObject({ xp: 0, [column]: 0 });
  });

  it('refuses a visitor, a guest, a request from another site, and an account that is gone', async () => {
    const body = { kind, run: await begin(kind), rounds: guesserRounds(kind, 5) };
    expect((await post(body, null, NOW + HOUR)).status).toBe(401);
    expect(await refusal(post(body, await guest(), NOW + HOUR))).toEqual([403, GUESTS_CANNOT]);
    const crossSite = apiRequest('POST', '/api/games', { body, cookie: neel, headers: { origin: 'https://evil.example' } });
    expect((await saveGame(crossSite, at(NOW + HOUR))).status).toBe(403);
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
    await db.query('DELETE FROM users');
    expect((await post(body, neel, NOW + HOUR)).status).toBe(401);
  });
});

describe('a run takes time', () => {
  it.each([
    ['streak', () => streakRounds(7)],
    ['country', () => guesserRounds('country', 10)],
    ['continent', () => guesserRounds('continent', 10)],
  ] as const)('a %s run is refused when it is finished sooner than 2 seconds a round after it began, and taken from then on', async (kind, make) => {
    const rounds = make();
    const run = await begin(kind);
    expect(await refusal(post({ kind, run, rounds }, neel, NOW))).toEqual([409, TOO_SOON]);
    expect(await refusal(post({ kind, run, rounds }, neel, NOW + rounds.length * 2 * SECOND - 1))).toEqual([409, TOO_SOON]);
    expect(await bests()).toMatchObject({ xp: 0, best_streak: 0, best_country: 0, best_continent: 0 });
    // Being refused did not use the run up.
    expect((await post({ kind, run, rounds }, neel, NOW + rounds.length * 2 * SECOND)).status).toBe(200);
  });

  it('is counted on every round sent, the ones after the streak ended too', async () => {
    const rounds = streakRounds(1).concat(streakRounds(40).slice(2));
    const run = await begin('streak');
    expect(await refusal(post({ kind: 'streak', run, rounds }, neel, NOW + 2 * 2 * SECOND))).toEqual([409, TOO_SOON]);
  });

  it('means a streak of 500 cannot be had in under a quarter of an hour', async () => {
    const all = placesOf(0)
      .slice(0, 501)
      .map((place) => ({ id: place.id, answer: place.country }));
    const run = await begin('streak');
    expect(await refusal(post({ kind: 'streak', run, rounds: all }, neel, NOW + 15 * MINUTE))).toEqual([409, TOO_SOON]);
    expect(await bests()).toMatchObject({ xp: 0, best_streak: 0 });
  });
});

describe('a run counts once', () => {
  it('answers a second finish with what the run came to the first time, and pays nothing more', async () => {
    const run = await begin('streak');
    const first = { kind: 'streak', run, rounds: streakRounds(5) };
    expect(await data(post(first, neel, after(first.rounds)))).toEqual({ bestStreak: 5, streak: 5, xpEarned: 100, xpCapped: false });
    // However much later, and whatever it now claims.
    const second = await post({ kind: 'streak', run, rounds: streakRounds(50) }, neel, NOW + HOUR);
    expect(second.status).toBe(200);
    expect((await second.json()).data).toEqual({ bestStreak: 5, streak: 5, xpEarned: 0, xpCapped: false });
    expect((await me()).account).toMatchObject({ xp: 100, bestStreak: 5 });
    expect(await db.query('SELECT streak FROM streak_runs')).toEqual([{ streak: 5 }]);
  });

  it.each(['country', 'continent'] as const)('answers a second finish of a %s run the same way', async (kind) => {
    const run = await begin(kind);
    await post({ kind, run, rounds: guesserRounds(kind, 5) }, neel, NOW + MINUTE);
    expect(await data(post({ kind, run, rounds: guesserRounds(kind, 10) }, neel, NOW + HOUR))).toEqual({ best: 5000, correct: 5, xpEarned: 0, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 100 });
    expect(await db.query('SELECT streak FROM streak_runs')).toEqual([{ streak: 5 }]);
  });

  it.each([
    ['streak', () => streakRounds(9)],
    ['country', () => guesserRounds('country', 9)],
    ['continent', () => guesserRounds('continent', 9)],
  ] as const)('pays a %s run once when it is finished twice at the same moment', async (kind, make) => {
    const rounds = make();
    const body = { kind, run: await begin(kind), rounds };
    const slow = pausingAfter(db, /FROM streak_runs/);
    const replies = await Promise.all([data(post(body, neel, after(rounds), slow)), data(post(body, neel, after(rounds), slow))]);
    expect(replies.map((reply) => reply.xpEarned).sort((a, b) => a - b)).toEqual([0, 180]);
    expect(replies.map((reply) => reply.streak ?? reply.correct)).toEqual([9, 9]);
    expect((await bests())?.xp).toBe(180);
    expect(await db.query('SELECT seed FROM streak_runs')).toHaveLength(1);
  });

  it('pays two runs begun together each their own', async () => {
    const [one, two] = await Promise.all([begin('streak'), begin('streak')]);
    const rounds = streakRounds(4);
    const replies = await Promise.all([one, two].map((run) => data(post({ kind: 'streak', run, rounds }, neel, after(rounds)))));
    expect(replies.map((reply) => reply.xpEarned)).toEqual([80, 80]);
    expect((await bests())?.xp).toBe(160);
  });
});

describe('a run has to be one this account started, for this kind', () => {
  const finish = (run: unknown, kind: Kind = 'streak', cookie = neel) =>
    post({ kind, run, rounds: kind === 'streak' ? streakRounds(3) : guesserRounds(kind, 3) }, cookie, NOW + HOUR);

  it('refuses a run someone else started', async () => {
    expect(await refusal(finish(await begin('streak', friend)))).toEqual([400, NOT_STARTED_HERE]);
  });

  it('refuses a run started for another kind', async () => {
    expect(await refusal(finish(await begin('country'), 'streak'))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish(await begin('country'), 'continent'))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish(await begin('streak'), 'country'))).toEqual([400, NOT_STARTED_HERE]);
  });

  it('refuses a token that was changed, one signed with another key, and one that is no token', async () => {
    const run = await begin('streak');
    expect(await refusal(finish(`${run}x`))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish(run.replace('.streak.', '.country.'), 'country'))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish(runToken(ids.get('neel') ?? '', 'streak', NOW, Buffer.alloc(32, 9))))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish('seed1'))).toEqual([400, NOT_STARTED_HERE]);
  });

  it('refuses a session, and the token of a visitor’s daily, in place of a run’s', async () => {
    const session = createAccountSession(ids.get('neel') ?? '', NOW, TEST_SECRET);
    expect(await refusal(finish(session))).toEqual([400, NOT_STARTED_HERE]);
    expect(await refusal(finish(visitorStartToken(NOW, TEST_SECRET)))).toEqual([400, NOT_STARTED_HERE]);
    expect(await bests()).toMatchObject({ xp: 0, best_streak: 0 });
  });

  it('is nobody’s session', async () => {
    const run = await begin('streak');
    const response = await account(apiRequest('GET', '/api/account', { cookie: `${accountCookieName(true)}=${run}` }), at(NOW));
    expect((await response.json()).data.account).toBeNull();
  });
});

describe('the places of a run', () => {
  const antarctic = placesOf(0).find((place) => continentOf(place) === null);

  it.each(['streak', 'country', 'continent'] as const)('have to be in one of the lists, for a %s run', async (kind) => {
    const rounds = [...(kind === 'streak' ? streakRounds(2) : guesserRounds(kind, 2, 2)), { id: 'not-a-real-panorama', answer: null }];
    expect(await refusal(play(kind, rounds))).toEqual([400, NOT_KNOWN]);
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
  });

  it('may be from either list, and from both', async () => {
    const [second] = placesOf(1);
    const rounds = [...streakRounds(1).slice(0, 1), { id: second?.id ?? '', answer: second?.country ?? null }];
    expect(await data(play('streak', rounds))).toMatchObject({ streak: 2 });
  });

  it('cannot be on no continent in Continent Guesser, where there would be nothing to answer', async () => {
    expect(antarctic).toBeDefined();
    const rounds = [...guesserRounds('continent', 2, 2), { id: antarctic?.id ?? '', answer: null }];
    expect(await refusal(play('continent', rounds))).toEqual([400, NOT_KNOWN]);
  });

  it('can be on no continent in the other two, where the answer is a country', async () => {
    const rounds = [{ id: antarctic?.id ?? '', answer: antarctic?.country ?? null }];
    expect(await data(play('country', rounds))).toMatchObject({ correct: 1 });
    expect(await data(play('streak', rounds, neel, NOW + MINUTE))).toMatchObject({ streak: 1 });
  });
});

describe('runs of every kind', () => {
  it('keep a best each, side by side', async () => {
    await play('streak', streakRounds(12));
    await play('country', guesserRounds('country', 6));
    await play('continent', guesserRounds('continent', 9));
    expect(await bests()).toEqual({ xp: 240 + 120 + 180, best_streak: 12, best_country: 6000, best_continent: 9000 });
  });
});

describe('countRun', () => {
  const [first, second, third] = placesOf(0);
  const round = (place: typeof first, answer: string | null) => ({ id: place?.id ?? '', answer });

  it('counts a streak up to the first country got wrong', () => {
    const rounds = [round(first, first?.country ?? ''), round(second, second?.country ?? ''), round(third, 'ZZ')];
    expect(countRun({ kind: 'streak', run: 'x', rounds })).toBe(2);
    expect(countRun({ kind: 'streak', run: 'x', rounds: [...rounds].reverse() })).toBe(0);
    expect(countRun({ kind: 'country', run: 'x', rounds: [...rounds].reverse() })).toBe(2);
  });

  it('judges a continent by where the place is, not only by its country: Russia east of the Urals is Asia', () => {
    const siberia = placesOf(0).find((place) => place.country === 'RU' && place.lng > 60);
    expect(siberia).toBeDefined();
    const rounds = [
      { id: siberia?.id ?? '', answer: 'asia' as const },
      { id: siberia?.id ?? '', answer: 'europe' as const },
      { id: first?.id ?? '', answer: continentOf(first ?? { country: '', lng: 0 }) },
    ];
    expect(countRun({ kind: 'continent', run: 'x', rounds })).toBe(2);
  });

  it('is null when a place is not known', () => {
    expect(countRun({ kind: 'streak', run: 'x', rounds: [round(first, 'AD'), { id: 'nowhere', answer: 'AD' }] })).toBeNull();
  });
});
