import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import type { Db } from './client.js';
import { beginDaily } from './daily.js';
import { DUPLICATE_WINDOW_MS, recentGamesFor, saveGame as save, saveRun, statsFor, type Run, type SavedResult, type StoredGame } from './games.js';
import { insertUser } from './users.js';

const NOW = 1_800_000_000_000;
const ANY_ID = expect.stringMatching(/^[0-9a-f-]{36}$/);
const MINUTE = 60_000;

let db: Db;
let player: string;

async function addUser(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return id;
}

const game = (scores: number[], change: Partial<StoredGame> = {}): StoredGame => ({
  map: 'world',
  mode: 'move',
  timeLimit: 0,
  seed: 'seed1',
  rounds: scores.map((score) => ({ country: 'FR', distanceKm: score === 0 ? null : 10, score })),
  ...change,
});

/** Saves a game that nothing stands in the way of: null when the account is gone. */
async function saveGame(on: Db, userId: string, played: StoredGame, now: number): Promise<SavedResult | null> {
  const saved = await save(on, userId, played, now);
  if (typeof saved === 'string') {
    throw new Error(`The game was refused: ${saved}`);
  }
  return saved;
}

const xpOf = async (userId = player) => (await db.query<{ xp: number }>('SELECT xp FROM users WHERE id = $1', [userId]))[0]?.xp;
/** Leaves an account 50 XP short of the day's cap on solo XP. */
const nearlyCapped = () => db.query(`UPDATE users SET xp = 19950, solo_xp = 19950, solo_xp_day = '2027-01-15'`);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  player = await addUser('neel');
});

describe('saveGame', () => {
  it('works out the total and the maximum from the rounds', async () => {
    const saved = await saveGame(db, player, game([5000, 1200, 0]), NOW);
    expect(saved).toEqual({
      created: true,
      xpEarned: 124,
      xpCapped: false,
      game: { id: ANY_ID, playedAt: new Date(NOW).toISOString(), map: 'world', mode: 'move', rounds: 3, score: 6200, maxScore: 15_000 },
    });
  });

  it('keeps every round, in order, including one with no guess', async () => {
    const rounds = [
      { country: 'FR', distanceKm: 0.25, score: 4999 },
      { country: 'JP', distanceKm: null, score: 0 },
      { country: 'BR', distanceKm: 8123.5, score: 310 },
    ];
    await saveGame(db, player, game([], { rounds }), NOW);
    const stored = await db.query('SELECT round, country, distance_km, score FROM game_rounds ORDER BY round');
    expect(stored).toEqual([
      { round: 1, country: 'FR', distance_km: 0.25, score: 4999 },
      { round: 2, country: 'JP', distance_km: null, score: 0 },
      { round: 3, country: 'BR', distance_km: 8123.5, score: 310 },
    ]);
  });

  it('returns the first save again when the same game arrives twice', async () => {
    const first = await saveGame(db, player, game([5000, 5000]), NOW);
    const again = await saveGame(db, player, game([1, 1]), NOW + 5_000);
    expect(again).toEqual({ created: false, xpEarned: 200, xpCapped: false, game: first?.game });
    expect(await db.query('SELECT id FROM games')).toHaveLength(1);
    expect(await db.query('SELECT round FROM game_rounds')).toHaveLength(2);
  });

  it('saves only once when the two copies arrive together', async () => {
    // Each save lingers after looking for an earlier copy, so on a real server the two overlap.
    const slow = pausingAfter(db, /FROM games/);
    const results = await Promise.all([saveGame(slow, player, game([4000]), NOW), saveGame(slow, player, game([4000]), NOW)]);
    expect(results.map((result) => result?.created).sort()).toEqual([false, true]);
    expect(await db.query('SELECT id FROM games')).toHaveLength(1);
  });

  it('counts the same seed again once the window has passed', async () => {
    await saveGame(db, player, game([4000]), NOW);
    expect((await saveGame(db, player, game([4000]), NOW + DUPLICATE_WINDOW_MS - 1))?.created).toBe(false);
    expect((await saveGame(db, player, game([4000]), NOW + DUPLICATE_WINDOW_MS))?.created).toBe(true);
    expect(await db.query('SELECT id FROM games')).toHaveLength(2);
  });

  it.each([
    ['seed', { seed: 'seed2' }],
    ['map', { map: 'europe' }],
    ['mode', { mode: 'nmpz' }],
    ['time limit', { timeLimit: 60 }],
  ] as const)('treats a different %s as a different game', async (_name, change) => {
    await saveGame(db, player, game([4000]), NOW);
    expect((await saveGame(db, player, game([4000], change), NOW + 1))?.created).toBe(true);
  });

  it('keeps two players with the same seed apart', async () => {
    const friend = await addUser('friend');
    await saveGame(db, player, game([4000]), NOW);
    expect((await saveGame(db, friend, game([3000]), NOW + 1))?.created).toBe(true);
    expect((await statsFor(db, friend)).bestRoundScore).toBe(3000);
  });

  it('is null, and saves nothing, for an account that no longer exists', async () => {
    expect(await saveGame(db, randomUUID(), game([4000]), NOW)).toBeNull();
    expect(await db.query('SELECT id FROM games')).toHaveLength(0);
  });
});

