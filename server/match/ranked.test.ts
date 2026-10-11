import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import type { Waiting } from '../db/queue.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { getMatch, guess, leaveMatch, postPlaces } from './play.js';
import { rate } from './elo.js';
import { joinQueue, leaveQueue, pollQueue, rankedPairs, windowAfter } from './queue.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import {
  COUNTDOWN_MS,
  INACTIVE_AFTER_MS,
  LAST_REVEAL_MS,
  PREPARE_MS,
  RANKED_CUT_MS,
  RANKED_REVEAL_MS,
  type MatchState,
  type QueueState,
  type Reply,
} from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const R0 = T + COUNTDOWN_MS;
const BETWEEN_ROUNDS_MS = RANKED_REVEAL_MS + COUNTDOWN_MS;
const SCALE_KM = 20_000;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
/** The other side of the world from Paris: as far as a guess can be, and worth nothing. */
const FAR = { lng: 2.3522 - 180, lat: -48.8566 };
const scoreFrom = (spot: Spot): number => scoreForDistance(distanceKm(PARIS, spot), SCALE_KM);
const LONDON_SCORE = scoreFrom(LONDON);
/** Five rounds, every one of them in Paris. */
const PLACES = Array.from({ length: 5 }, (_unused, index) => ({ id: `paris-${index}`, ...PARIS, country: 'FR' }));

let db: Db;
let alice: string;
let bob: string;
let carol: string;

async function addUser(username: string, rating = 500): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: T });
  await db.query('UPDATE users SET rating = $2 WHERE id = $1', [id, rating]);
  return id;
}

function yes<T>(reply: Reply<T>): T {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const queue = (userId: string, now: number, on: Db = db): Promise<QueueState> => joinQueue(on, userId, 'ranked', now).then(yes);
const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const pin = (userId: string, matchId: string, round: number, where: Spot, now: number, on: Db = db) =>
  guess(on, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const health = (seen: MatchState) => seen.players.map((player) => player.health);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
const accounts = async () =>
  Object.fromEntries(
    (await stored('SELECT username, rating, rated_games, xp, duel_wins, duel_losses, duel_ties FROM users')).map((row) => [
      row.username,
      { rating: row.rating, games: row.rated_games, xp: row.xp, record: [row.duel_wins, row.duel_losses, row.duel_ties] },
    ]),
  );

/** A ranked duel between alice (who picks the places) and bob, made at `at`, with no places yet. */
async function matched(at = T): Promise<string> {
  await queue(alice, at - 1);
  const { matchId } = await queue(bob, at);
  if (matchId === null) {
    throw new Error('no match was made');
  }
  return matchId;
}

/** A ranked duel whose first round runs from `at` + the get-ready. */
async function duel(at = T): Promise<string> {
  const matchId = await matched(at);
  yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: SCALE_KM }, at));
  return matchId;
}

/**
 * Plays `count` rounds from the first, each player guessing in the same spot
 * every round, one round straight after the reveal of the last. Returns the
 * state after the last guess, and when that round's reveal would end were it
 * not the match's last.
 */
async function play(matchId: string, count: number, aliceAt: Spot, bobAt: Spot, start = R0): Promise<{ last: MatchState; at: number }> {
  let at = start;
  let last = await state(alice, matchId, at);
  for (let round = 0; round < count; round += 1) {
    await pin(alice, matchId, round, aliceAt, at);
    last = await pin(bob, matchId, round, bobAt, at);
    at += round === count - 1 ? 0 : BETWEEN_ROUNDS_MS;
  }
  return { last, at };
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol')]);
});

