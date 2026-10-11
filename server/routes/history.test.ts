import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { getMatch, guess, postPlaces } from '../match/play.js';
import { joinQueue, pollQueue } from '../match/queue.js';
import { COUNTDOWN_MS, GATHER_MS, REVEAL_MS, type MatchState, type Reply } from '../match/types.js';
import { streakRounds } from '../games/testing.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, scoredRound, testDb } from '../testing.js';
import { saveGame } from './games.js';
import { socialGet } from './social.js';

// 08:00 UTC on 15 January 2027.
const NOW = 1_800_000_000_000;
const TODAY = '2027-01-15';
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const PARIS = { lng: 2.3522, lat: 48.8566 };
const SYDNEY = { lng: 151.2093, lat: -33.8688 };

let db: Db;
const ids = new Map<string, string>();
const cookies = new Map<string, string>();

const at = (now: number): Context => ({ db, now, secret: TEST_SECRET });

async function signUp(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  ids.set(username, id);
  // Signed late enough to outlast the tests that look months ahead.
  cookies.set(username, `${accountCookieName(true)}=${createAccountSession(id, NOW + 200 * DAY, TEST_SECRET)}`);
  return id;
}

const idOf = (username: string): string => ids.get(username) ?? '';
const play = (username: string, score: number, seed: string, now: number) => {
  const body = { map: 'world', mode: 'move', timeLimit: 0, seed, rounds: [scoredRound(score)] };
  return saveGame(apiRequest('POST', '/api/games', { body, cookie: cookies.get(username) }), at(now));
};
/** A country streak of `streak` countries, begun long enough before `now` to have been played and finished then. */
async function run(username: string, streak: number, now: number): Promise<Response> {
  const post = (body: unknown, when: number) => saveGame(apiRequest('POST', '/api/games', { body, cookie: cookies.get(username) }), at(when));
  const rounds = streakRounds(streak);
  const begun = await post({ action: 'start', kind: 'streak' }, now - rounds.length * 2 * SECOND);
  return post({ kind: 'streak', run: (await begun.json()).data.run, rounds }, now);
}
const history = async (username: string, now = NOW) => (await (await socialGet(apiRequest('GET', `/api/social?profile=${username}`), at(now))).json()).data.history;
/** What a match action answered with, which is where the tests below read the match's own clock from. */
const stateOf = (reply: Reply<MatchState>): MatchState => {
  if (!reply.ok) {
    throw new Error(reply.error);
  }
  return reply.data;
};
const places = (count: number) => Array.from({ length: count }, (_unused, index) => ({ id: `p${index}`, ...PARIS, country: 'FR' }));

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids.clear();
  cookies.clear();
  await signUp('neel');
  await signUp('friend');
});