describe('saveGame and the cap on solo XP', () => {
  it('pays what is left under the day’s cap, stores that as what the game earned, and says it was cut', async () => {
    await nearlyCapped();
    expect(await saveGame(db, player, game([5000, 5000]), NOW)).toMatchObject({ created: true, xpEarned: 50, xpCapped: true });
    expect(await saveGame(db, player, game([5000], { seed: 'b' }), NOW + MINUTE)).toMatchObject({ created: true, xpEarned: 0, xpCapped: true });
    expect(await db.query('SELECT xp_earned FROM games ORDER BY played_at')).toEqual([{ xp_earned: 50 }, { xp_earned: 0 }]);
    expect(await xpOf()).toBe(20_000);
  });

  it('says of a repeat what it said of the first save', async () => {
    await nearlyCapped();
    await saveGame(db, player, game([5000, 5000]), NOW);
    expect(await saveGame(db, player, game([5000, 5000]), NOW + 1000)).toMatchObject({ created: false, xpEarned: 50, xpCapped: true });
    expect(await xpOf()).toBe(20_000);
  });

  it('does not say a game on a map a player made was cut: it earns nothing anyway', async () => {
    await nearlyCapped();
    const community = game([5000, 5000], { map: 'community:paris-abc123' });
    expect(await saveGame(db, player, community, NOW)).toMatchObject({ xpEarned: 0, xpCapped: false });
    expect(await saveGame(db, player, community, NOW + 1000)).toMatchObject({ created: false, xpEarned: 0, xpCapped: false });
    expect(await xpOf()).toBe(19_950);
  });
});

describe('saveGame for a daily', () => {
  const TODAY = '2027-01-15';
  const daily = (scores: number[] = [4000, 0, 0]) => game(scores, { timeLimit: 60, seed: 'daily20270115', daily: TODAY });

  it('is refused when the account has not begun that day’s challenge', async () => {
    expect(await save(db, player, daily(), NOW)).toBe('unstarted');
    await beginDaily(db, player, '2027-01-14', NOW - 60 * MINUTE);
    expect(await save(db, player, daily(), NOW)).toBe('unstarted');
    expect(await db.query('SELECT id FROM games')).toEqual([]);
  });

  it('is refused sooner than six seconds after it was begun, and saved from then on', async () => {
    await beginDaily(db, player, TODAY, NOW);
    expect(await save(db, player, daily(), NOW + 5999)).toBe('too-soon');
    expect(await db.query('SELECT id FROM games')).toEqual([]);
    expect(await save(db, player, daily(), NOW + 6000)).toMatchObject({ created: true, xpEarned: 80 });
  });

  it('is answered with the day’s result when there is one, begun or not, and however soon', async () => {
    await beginDaily(db, player, TODAY, NOW);
    const first = await saveGame(db, player, daily(), NOW + 6000);
    await db.query('DELETE FROM daily_attempts');
    expect(await save(db, player, daily([5000, 5000, 5000]), NOW + 6001)).toEqual({ ...first, created: false });
  });

  it('keeps one result when two arrive together', async () => {
    await beginDaily(db, player, TODAY, NOW);
    const slow = pausingAfter(db, /FROM games/);
    const results = await Promise.all([saveGame(slow, player, daily([1000, 0, 0]), NOW + 6000), saveGame(slow, player, daily([2000, 0, 0]), NOW + 6000)]);
    expect(results.map((result) => result?.created).sort()).toEqual([false, true]);
    expect(await db.query('SELECT id FROM games')).toHaveLength(1);
  });
});