describe('a ranked duel', () => {
  it('is five rounds at most, moving allowed, reactions only, both players starting at 500 with 5000 health', async () => {
    const matchId = await matched();
    const before = await state(bob, matchId, T);
    expect(before.settings).toEqual({ map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'reactions', teams: 'none', guests: true });
    expect(before.players.map((player) => [player.rating, player.health])).toEqual([
      [500, 5000],
      [500, 5000],
    ]);
    expect(await postPlaces(db, alice, { matchId, places: [...PLACES, ...PLACES], scaleKm: SCALE_KM }, T)).toMatchObject({ ok: false, status: 400 });
  });

  it('takes the difference from the lower scorer when the round is revealed, and shows nothing before', async () => {
    const matchId = await duel();
    expect(health(await pin(alice, matchId, 0, PARIS, R0))).toEqual([5000, 5000]);
    const revealed = await pin(bob, matchId, 0, LONDON, R0 + SECOND);
    expect(revealed).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(R0 + SECOND + RANKED_REVEAL_MS).toISOString() });
    expect(health(revealed)).toEqual([5000, LONDON_SCORE]);
  });

  it('leaves the second player 15 seconds once the first has guessed', async () => {
    const matchId = await duel();
    const after = await pin(alice, matchId, 0, PARIS, R0 + 2 * SECOND);
    expect(after.roundEndsAt).toBe(new Date(R0 + 2 * SECOND + RANKED_CUT_MS).toISOString());
    // With less than that left already, nothing changes.
    const later = await duel2();
    expect(later).toBe(new Date(R0 + 60 * SECOND).toISOString());

    async function duel2(): Promise<string | null> {
      await resetDb(db);
      [alice, bob] = await Promise.all([addUser('alice'), addUser('bob')]);
      const other = await duel();
      await state(bob, other, R0 + 25 * SECOND);
      return (await pin(alice, other, 0, PARIS, R0 + 50 * SECOND)).roundEndsAt;
    }
  });

  it('is over when a player runs out of health: that round is shown for 5 seconds, and no other is played', async () => {
    const matchId = await duel();
    const { last, at } = await play(matchId, 1, PARIS, FAR);
    expect(last).toMatchObject({ phase: 'reveal', round: 0, outcome: null, revealEndsAt: new Date(at + LAST_REVEAL_MS).toISOString() });
    expect(health(last)).toEqual([5000, 0]);
    expect((await state(alice, matchId, at + LAST_REVEAL_MS - 1)).phase).toBe('reveal');

    const finished = await state(bob, matchId, at + LAST_REVEAL_MS);
    expect(finished).toMatchObject({ phase: 'finished', round: 0 });
    expect(finished.outcome).toEqual({
      winners: ['alice'],
      ratingChanges: [
        { username: 'alice', before: 500, after: 520 },
        { username: 'bob', before: 500, after: 480 },
      ],
      dodgedBy: null,
    });
    expect(finished.players.map((player) => player.rating)).toEqual([520, 480]);
    expect(await accounts()).toMatchObject({
      alice: { rating: 520, games: 1, record: [1, 0, 0] },
      bob: { rating: 480, games: 1, record: [0, 1, 0] },
      carol: { rating: 500, games: 0, record: [0, 0, 0] },
    });
  });

  it('goes to the player with more health after five rounds', async () => {
    const matchId = await duel();
    const { last, at } = await play(matchId, 5, LONDON, PARIS);
    const left = 5000 - 5 * (5000 - LONDON_SCORE);
    expect(left).toBeGreaterThan(0);
    expect(health(last)).toEqual([left, 5000]);
    const finished = await state(alice, matchId, at + LAST_REVEAL_MS);
    expect(finished).toMatchObject({ phase: 'finished', round: 4, outcome: { winners: ['bob'] } });
    expect(finished.results).toHaveLength(5);
  });

  it('is a draw when both have the same health after five rounds: a rated game, counted as a tie', async () => {
    const matchId = await duel();
    const { at } = await play(matchId, 5, LONDON, LONDON);
    expect((await state(alice, matchId, at + LAST_REVEAL_MS)).outcome).toEqual({
      winners: [],
      ratingChanges: [
        { username: 'alice', before: 500, after: 500 },
        { username: 'bob', before: 500, after: 500 },
      ],
      dodgedBy: null,
    });
    expect(await accounts()).toMatchObject({ alice: { games: 1, record: [0, 0, 1] }, bob: { games: 1, record: [0, 0, 1] } });
  });

  it('pays double XP for each round guessed', async () => {
    const matchId = await duel();
    const { at } = await play(matchId, 5, LONDON, PARIS);
    await state(alice, matchId, at + LAST_REVEAL_MS);
    expect(await accounts()).toMatchObject({ alice: { xp: 2 * 5 * Math.round(LONDON_SCORE / 50) }, bob: { xp: 2 * 500 } });
  });

  it('moves each player by their own K, from the ratings they came with', async () => {
    await db.query('UPDATE users SET rating = 950, rated_games = 40 WHERE id = $1', [alice]);
    await db.query('UPDATE users SET rating = 930 WHERE id = $1', [bob]);
    const matchId = await duel();
    const { at } = await play(matchId, 1, FAR, PARIS);
    // Expected for alice is about 0.534: she loses round(20 x 0.534) = 11; bob, capped at K 20 from 900, gains round(20 x 0.534) = 11.
    expect((await state(alice, matchId, at + LAST_REVEAL_MS)).outcome?.ratingChanges).toEqual([
      { username: 'alice', before: 950, after: 939 },
      { username: 'bob', before: 930, after: 941 },
    ]);
  });

  it('pays the first three wins over the same opponent in a day in full and the fourth three quarters, the loser losing less too', async () => {
    const seen: Array<{ username: string; before: number; after: number }[]> = [];
    for (const nth of [1, 2, 3, 4]) {
      const at = T + nth * 10 * MINUTE;
      // Alice has waited nine seconds by the time bob arrives, so her window takes in the gap their earlier duels opened.
      await queue(alice, at - 9 * SECOND);
      const matchId = (await queue(bob, at)).matchId ?? '';
      yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: SCALE_KM }, at));
      const { at: ended } = await play(matchId, 1, PARIS, FAR, at + COUNTDOWN_MS);
      seen.push((await state(alice, matchId, ended + LAST_REVEAL_MS)).outcome?.ratingChanges ?? []);
    }
    // Each duel from where the last left the two, by the rule itself.
    let [winner, loser] = [500, 500];
    for (const [index, changes] of seen.entries()) {
      const games = index;
      const after = rate({ rating: winner, games }, { rating: loser, games }, 1, index + 1);
      expect(changes).toEqual([
        { username: 'alice', before: winner, after: after[0] },
        { username: 'bob', before: loser, after: after[1] },
      ]);
      [winner, loser] = after;
    }
    const untrimmed = rate({ rating: seen[3]?.[0]?.before ?? 0, games: 3 }, { rating: seen[3]?.[1]?.before ?? 0, games: 3 }, 1, 1);
    expect((seen[3]?.[0]?.after ?? 0) - (seen[3]?.[0]?.before ?? 0)).toBeLessThan(untrimmed[0] - (seen[3]?.[0]?.before ?? 0));
    expect((seen[3]?.[1]?.before ?? 0) - (seen[3]?.[1]?.after ?? 0)).toBeLessThan((seen[3]?.[1]?.before ?? 0) - untrimmed[1]);
  });

  it('is kept in both accounts\' history, with how it went and what it did to the rating', async () => {
    const matchId = await duel();
    const { at } = await play(matchId, 1, PARIS, FAR);
    await state(alice, matchId, at + LAST_REVEAL_MS);
    const rows = await stored(
      `SELECT u.username, g.kind, g.map, g.mode, g.time_limit, g.result, g.score, g.max_score, g.rating_before, g.rating_after, g.xp_earned, g.players, g.opponent_id, g.rounds
         FROM online_games g JOIN users u ON u.id = g.user_id WHERE g.match_id = $1 ORDER BY u.username`,
      [matchId],
    );
    const base = { kind: 'ranked', map: 'world', mode: 'move', time_limit: 60, max_score: 5000, players: 2 };
    expect(rows).toEqual([
      {
        ...base,
        username: 'alice',
        result: 'win',
        score: 5000,
        rating_before: 500,
        rating_after: 520,
        xp_earned: 200,
        opponent_id: bob,
        rounds: [{ country: 'FR', distanceKm: 0, score: 5000, ...PARIS, guessLng: PARIS.lng, guessLat: PARIS.lat }],
      },
      {
        ...base,
        username: 'bob',
        result: 'loss',
        score: 0,
        rating_before: 500,
        rating_after: 480,
        xp_earned: 0,
        opponent_id: alice,
        rounds: [{ country: 'FR', distanceKm: expect.any(Number), score: 0, ...PARIS, guessLng: FAR.lng, guessLat: FAR.lat }],
      },
    ]);
  });

  it('ends once, moving the ratings and writing the history once, when both players poll as the last reveal ends', async () => {
    const matchId = await duel();
    const { at } = await play(matchId, 1, PARIS, FAR);
    const slow = pausingAfter(db, /FROM matches/);
    const end = at + LAST_REVEAL_MS;
    const seen = await Promise.all([state(alice, matchId, end, slow), state(bob, matchId, end, slow), state(alice, matchId, end, slow)]);
    expect(seen.map((entry) => [entry.phase, entry.outcome?.winners])).toEqual(Array.from({ length: 3 }, () => ['finished', ['alice']]));
    await state(bob, matchId, end + SECOND);
    expect(await accounts()).toMatchObject({ alice: { rating: 520, games: 1, xp: 200 }, bob: { rating: 480, games: 1 } });
    expect(await stored('SELECT 1 FROM online_games')).toHaveLength(2);
  });

  it('is lost by the player who leaves it once a guess has been made', async () => {
    const matchId = await duel();
    await pin(alice, matchId, 0, PARIS, R0);
    yes(await leaveMatch(db, alice, matchId, R0 + SECOND));
    expect(await state(bob, matchId, R0 + 2 * SECOND)).toMatchObject({ phase: 'finished', outcome: { winners: ['bob'], dodgedBy: null } });
    expect(await accounts()).toMatchObject({ alice: { rating: 480, games: 1 }, bob: { rating: 520, games: 1 } });
  });

  it('is called off as a walk-out by the player who was to post the places when they never come: no rating moves, and the other is back in the queue', async () => {
    const matchId = await matched();
    await state(alice, matchId, T + 20 * SECOND);
    await state(bob, matchId, T + 20 * SECOND);
    expect(await state(bob, matchId, T + PREPARE_MS)).toMatchObject({ phase: 'finished', outcome: { winners: [], ratingChanges: [], dodgedBy: 'alice' } });
    expect(await accounts()).toMatchObject({ alice: { rating: 500, games: 0 }, bob: { rating: 500, games: 0 } });
    expect(await stored('SELECT 1 FROM online_games')).toEqual([]);
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([{ user_id: bob }]);
    expect((await pollQueue(db, alice, T + PREPARE_MS + SECOND)).lockedUntil).toBeNull();
  });

  it('locks a player who lets the places lapse twice in an hour out of the ranked queue, like any other walk-out', async () => {
    const first = await matched();
    await state(bob, first, T + PREPARE_MS);
    await leaveQueue(db, bob, T + PREPARE_MS);
    const again = T + 10 * MINUTE;
    const second = await matched(again);
    await state(bob, second, again + PREPARE_MS);
    expect((await pollQueue(db, alice, again + PREPARE_MS + SECOND)).lockedUntil).toBe(new Date(again + PREPARE_MS + 120 * SECOND).toISOString());
    expect((await joinQueue(db, alice, 'ranked', again + PREPARE_MS + SECOND)).ok).toBe(false);
  });
});