describe('progress history on a profile', () => {
  it('is empty for an account that has not earned anything', async () => {
    expect(await history('neel')).toEqual([]);
  });

  it('gains a point, with the XP total and the rating, the day a game earns XP', async () => {
    await play('neel', 5000, 'a', NOW);
    expect(await history('neel')).toEqual([{ day: TODAY, xp: 100, rating: 500, xpRank: 1, ratingRank: null }]);
    expect(await history('friend')).toEqual([]);
  });

  it('keeps one point a day, standing at where the day ended', async () => {
    await play('neel', 5000, 'a', NOW);
    await play('neel', 2500, 'b', NOW + HOUR);
    expect((await run('neel', 3, NOW + 2 * HOUR)).status).toBe(200);
    expect(await history('neel', NOW + 3 * HOUR)).toEqual([{ day: TODAY, xp: 100 + 50 + 60, rating: 500, xpRank: 1, ratingRank: null }]);
    expect(await db.query('SELECT day FROM progress_days')).toHaveLength(1);
  });

  it('has a point for each day something changed, oldest first, and none for the days between', async () => {
    await play('neel', 5000, 'a', NOW);
    await play('neel', 5000, 'b', NOW + 3 * DAY);
    await play('neel', 5000, 'c', NOW + 4 * DAY + 20 * HOUR);
    expect(await history('neel', NOW + 5 * DAY)).toEqual([
      { day: '2027-01-15', xp: 100, rating: 500, xpRank: 1, ratingRank: null },
      { day: '2027-01-18', xp: 200, rating: 500, xpRank: 1, ratingRank: null },
      { day: '2027-01-20', xp: 300, rating: 500, xpRank: 1, ratingRank: null },
    ]);
  });

  it('changes day at midnight UTC', async () => {
    const midnight = Date.UTC(2027, 0, 16);
    await play('neel', 5000, 'a', midnight - 1);
    await play('neel', 5000, 'b', midnight);
    expect((await history('neel', midnight)).map((point: { day: string }) => point.day)).toEqual(['2027-01-15', '2027-01-16']);
  });

  it('writes nothing for a game or a run that earned nothing', async () => {
    await play('neel', 0, 'a', NOW);
    expect((await run('neel', 0, NOW)).status).toBe(200);
    expect(await history('neel')).toEqual([]);
  });

  it('goes back 30 days, today included, unless asked for more or less', async () => {
    await play('neel', 5000, 'a', NOW);
    await play('neel', 5000, 'b', NOW + DAY);
    expect(await history('neel', NOW + 29 * DAY)).toHaveLength(2);
    expect(await history('neel', NOW + 30 * DAY)).toEqual([{ day: '2027-01-16', xp: 200, rating: 500, xpRank: 1, ratingRank: null }]);
    expect(await history('neel', NOW + 31 * DAY)).toEqual([]);
    expect(await history('neel&range=all', NOW + 31 * DAY)).toHaveLength(2);
    expect(await history('neel&range=7', NOW + 7 * DAY)).toHaveLength(1);
  });

  it('gains a point for both players, with their new ratings, when a ranked duel ends', async () => {
    const [neel, friend] = [idOf('neel'), idOf('friend')];
    await joinQueue(db, neel, 'ranked', NOW - 1);
    const queued = await joinQueue(db, friend, 'ranked', NOW);
    const matchId = queued.ok ? (queued.data.matchId ?? '') : '';
    const posted = stateOf(await postPlaces(db, neel, { matchId, places: places(5), scaleKm: 14_916.862 }, NOW));
    const round = Date.parse(posted.roundStartsAt ?? '');
    await guess(db, neel, { matchId, round: 0, ...PARIS }, round);
    // A guess on the other side of the world costs all of a player's health, which ends the duel in its first round.
    const revealed = stateOf(await guess(db, friend, { matchId, round: 0, ...SYDNEY }, round));
    expect(await history('neel', round)).toEqual([]);

    const over = Date.parse(revealed.revealEndsAt ?? '');
    expect(stateOf(await getMatch(db, neel, matchId, over)).phase).toBe('finished');
    // Two new players, so each was expected to win half the time: 40 x (1 - 0.5) either way. A ranked round pays double XP.
    expect(await history('neel', over)).toMatchObject([{ day: TODAY, xp: 200, rating: 520, ratingRank: 1 }]);
    expect(await history('friend', over)).toMatchObject([{ day: TODAY, xp: 0, rating: 480 }]);

    // Later the same day the winner earns XP too: still one point, now with both.
    await play('neel', 5000, 'a', NOW + HOUR);
    expect(await history('neel', NOW + HOUR)).toEqual([{ day: TODAY, xp: 300, rating: 520, xpRank: 1, ratingRank: 1 }]);
  });

  it('gains a point for each player who earned XP when a public game ends', async () => {
    const [neel, friend] = [idOf('neel'), idOf('friend')];
    await joinQueue(db, neel, 'unranked', NOW - GATHER_MS);
    await joinQueue(db, friend, 'unranked', NOW - GATHER_MS + 1);
    await pollQueue(db, neel, NOW - GATHER_MS / 2);
    await pollQueue(db, friend, NOW - GATHER_MS / 2);
    const { matchId } = await pollQueue(db, neel, NOW + SECOND);
    await postPlaces(db, neel, { matchId: matchId ?? '', places: places(5), scaleKm: 14_916.862 }, NOW + SECOND);

    let now = NOW + SECOND + COUNTDOWN_MS;
    for (const round of [0, 1, 2, 3, 4]) {
      await guess(db, neel, { matchId: matchId ?? '', round, ...PARIS }, now);
      await guess(db, friend, { matchId: matchId ?? '', round, ...SYDNEY }, now);
      now += round === 4 ? REVEAL_MS : REVEAL_MS + COUNTDOWN_MS;
    }
    await getMatch(db, friend, matchId ?? '', now);
    expect(await history('neel', now)).toEqual([{ day: TODAY, xp: 500, rating: 500, xpRank: 1, ratingRank: null }]);
    // Every one of the loser's guesses was on the other side of the world and scored nothing.
    expect(await history('friend', now)).toEqual([]);
  });
});