describe('saveRun', () => {
  const run = (change: Partial<Run> = {}): Run => ({ kind: 'streak', id: 'a'.repeat(32), count: 7, paid: true, ...change });
  const bests = async () => (await db.query('SELECT xp, best_streak, best_country, best_continent FROM users WHERE id = $1', [player]))[0];

  it('pays a streak 20 XP a country and keeps it as the best', async () => {
    expect(await saveRun(db, player, run(), NOW)).toEqual({ best: 7, count: 7, xpEarned: 140, xpCapped: false });
    expect(await bests()).toEqual({ xp: 140, best_streak: 7, best_country: 0, best_continent: 0 });
    expect(await db.query('SELECT seed, streak, xp_earned, kind FROM streak_runs')).toEqual([{ seed: 'a'.repeat(32), streak: 7, xp_earned: 140, kind: 'streak' }]);
  });

  it.each([
    ['country', 'best_country'],
    ['continent', 'best_continent'],
  ] as const)('pays a %s guesser 20 XP an answer and keeps its points as the best', async (kind, column) => {
    expect(await saveRun(db, player, run({ kind, count: 6 }), NOW)).toEqual({ best: 6000, count: 6, xpEarned: 120, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 120, [column]: 6000, best_streak: 0 });
  });

  it('counts a run once: finished again it answers with what it came to and pays nothing', async () => {
    await saveRun(db, player, run(), NOW);
    expect(await saveRun(db, player, run({ count: 400 }), NOW + MINUTE)).toEqual({ best: 7, count: 7, xpEarned: 0, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 140, best_streak: 7 });
    expect(await db.query('SELECT streak FROM streak_runs')).toEqual([{ streak: 7 }]);
  });

  it('counts a run once when two copies of it arrive together', async () => {
    const slow = pausingAfter(db, /FROM streak_runs/);
    const results = await Promise.all([saveRun(slow, player, run(), NOW), saveRun(slow, player, run(), NOW)]);
    expect(results.map((result) => result?.xpEarned).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 140]);
    expect(await bests()).toMatchObject({ xp: 140 });
    expect(await db.query('SELECT seed FROM streak_runs')).toHaveLength(1);
  });

  it('tells two accounts’ runs apart, and two runs of one account', async () => {
    const friend = await addUser('friend');
    await saveRun(db, player, run(), NOW);
    expect(await saveRun(db, friend, run(), NOW)).toMatchObject({ xpEarned: 140 });
    expect(await saveRun(db, player, run({ id: 'b'.repeat(32), count: 3 }), NOW)).toEqual({ best: 7, count: 3, xpEarned: 60, xpCapped: false });
  });

  it('sets the best, is kept, and pays nothing when the run is not a paid one', async () => {
    expect(await saveRun(db, player, run({ paid: false }), NOW)).toEqual({ best: 7, count: 7, xpEarned: 0, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 0, best_streak: 7 });
    expect(await db.query('SELECT streak, xp_earned FROM streak_runs')).toEqual([{ streak: 7, xp_earned: 0 }]);
  });

  it('pays what is left under the day’s cap on solo XP, and says so', async () => {
    await nearlyCapped();
    expect(await saveRun(db, player, run(), NOW)).toEqual({ best: 7, count: 7, xpEarned: 50, xpCapped: true });
    expect(await saveRun(db, player, run({ id: 'b'.repeat(32) }), NOW)).toEqual({ best: 7, count: 7, xpEarned: 0, xpCapped: true });
    expect(await saveRun(db, player, run({ id: 'c'.repeat(32), count: 0 }), NOW)).toEqual({ best: 7, count: 0, xpEarned: 0, xpCapped: false });
    expect(await bests()).toMatchObject({ xp: 20_000 });
  });

  it('is null, and keeps nothing, for an account that no longer exists', async () => {
    expect(await saveRun(db, randomUUID(), run(), NOW)).toBeNull();
    expect(await db.query('SELECT seed FROM streak_runs')).toEqual([]);
  });
});