describe('leaving a ranked duel before anyone has guessed', () => {
  it('cancels it with no rating change, names who left, and puts the other player back in the queue', async () => {
    const matchId = await duel();
    yes(await leaveMatch(db, bob, matchId, R0 + SECOND));
    const seen = await state(alice, matchId, R0 + 2 * SECOND);
    expect(seen).toMatchObject({ phase: 'finished', outcome: { winners: [], ratingChanges: [], dodgedBy: 'bob' } });
    expect(await accounts()).toMatchObject({ alice: { rating: 500, games: 0, record: [0, 0, 0] }, bob: { rating: 500, games: 0 } });
    expect(await stored('SELECT user_id, kind FROM match_queue')).toEqual([{ user_id: alice, kind: 'ranked' }]);
    expect(await pollQueue(db, alice, R0 + 3 * SECOND)).toMatchObject({ queued: true, kind: 'ranked', waiting: 1, matchId: null });
  });

  it('is the same when a player just stops polling, and while the places are still being picked', async () => {
    const matchId = await matched();
    const seen = await state(alice, matchId, T + INACTIVE_AFTER_MS);
    expect(seen).toMatchObject({ phase: 'finished', outcome: { winners: [], dodgedBy: 'bob' } });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([{ user_id: alice }]);
  });

  it('locks the player out of the ranked queue for 120 seconds the second time within an hour', async () => {
    const first = await duel();
    yes(await leaveMatch(db, bob, first, R0));
    // Once is forgiven.
    expect((await pollQueue(db, bob, R0 + SECOND)).lockedUntil).toBeNull();
    const again = T + 30 * MINUTE;
    await queue(bob, again - 1);
    const { matchId } = await queue(alice, again);
    yes(await leaveMatch(db, bob, matchId ?? '', again + SECOND));

    const until = again + SECOND + 120 * SECOND;
    expect(await joinQueue(db, bob, 'ranked', again + 2 * SECOND)).toEqual({
      ok: false,
      status: 429,
      error: 'You left two ranked matches before they began. You can queue again in 119 seconds.',
    });
    expect((await pollQueue(db, bob, again + 2 * SECOND)).lockedUntil).toBe(new Date(until).toISOString());
    // Other queues are open to them meanwhile.
    expect(yes(await joinQueue(db, bob, 'unranked', again + 3 * SECOND)).queued).toBe(true);
    expect((await joinQueue(db, bob, 'ranked', until - 1)).ok).toBe(false);
    expect((await queue(bob, until)).queued).toBe(true);
    expect((await pollQueue(db, bob, until)).lockedUntil).toBeNull();
  });

  it('does not lock a player whose two walk-outs are more than an hour apart, nor the player who was walked out on', async () => {
    const first = await duel();
    yes(await leaveMatch(db, bob, first, R0));
    const later = T + 61 * MINUTE;
    await queue(bob, later - 1);
    const { matchId } = await queue(alice, later);
    yes(await leaveMatch(db, bob, matchId ?? '', later + SECOND));
    expect((await queue(bob, later + 2 * SECOND)).lockedUntil).toBeNull();
    expect((await pollQueue(db, alice, later + 2 * SECOND)).lockedUntil).toBeNull();
  });

  it('cancels once, and queues the other player once, when the leave and a poll arrive together', async () => {
    const matchId = await duel();
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([leaveMatch(slow, bob, matchId, R0), state(alice, matchId, R0, slow), state(alice, matchId, R0, slow)]);
    expect((await state(alice, matchId, R0 + SECOND)).outcome).toEqual({ winners: [], ratingChanges: [], dodgedBy: 'bob' });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([{ user_id: alice }]);
    expect(await accounts()).toMatchObject({ alice: { rating: 500, games: 0 }, bob: { rating: 500, games: 0 } });
    // One walk-out, counted once: counted twice it would have locked them out.
    expect(await stored('SELECT ranked_locked_until FROM users WHERE id = $1', [bob])).toEqual([{ ranked_locked_until: null }]);
  });

  it('locks the player out once, from the moment they left, when their second leave and two polls arrive together', async () => {
    yes(await leaveMatch(db, bob, await duel(), R0));
    const again = T + 30 * MINUTE;
    await queue(bob, again - 1);
    const { matchId } = await queue(alice, again);
    const slow = pausingAfter(db, /FROM matches/);
    const left = again + SECOND;
    await Promise.all([leaveMatch(slow, bob, matchId ?? '', left), state(alice, matchId ?? '', left, slow), state(alice, matchId ?? '', left, slow)]);
    expect((await pollQueue(db, bob, left + SECOND)).lockedUntil).toBe(new Date(left + 120 * SECOND).toISOString());
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([{ user_id: alice }]);
  });

  it('is an ordinary loss when the leave lands just after the first guess, whichever of the two requests is first', async () => {
    const matchId = await duel();
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([pin(alice, matchId, 0, PARIS, R0, slow), leaveMatch(slow, bob, matchId, R0)]);
    const { outcome } = await state(alice, matchId, R0 + SECOND);
    // Either the guess was in first (bob lost a rated game) or the leave was (a dodge, nothing rated): never a mix.
    const rated = (await accounts()).alice.games === 1;
    expect(outcome).toMatchObject(rated ? { winners: ['alice'], dodgedBy: null } : { winners: [], ratingChanges: [], dodgedBy: 'bob' });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual(rated ? [] : [{ user_id: alice }]);
  });
});

