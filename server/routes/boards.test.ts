import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuest } from '../account/identity.js';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { addXp } from '../db/progress.js';
import { insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { socialGet } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MIDNIGHT = Date.UTC(2027, 0, 15);

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

/** An account made `madeAt`, with whatever standing it is given, and a browser signed in to it. */
async function signUp(username: string, standing: Record<string, unknown> = {}, madeAt = NOW): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: madeAt });
  for (const [column, value] of Object.entries(standing)) {
    // Column names here come from the tests below, never from input.
    await db.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [id, value]);
  }
  ids.set(username, id);
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, madeAt, TEST_SECRET)}`);
  return id;
}

const idOf = (username: string): string => ids.get(username) ?? '';
const board = async (query: string, as: string | null = null, now = NOW) => {
  const response = await socialGet(apiRequest('GET', `/api/social?leaderboard=${query}`, { cookie: as === null ? undefined : cookies.get(as) }), at(now));
  const body = await response.json();
  if (!body.success) {
    throw new Error(body.error);
  }
  return body.data;
};
const names = (seen: { entries: Array<{ username: string }> }): string[] => seen.entries.map((entry) => entry.username);
const placed = (seen: { entries: Array<{ rank: number; username: string; value: number }> }) => seen.entries.map((entry) => [entry.rank, entry.username, entry.value]);

/** A ranked duel in the history of `username`, which moved their rating from `before` to `after`. */
async function duel(username: string, before: number | null, after: number | null, playedAt: number): Promise<void> {
  await db.query(
    `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, result, score, max_score, rating_before, rating_after, players, rounds)
     VALUES ($1, $2, $3, 'ranked', 'world', 'move', 60, $4, 'win', 0, 25000, $5, $6, 2, '[]'::jsonb)`,
    [randomUUID(), idOf(username), randomUUID(), new Date(playedAt), before, after],
  );
}

async function run(username: string, kind: string, streak: number, playedAt: number): Promise<void> {
  await db.query('INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at, kind) VALUES ($1, $2, $3, 0, $4, $5)', [
    idOf(username),
    randomUUID().slice(0, 8),
    streak,
    new Date(playedAt),
    kind,
  ]);
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
});

describe('an all-time leaderboard', () => {
  it('is what is shown when no period is asked for, and says so', async () => {
    await signUp('neel', { xp: 300 });
    expect(await board('xp')).toEqual(await board('xp&period=all'));
    expect((await board('xp')).period).toBe('all');
  });

  it('leaves out an account not seen for 14 days, and puts it back when it is seen again', async () => {
    await signUp('regular', { xp: 300, last_seen_at: new Date(NOW - 14 * DAY + 1) });
    await signUp('lapsed', { xp: 900, last_seen_at: new Date(NOW - 14 * DAY) });
    // Never seen at all: an account goes by when it was made.
    await signUp('newcomer', { xp: 100 }, NOW - DAY);
    await signUp('abandoned', { xp: 800 }, NOW - 15 * DAY);
    expect(placed(await board('xp'))).toEqual([
      [1, 'regular', 300],
      [2, 'newcomer', 100],
    ]);
    expect((await board('xp', 'regular')).you).toEqual({ rank: 1, value: 300 });
    expect((await board('xp', 'lapsed')).you).toBeNull();

    await db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [idOf('lapsed'), new Date(NOW)]);
    expect(names(await board('xp'))).toEqual(['lapsed', 'regular', 'newcomer']);
    expect((await board('xp', 'lapsed')).you).toEqual({ rank: 1, value: 900 });
  });

  it('applies the same rule to every board', async () => {
    const standing = { xp: 500, rating: 900, rated_games: 3, best_streak: 8 };
    await signUp('regular', standing);
    await signUp('lapsed', { ...standing, last_seen_at: new Date(NOW - 20 * DAY) });
    for (const name of ['rating', 'xp', 'streak']) {
      expect(names(await board(name))).toEqual(['regular']);
    }
  });

  it('puts them back when asked to show inactive players, each where they stand among everyone, and says it did', async () => {
    await signUp('regular', { xp: 300, last_seen_at: new Date(NOW - DAY) });
    await signUp('lapsed', { xp: 900, last_seen_at: new Date(NOW - 14 * DAY) });
    await signUp('abandoned', { xp: 800 }, NOW - 400 * DAY);
    await signUp('never_played', {}, NOW - 400 * DAY);

    const everyone = await board('xp&inactive=1', 'regular');
    expect(everyone.inactive).toBe(true);
    expect(placed(everyone)).toEqual([
      [1, 'lapsed', 900],
      [2, 'abandoned', 800],
      [3, 'regular', 300],
    ]);
    expect(everyone.you).toEqual({ rank: 3, value: 300 });
    expect((await board('xp&period=all&inactive=1', 'lapsed')).you).toEqual({ rank: 1, value: 900 });

    const active = await board('xp', 'regular');
    expect(active.inactive).toBe(false);
    expect(active.you).toEqual({ rank: 1, value: 300 });
    expect((await board('xp', 'lapsed')).you).toBeNull();
  });

  it('shows inactive players on every board, and still nobody banned, deleted or a guest', async () => {
    const standing = { xp: 500, rating: 900, rated_games: 3, best_streak: 8, last_seen_at: new Date(NOW - 20 * DAY) };
    await signUp('lapsed', standing);
    await signUp('banned', { ...standing, banned: true });
    await signUp('deleted', { ...standing, deleted_at: new Date(NOW - DAY) });
    const guest = await createGuest(db, NOW - 20 * DAY);
    await db.query('UPDATE users SET xp = 900, rating = 900, rated_games = 1, best_streak = 9, last_seen_at = $2 WHERE id = $1', [guest.userId, new Date(NOW - 20 * DAY)]);
    for (const name of ['rating', 'xp', 'streak']) {
      expect(names(await board(`${name}&inactive=1`))).toEqual(['lapsed']);
    }
  });

  it.each(['0', '', 'true', 'yes', '1;drop'])('shows them only for inactive=1, not for inactive=%j', async (inactive) => {
    await signUp('lapsed', { xp: 900, last_seen_at: new Date(NOW - 20 * DAY) });
    const seen = await board(`xp&inactive=${inactive}`);
    expect(seen.inactive).toBe(false);
    expect(names(seen)).toEqual([]);
  });

  it('has no guests on it', async () => {
    await signUp('neel', { xp: 300 });
    const guest = await createGuest(db, NOW);
    await db.query('UPDATE users SET xp = 900, rating = 900, rated_games = 1, best_streak = 9 WHERE id = $1', [guest.userId]);
    for (const name of ['rating', 'xp', 'streak']) {
      expect(names(await board(name))).not.toContain(guest.username);
    }
    expect((await board('xp', 'neel')).you).toEqual({ rank: 1, value: 300 });
  });
});

describe('a leaderboard of the day', () => {
  it('ranks by the XP earned today, not the XP held', async () => {
    await signUp('veteran', { xp: 9000 });
    await signUp('grinder');
    await signUp('idle', { xp: 4000 });
    await addXp(db, idOf('veteran'), 500, NOW - DAY);
    await addXp(db, idOf('veteran'), 100, NOW);
    await addXp(db, idOf('veteran'), 50, NOW + HOUR);
    await addXp(db, idOf('grinder'), 700, NOW);
    await db.query("UPDATE users SET country = 'BR' WHERE id = $1", [idOf('grinder')]);

    expect(await board('xp&period=day', 'veteran', NOW + 2 * HOUR)).toEqual({
      board: 'xp',
      period: 'day',
      inactive: false,
      entries: [
        { rank: 1, username: 'grinder', country: 'BR', value: 700, level: 2, league: 'Trekker' },
        { rank: 2, username: 'veteran', country: null, value: 150, level: 7, league: 'Trekker' },
      ],
      you: { rank: 2, value: 150 },
    });
    expect((await board('xp&period=day', 'idle', NOW + 2 * HOUR)).you).toBeNull();
  });

  it('takes no notice of being asked to show inactive players, and says it did not', async () => {
    await signUp('grinder');
    await signUp('lapsed', { xp: 900, last_seen_at: new Date(NOW - 20 * DAY) });
    await addXp(db, idOf('grinder'), 700, NOW);
    const seen = await board('xp&period=day&inactive=1', null, NOW + HOUR);
    expect(seen.inactive).toBe(false);
    expect(seen).toEqual(await board('xp&period=day', null, NOW + HOUR));
    expect(names(seen)).toEqual(['grinder']);
  });

  it('starts again at midnight UTC', async () => {
    await signUp('neel');
    await addXp(db, idOf('neel'), 300, MIDNIGHT + DAY - 1);
    expect(placed(await board('xp&period=day', null, MIDNIGHT + DAY - 1))).toEqual([[1, 'neel', 300]]);
    expect(placed(await board('xp&period=day', null, MIDNIGHT + DAY))).toEqual([]);
    await addXp(db, idOf('neel'), 20, MIDNIGHT + DAY);
    expect(placed(await board('xp&period=day', null, MIDNIGHT + DAY))).toEqual([[1, 'neel', 20]]);
  });

  it('ranks by the rating gained today over all of the day’s duels, and lists nobody who did not come out ahead', async () => {
    await signUp('climber', { rating: 560, rated_games: 3 });
    await signUp('steady', { rating: 1500, rated_games: 40 });
    await signUp('faller', { rating: 480, rated_games: 2 });
    await signUp('level', { rating: 500, rated_games: 2 });
    await duel('climber', 500, 540, NOW);
    await duel('climber', 540, 520, NOW + HOUR);
    await duel('climber', 520, 560, NOW + 2 * HOUR);
    await duel('steady', 1490, 1500, NOW);
    await duel('steady', 1300, 1490, MIDNIGHT - 1);
    await duel('faller', 500, 480, NOW);
    await duel('level', 500, 520, NOW);
    await duel('level', 520, 500, NOW + HOUR);
    // A duel that was called off changed nobody's rating.
    await duel('level', null, null, NOW + HOUR);

    const seen = await board('rating&period=day', 'steady', NOW + 3 * HOUR);
    expect(placed(seen)).toEqual([
      [1, 'climber', 60],
      [2, 'steady', 10],
    ]);
    expect(seen.entries[1]).toMatchObject({ league: 'Nomad' });
    expect(seen.you).toEqual({ rank: 2, value: 10 });
    expect((await board('rating&period=day', 'faller', NOW + 3 * HOUR)).you).toBeNull();
  });

  it('ranks by the best streak run made today, whatever the best ever, and counts no other kind of run', async () => {
    await signUp('champion', { best_streak: 80 });
    await signUp('today', { best_streak: 12 });
    await signUp('guesser');
    await run('champion', 'streak', 80, MIDNIGHT - 1);
    await run('champion', 'streak', 4, NOW);
    await run('today', 'streak', 7, NOW);
    await run('today', 'streak', 12, NOW + HOUR);
    await run('today', 'streak', 0, NOW + 2 * HOUR);
    await run('guesser', 'country', 9, NOW);
    await run('guesser', 'streak', 0, NOW);
    expect(placed(await board('streak&period=day', null, NOW + 3 * HOUR))).toEqual([
      [1, 'today', 12],
      [2, 'champion', 4],
    ]);
  });

  it('breaks a tie by who made their account first, shows the top 100, and tells a player further down their place', async () => {
    for (let index = 0; index < 103; index += 1) {
      await signUp(`player${index}`, {}, NOW - index);
      await addXp(db, idOf(`player${index}`), index < 3 ? 50 : 40, NOW);
    }
    const seen = await board('xp&period=day', 'player3');
    expect(seen.entries).toHaveLength(100);
    expect(placed(seen).slice(0, 4)).toEqual([
      [1, 'player2', 50],
      [2, 'player1', 50],
      [3, 'player0', 50],
      [4, 'player102', 40],
    ]);
    expect(seen.you).toEqual({ rank: 103, value: 40 });
  });

  it('has no banned, deleted or guest players on it', async () => {
    await signUp('neel');
    await signUp('cheat', { banned: true });
    await signUp('gone', { deleted_at: new Date(NOW) });
    const guest = await createGuest(db, NOW);
    ids.set('guest', guest.userId);
    for (const name of ['neel', 'cheat', 'gone', 'guest']) {
      await duel(name, 500, 530, NOW);
      await run(name, 'streak', 5, NOW);
      await db.query("INSERT INTO progress_days (user_id, day, xp, rating, xp_gained) VALUES ($1, '2027-01-15', 200, 530, 200)", [idOf(name)]);
    }
    for (const name of ['rating', 'xp', 'streak']) {
      expect(names(await board(`${name}&period=day`, 'cheat'))).toEqual(['neel']);
      expect((await board(`${name}&period=day`, 'cheat')).you).toBeNull();
    }
  });

  it('does not leave out a player for not having been seen: playing today is being there', async () => {
    await signUp('quiet', { last_seen_at: new Date(NOW - 20 * DAY) });
    await addXp(db, idOf('quiet'), 60, NOW);
    expect(names(await board('xp&period=day'))).toEqual(['quiet']);
  });
});

describe('a leaderboard’s period', () => {
  it.each(['week', '', 'all;drop'])('cannot be %j', async (period) => {
    const response = await socialGet(apiRequest('GET', `/api/social?leaderboard=xp&period=${period}`), at(NOW));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Ask for a period of all or day.' });
  });
});