describe('statsFor', () => {
  it('is all zeros before the first game', async () => {
    expect(await statsFor(db, player)).toEqual({
      gamesPlayed: 0,
      roundsPlayed: 0,
      averageRoundScore: 0,
      bestRoundScore: 0,
      perfectRounds: 0,
      bestGame: null,
    });
  });

  it('counts games and rounds, and finds the average, the best round and the perfect ones', async () => {
    await saveGame(db, player, game([5000, 5000, 1001], { seed: 'a' }), NOW);
    await saveGame(db, player, game([0, 4999], { seed: 'b' }), NOW + MINUTE);
    expect(await statsFor(db, player)).toMatchObject({
      gamesPlayed: 2,
      roundsPlayed: 5,
      averageRoundScore: 3200,
      bestRoundScore: 5000,
      perfectRounds: 2,
    });
  });

  it('rounds the average to a whole number', async () => {
    await saveGame(db, player, game([1, 2]), NOW);
    expect((await statsFor(db, player)).averageRoundScore).toBe(2);
    await saveGame(db, player, game([0, 1, 0], { seed: 'b' }), NOW + MINUTE);
    expect((await statsFor(db, player)).averageRoundScore).toBe(1);
  });

  it('picks the best game by share of the maximum, not by raw points', async () => {
    await saveGame(db, player, game([4000, 4000, 4000, 4000, 4000], { seed: 'a' }), NOW);
    await saveGame(db, player, game([4500, 4500, 5000], { seed: 'b' }), NOW + MINUTE);
    await saveGame(db, player, game([100], { seed: 'c' }), NOW + 2 * MINUTE);
    expect((await statsFor(db, player)).bestGame).toEqual({ score: 14_000, maxScore: 15_000 });
  });

  it('prefers the longer game when two share the same ratio', async () => {
    await saveGame(db, player, game([5000], { seed: 'a' }), NOW);
    await saveGame(db, player, game([5000, 5000], { seed: 'b' }), NOW + MINUTE);
    expect((await statsFor(db, player)).bestGame).toEqual({ score: 10_000, maxScore: 10_000 });
  });

  it('counts only the player asked about', async () => {
    const friend = await addUser('friend');
    await saveGame(db, friend, game([5000, 5000]), NOW);
    await saveGame(db, player, game([100]), NOW);
    expect(await statsFor(db, player)).toMatchObject({ gamesPlayed: 1, roundsPlayed: 1, bestRoundScore: 100, perfectRounds: 0 });
  });
});

describe('recentGamesFor', () => {
  it('is empty before the first game', async () => {
    expect(await recentGamesFor(db, player, 10)).toEqual([]);
  });

  it('lists games newest first, with what was played and how it went', async () => {
    await saveGame(db, player, game([1000, 2000], { seed: 'a', map: 'europe', mode: 'no-move' }), NOW);
    await saveGame(db, player, game([5000], { seed: 'b', map: 'asia-oceania', mode: 'nmpz' }), NOW + MINUTE);
    expect(await recentGamesFor(db, player, 10)).toEqual([
      { id: ANY_ID, playedAt: new Date(NOW + MINUTE).toISOString(), map: 'asia-oceania', mode: 'nmpz', rounds: 1, score: 5000, maxScore: 5000 },
      { id: ANY_ID, playedAt: new Date(NOW).toISOString(), map: 'europe', mode: 'no-move', rounds: 2, score: 3000, maxScore: 10_000 },
    ]);
  });

  it('stops at the limit and leaves out other players', async () => {
    const friend = await addUser('friend');
    await saveGame(db, friend, game([1]), NOW);
    for (let index = 0; index < 4; index += 1) {
      await saveGame(db, player, game([index], { seed: `s${index}` }), NOW + index * MINUTE);
    }
    const recent = await recentGamesFor(db, player, 3);
    expect(recent.map((entry) => entry.score)).toEqual([3, 2, 1]);
  });
});