describe('ranked matchmaking', () => {
  const waiter = (userId: string, rating: number, waitedSeconds: number, last: Partial<Waiting> = {}): Waiting => ({
    userId,
    rating,
    joinedAt: T - waitedSeconds * SECOND,
    groupId: null,
    lastOpponent: null,
    lastRankedAt: null,
    ...last,
  });
  const pairs = (waiting: Waiting[]) => rankedPairs(waiting, T).map((pair) => pair.map((player) => player.userId));

  it('opens a window of 50 either side, 10 wider for each second waited', () => {
    expect([0, 0.9, 1, 5, 34].map((seconds) => windowAfter(T - seconds * SECOND, T))).toEqual([50, 50, 60, 100, 390]);
  });

  it('stops widening at 400 either side, however long the wait', () => {
    expect([35, 36, 125, 3600].map((seconds) => windowAfter(T - seconds * SECOND, T))).toEqual([400, 400, 400, 400]);
    // 1800 and 500 were paired after two minutes of waiting; now they never are.
    expect(pairs([waiter('a', 1800, 3600), waiter('b', 500, 3600)])).toEqual([]);
    expect(pairs([waiter('a', 900, 3600), waiter('b', 500, 3600)])).toEqual([['a', 'b']]);
  });

  it('pairs two players whose ratings are within the wider of their windows', () => {
    expect(pairs([waiter('a', 500, 0), waiter('b', 550, 0)])).toEqual([['a', 'b']]);
    expect(pairs([waiter('a', 500, 0), waiter('b', 551, 0)])).toEqual([]);
    // One of them has waited three seconds: their window is 80, and that is enough for both.
    expect(pairs([waiter('a', 500, 3), waiter('b', 580, 0)])).toEqual([['a', 'b']]);
  });

  it('pairs the closest first, then the next closest among those left', () => {
    const waiting = [waiter('a', 500, 9), waiter('b', 540, 8), waiter('c', 545, 7), waiter('d', 600, 6)];
    expect(pairs(waiting)).toEqual([
      ['b', 'c'],
      ['a', 'd'],
    ]);
  });

  it('keeps two players who have just played each other apart while a third is waiting, and not otherwise', () => {
    const a = waiter('a', 500, 5, { lastOpponent: 'b', lastRankedAt: T - 10 * MINUTE });
    const b = waiter('b', 500, 4, { lastOpponent: 'a', lastRankedAt: T - 10 * MINUTE });
    expect(pairs([a, b])).toEqual([['a', 'b']]);
    // The third is too far away to play either of them, but is waiting all the same.
    expect(pairs([a, b, waiter('c', 2000, 0)])).toEqual([]);
    expect(pairs([a, b, waiter('c', 520, 0)])).toEqual([['a', 'c']]);
    // Half an hour on, it no longer counts.
    const longAgo = { lastRankedAt: T - 30 * MINUTE };
    expect(pairs([{ ...a, ...longAgo }, { ...b, ...longAgo }, waiter('c', 2000, 0)])).toEqual([['a', 'b']]);
  });

  it('tells a waiting player how long they have waited and how wide their window is', async () => {
    carol = await addUser('far_away', 900);
    expect(await queue(alice, T)).toMatchObject({ queued: true, waiting: 1, since: new Date(T).toISOString(), serverNow: new Date(T).toISOString(), window: 50 });
    expect(await queue(carol, T + SECOND)).toMatchObject({ queued: true, waiting: 2, matchId: null, window: 50 });
    expect(await pollQueue(db, alice, T + 7 * SECOND)).toMatchObject({ waiting: 2, since: new Date(T).toISOString(), window: 120 });
  });

  it('pairs two players once the longer wait has widened the window to their gap', async () => {
    const far = await addUser('far_away', 580);
    await queue(alice, T);
    expect((await queue(far, T)).matchId).toBeNull();
    await pollQueue(db, far, T + 2 * SECOND);
    expect((await pollQueue(db, alice, T + 2 * SECOND)).matchId).toBeNull();
    await pollQueue(db, far, T + 3 * SECOND);
    expect((await pollQueue(db, alice, T + 3 * SECOND)).matchId).not.toBeNull();
  });

  it('does not put two players straight back together while someone else waits, and remembers who played whom', async () => {
    const matchId = await duel();
    const { at } = await play(matchId, 1, PARIS, FAR);
    const end = at + LAST_REVEAL_MS;
    await state(alice, matchId, end);
    expect(await stored('SELECT last_ranked_opponent FROM users WHERE id = $1', [alice])).toEqual([{ last_ranked_opponent: bob }]);

    const far = await addUser('far_away', 3000);
    await queue(far, end);
    await queue(alice, end + 1);
    expect((await queue(bob, end + 2)).matchId).toBeNull();
    // The third player gives up: now there is nobody else, and they may play again.
    await db.query('DELETE FROM match_queue WHERE user_id = $1', [far]);
    expect((await pollQueue(db, alice, end + SECOND)).matchId).not.toBeNull();
  });

  it('makes one duel when two polls would each make it from the same two players', async () => {
    for (const [index, userId] of [alice, bob].entries()) {
      await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $4)', [userId, 'ranked', new Date(T + index), new Date(T)]);
    }
    const slow = pausingAfter(db, /queue_gathering|FROM match_queue/);
    const seen = await Promise.all([pollQueue(slow, alice, T), pollQueue(slow, bob, T)]);
    const made = await stored('SELECT id FROM matches');
    expect(made).toHaveLength(1);
    // Both are told of it by the very poll that raced.
    expect(seen.map((reply) => reply.matchId)).toEqual([made[0]?.id, made[0]?.id]);
  });

  it('puts four players polling at once into two duels, each player in exactly one', async () => {
    const dave = await addUser('dave');
    for (const [index, userId] of [alice, bob, carol, dave].entries()) {
      await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $4)', [userId, 'ranked', new Date(T + index), new Date(T)]);
    }
    const slow = pausingAfter(db, /queue_gathering|FROM match_queue/);
    await Promise.all([alice, bob, carol, dave].map((userId) => pollQueue(slow, userId, T)));
    const open = await stored('SELECT user_id, match_id FROM match_players WHERE open');
    expect(open.map((row) => row.user_id).sort()).toEqual([alice, bob, carol, dave].sort());
    expect(new Set(open.map((row) => row.match_id)).size).toBe(2);
    expect(await stored('SELECT 1 FROM match_queue')).toEqual([]);
  });
});
