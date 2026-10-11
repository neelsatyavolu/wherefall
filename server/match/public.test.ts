import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty } from './parties.js';
import { getMatch, guess, leaveMatch, postPlaces } from './play.js';
import { joinQueue, leaveQueue, pollQueue } from './queue.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { COUNTDOWN_MS, GATHER_MS, LAST_REVEAL_MS, QUEUE_LAPSE_MS, REVEAL_MS, type MatchState, type QueueState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const SCALE_KM = 14_916.862;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
const SYDNEY = { lng: 151.2093, lat: -33.8688 };
const LONDON_SCORE = scoreForDistance(distanceKm(PARIS, LONDON), SCALE_KM);
const LONDON_XP = Math.round(LONDON_SCORE / 50);
/** Five rounds, every one of them in Paris. */
const PLACES = [0, 1, 2, 3, 4].map((index) => ({ id: `paris-${index}`, ...PARIS, country: 'FR' }));
const NOT_QUEUED = { queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null };
const iso = (ms: number): string => new Date(ms).toISOString();

let db: Db;
let alice: string;
let bob: string;
let carol: string;
let dave: string;

async function addUser(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: T });
  return id;
}

function yes<T>(reply: Reply<T>): T {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const join = (userId: string, now: number, on: Db = db): Promise<QueueState> => joinQueue(on, userId, 'unranked', now).then(yes);
const poll = (userId: string, now: number, on: Db = db): Promise<QueueState> => pollQueue(on, userId, now);
const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const pin = (userId: string, matchId: string, round: number, where: Spot, now: number) =>
  guess(db, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
const openMatches = async () => (await stored('SELECT user_id, match_id FROM match_players WHERE open')).map((row) => [row.user_id, row.match_id]);
const xp = async () => Object.fromEntries((await stored('SELECT username, xp FROM users')).map((row) => [row.username, row.xp]));

/** When the countdown ends for a queue whose second player arrived at T + 1 s. */
const STARTS = T + SECOND + GATHER_MS;

/** Alice waiting from T, bob arriving a second later, and both still there halfway through the countdown. */
async function countingDown(): Promise<void> {
  await join(alice, T);
  await join(bob, T + SECOND);
  await poll(alice, T + 6 * SECOND);
  await poll(bob, T + 6 * SECOND);
}

/** A public game of the given players, alice first (so she picks the places), with its first round running from the time returned. */
async function game(players: string[]): Promise<{ matchId: string; round: number }> {
  for (const [index, userId] of players.entries()) {
    await join(userId, T - GATHER_MS + index);
  }
  for (const userId of players) {
    await poll(userId, T - GATHER_MS / 2);
  }
  const { matchId } = await poll(alice, T + SECOND);
  if (matchId === null) {
    throw new Error('no game was started');
  }
  yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: SCALE_KM }, T + SECOND));
  return { matchId, round: T + SECOND + COUNTDOWN_MS };
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol, dave] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol'), addUser('dave')]);
});

describe('the public queue', () => {
  it('has no countdown while one player waits', async () => {
    const alone = { queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null };
    expect(await join(alice, T)).toEqual(alone);
    expect(await poll(alice, T + 5 * SECOND)).toEqual(alone);
    expect(await poll(alice, T + 14 * SECOND)).toEqual(alone);
    expect(await stored('SELECT id FROM matches')).toEqual([]);
  });

  it('starts a ten second countdown when the second player arrives, which both are told', async () => {
    await join(alice, T);
    const counting = { queued: true, kind: 'unranked', waiting: 2, matchId: null, startsAt: iso(STARTS), since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null };
    expect(await join(bob, T + SECOND)).toEqual(counting);
    expect(await poll(alice, T + 2 * SECOND)).toEqual(counting);
    expect(GATHER_MS).toBe(10_000);
  });

  it('adds anyone who joins during the countdown, without starting it again', async () => {
    await countingDown();
    expect(await join(carol, T + 7 * SECOND)).toEqual({ queued: true, kind: 'unranked', waiting: 3, matchId: null, startsAt: iso(STARTS), since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect((await join(dave, T + 9 * SECOND)).startsAt).toBe(iso(STARTS));
    expect(await poll(alice, T + 10 * SECOND)).toMatchObject({ waiting: 4, startsAt: iso(STARTS) });
  });

  it('starts nothing before the countdown ends, then one game for everyone waiting', async () => {
    await countingDown();
    await join(carol, T + 7 * SECOND);
    expect(await poll(bob, STARTS - 1)).toMatchObject({ queued: true, waiting: 3, matchId: null });
    expect(await stored('SELECT id FROM matches')).toEqual([]);

    const started = await poll(bob, STARTS);
    expect(started).toEqual({ ...NOT_QUEUED, matchId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await poll(alice, STARTS + SECOND)).toMatchObject({ queued: false, matchId: started.matchId });
    expect(await poll(carol, STARTS + SECOND)).toMatchObject({ queued: false, matchId: started.matchId });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);

    const mine = await state(carol, started.matchId ?? '', STARTS + SECOND);
    expect(mine).toMatchObject({
      kind: 'unranked',
      code: null,
      phase: 'preparing',
      settings: { map: 'world', mode: 'move', timeLimit: 45, rounds: 5, communication: 'reactions', teams: 'none', guests: true },
      you: { username: 'carol', isHost: false, isResolver: false, team: null },
    });
    expect(mine.players.map((player) => [player.username, player.team, player.rating, player.health])).toEqual([
      ['alice', null, null, null],
      ['bob', null, null, null],
      ['carol', null, null, null],
    ]);
    expect((await state(alice, started.matchId ?? '', STARTS + SECOND)).you).toMatchObject({ isResolver: true, isHost: false });
  });

  it('takes ten at most, the ones who waited longest, and starts counting again for those left over', async () => {
    const ids = [alice, bob, carol, dave];
    for (let index = 0; index < 8; index += 1) {
      ids.push(await addUser(`extra${index}`));
    }
    for (const [index, userId] of ids.entries()) {
      await join(userId, T + index);
    }
    const starts = T + 1 + GATHER_MS;
    for (const userId of ids) {
      await poll(userId, T + 5 * SECOND);
    }
    const eleventh = ids[10] ?? '';
    const twelfth = ids[11] ?? '';
    // The eleventh player's poll starts the game for the first ten, and a new countdown for the two left.
    expect(await poll(eleventh, starts)).toMatchObject({ queued: true, kind: 'unranked', waiting: 2, matchId: null, startsAt: iso(starts + GATHER_MS) });
    const playing = (await openMatches()).map(([userId]) => userId);
    expect(playing.sort()).toEqual(ids.slice(0, 10).sort());
    expect(new Set((await openMatches()).map(([, matchId]) => matchId)).size).toBe(1);

    await poll(twelfth, starts);
    await poll(twelfth, starts + 5 * SECOND);
    await poll(eleventh, starts + 5 * SECOND);
    expect((await poll(twelfth, starts + GATHER_MS)).matchId).not.toBeNull();
    expect(await openMatches()).toHaveLength(12);
  });

  it('cancels the countdown when a player leaves and only one is left, and gives the next pair a full ten seconds', async () => {
    await countingDown();
    expect(await leaveQueue(db, bob, T + 7 * SECOND)).toEqual({ queued: false });
    expect(await stored('SELECT starts_at FROM queue_gathering')).toEqual([{ starts_at: null }]);
    expect(await poll(alice, T + 8 * SECOND)).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await poll(bob, T + 8 * SECOND)).toEqual(NOT_QUEUED);

    // Past the moment the cancelled countdown would have ended, nothing has started.
    expect(await poll(alice, STARTS + SECOND)).toMatchObject({ queued: true, matchId: null, startsAt: null });
    const arrives = STARTS + 2 * SECOND;
    expect(await join(carol, arrives)).toMatchObject({ waiting: 2, matchId: null, startsAt: iso(arrives + GATHER_MS) });
  });

  it('keeps the countdown going when a player leaves and two are still waiting', async () => {
    await countingDown();
    await join(carol, T + 7 * SECOND);
    await leaveQueue(db, bob, T + 8 * SECOND);
    expect(await poll(alice, T + 9 * SECOND)).toMatchObject({ waiting: 2, startsAt: iso(STARTS) });
    const started = await poll(carol, STARTS);
    expect((await state(carol, started.matchId ?? '', STARTS)).players.map((player) => player.username)).toEqual(['alice', 'carol']);
  });

  it('cancels the countdown when a player stops polling and their entry lapses', async () => {
    await join(alice, T);
    await join(bob, T + SECOND);
    await poll(alice, T + 6 * SECOND);
    // Bob was last seen at T + 1 s, so by the end of the countdown his entry has lapsed.
    expect(await poll(alice, STARTS)).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await stored('SELECT id FROM matches')).toEqual([]);
    expect(QUEUE_LAPSE_MS).toBe(GATHER_MS);
  });

  it('does not start a game at once for a pair who arrive after an old countdown everyone abandoned', async () => {
    await join(alice, T);
    await join(bob, T + SECOND);
    const later = T + 5 * 60 * SECOND;
    expect(await join(carol, later)).toMatchObject({ waiting: 1, startsAt: null });
    expect(await join(dave, later + SECOND)).toMatchObject({ waiting: 2, matchId: null, startsAt: iso(later + SECOND + GATHER_MS) });
  });

  it('lets a waiting player open a party instead, which takes them out of the game being gathered', async () => {
    await countingDown();
    yes(await createParty(db, bob, { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 }, T + 7 * SECOND));
    expect(await poll(alice, T + 8 * SECOND)).toMatchObject({ waiting: 1, startsAt: null });
    expect((await openMatches()).map(([userId]) => userId)).toEqual([bob]);
  });

  it('leaves the ranked and team queues as they were: no countdown', async () => {
    yes(await joinQueue(db, alice, 'ranked', T));
    expect(yes(await joinQueue(db, bob, 'ranked', T + SECOND))).toEqual({ ...NOT_QUEUED, matchId: expect.any(String) });
    expect(yes(await joinQueue(db, carol, 'team', T))).toEqual({ queued: true, kind: 'team', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
  });
});

describe('the public queue under concurrency', () => {
  const slowly = () => pausingAfter(db, /queue_gathering|FROM match_queue/);
  const matches = async () => (await stored('SELECT id FROM matches')).map((row) => row.id);

  it('starts one game when every waiting player polls at the moment the countdown ends', async () => {
    await countingDown();
    await join(carol, T + 7 * SECOND);
    const slow = slowly();
    const seen = await Promise.all([poll(alice, STARTS, slow), poll(bob, STARTS, slow), poll(carol, STARTS, slow)]);

    const [matchId] = await matches();
    expect(await matches()).toHaveLength(1);
    // Each of them is told the match by the very poll that raced, whichever one started it.
    expect(seen).toEqual([0, 1, 2].map(() => ({ ...NOT_QUEUED, matchId })));
    expect((await openMatches()).map(([userId]) => userId).sort()).toEqual([alice, bob, carol].sort());
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
    expect(await stored('SELECT starts_at FROM queue_gathering')).toEqual([{ starts_at: null }]);
  });

  it('puts a third player who joins exactly as the countdown ends in the game or leaves them waiting, never both and never in a second game', async () => {
    await countingDown();
    const slow = slowly();
    const [joined, polled] = await Promise.all([join(carol, STARTS, slow), poll(alice, STARTS, slow)]);

    const [matchId] = await matches();
    expect(await matches()).toHaveLength(1);
    expect(polled).toEqual({ ...NOT_QUEUED, matchId });
    const inIt = (await openMatches()).map(([userId]) => userId);
    const queued = (await stored('SELECT user_id FROM match_queue')).map((row) => row.user_id);
    if (joined.matchId === null) {
      expect(joined).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
      expect(inIt.sort()).toEqual([alice, bob].sort());
      expect(queued).toEqual([carol]);
    } else {
      expect(joined).toEqual({ ...NOT_QUEUED, matchId });
      expect(inIt.sort()).toEqual([alice, bob, carol].sort());
      expect(queued).toEqual([]);
    }
  });

  it('either starts the game or cancels it when one of two players leaves exactly as the countdown ends', async () => {
    await countingDown();
    const slow = slowly();
    const [, polled] = await Promise.all([leaveQueue(slow, bob, STARTS), poll(alice, STARTS, slow)]);

    const open = (await openMatches()).map(([userId]) => userId);
    if (polled.matchId === null) {
      // Bob got out first: alice waits alone, with no countdown, and nothing was started.
      expect(polled).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
      expect(await matches()).toEqual([]);
      expect(open).toEqual([]);
    } else {
      // The game started first: both are in it, and bob learns so when he next asks.
      expect(await matches()).toEqual([polled.matchId]);
      expect(open.sort()).toEqual([alice, bob].sort());
      expect(await poll(bob, STARTS + SECOND)).toEqual({ ...NOT_QUEUED, matchId: polled.matchId });
    }
    expect(await stored('SELECT user_id FROM match_queue WHERE user_id = $1', [bob])).toEqual([]);
  });

  it('starts one game, with or without the leaver, when one of three leaves as the countdown ends and the rest poll', async () => {
    await countingDown();
    await join(carol, T + 7 * SECOND);
    const slow = slowly();
    await Promise.all([leaveQueue(slow, carol, STARTS), poll(alice, STARTS, slow), poll(bob, STARTS, slow)]);

    expect(await matches()).toHaveLength(1);
    const open = (await openMatches()).map(([userId]) => userId).sort();
    expect([[alice, bob].sort(), [alice, bob, carol].sort()]).toContainEqual(open);
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('never puts a player in two games when joins, polls and a leave all arrive as the countdown ends', async () => {
    const eve = await addUser('eve');
    await countingDown();
    await join(carol, T + 7 * SECOND);
    const slow = slowly();
    await Promise.all([poll(alice, STARTS, slow), join(dave, STARTS, slow), poll(bob, STARTS, slow), leaveQueue(slow, carol, STARTS), join(eve, STARTS, slow)]);

    const open = await openMatches();
    const players = open.map(([userId]) => userId);
    const queued = (await stored('SELECT user_id FROM match_queue')).map((row) => row.user_id);
    // Alice and bob were both there when the countdown ended, so whichever request got there first started their game.
    expect(await matches()).toHaveLength(1);
    expect(players).toEqual(expect.arrayContaining([alice, bob]));
    // Nobody is in it twice, nobody is both in it and still waiting, and the two who joined are one or the other.
    expect(new Set(players).size).toBe(players.length);
    expect(players.filter((userId) => queued.includes(userId))).toEqual([]);
    expect([...players, ...queued]).toEqual(expect.arrayContaining([dave, eve]));
    expect(queued).not.toContain(carol);
  });

  it('leaves a player in one match when they open a party just as the countdown ends', async () => {
    await countingDown();
    const slow = slowly();
    const settings = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 } as const;
    const [created] = await Promise.all([createParty(slow, bob, settings, STARTS), poll(alice, STARTS, slow)]);
    expect((await openMatches()).filter(([userId]) => userId === bob)).toHaveLength(1);
    expect(created.ok || created.status === 409).toBe(true);
    expect(await stored('SELECT user_id FROM match_queue WHERE user_id = $1', [bob])).toEqual([]);
  });
});

describe('a public game', () => {
  /** Everyone guesses in their own spot every round. Returns the moment the last reveal ends. */
  async function playOut(matchId: string, firstRound: number, spots: Array<[string, Spot]>): Promise<number> {
    let at = firstRound;
    for (const round of [0, 1, 2, 3, 4]) {
      for (const [userId, spot] of spots) {
        await pin(userId, matchId, round, spot, at);
      }
      at += round === 4 ? LAST_REVEAL_MS : REVEAL_MS + COUNTDOWN_MS;
    }
    return at;
  }

  it('goes to the highest total among however many played, and moves no rating', async () => {
    const { matchId, round } = await game([alice, bob, carol]);
    const end = await playOut(matchId, round, [
      [alice, LONDON],
      [bob, PARIS],
      [carol, SYDNEY],
    ]);
    const finished = await state(carol, matchId, end);
    expect(finished).toMatchObject({ phase: 'finished', outcome: { winners: ['bob'], ratingChanges: [], dodgedBy: null } });
    expect(finished.players.map((player) => player.total)).toEqual([5 * LONDON_SCORE, 25_000, 0]);
    expect(await stored('SELECT DISTINCT rating, rated_games FROM users')).toEqual([{ rating: 500, rated_games: 0 }]);
  });

  it('is a draw when two tie for first', async () => {
    const { matchId, round } = await game([alice, bob, carol]);
    const end = await playOut(matchId, round, [
      [alice, PARIS],
      [bob, PARIS],
      [carol, LONDON],
    ]);
    expect((await state(alice, matchId, end)).outcome).toEqual({ winners: [], ratingChanges: [], dodgedBy: null });
  });

  it('plays on when one of three leaves, and goes to whoever is left when two have', async () => {
    const { matchId, round } = await game([alice, bob, carol]);
    yes(await leaveMatch(db, carol, matchId, round));
    expect((await state(alice, matchId, round)).phase).toBe('playing');
    yes(await leaveMatch(db, bob, matchId, round + SECOND));
    expect(await state(alice, matchId, round + SECOND)).toMatchObject({ phase: 'finished', outcome: { winners: ['alice'], ratingChanges: [], dodgedBy: null } });
  });

  it('credits each player a fiftieth of each of their rounds in XP when it ends, and not before', async () => {
    const { matchId, round } = await game([alice, bob, carol]);
    const end = await playOut(matchId, round, [
      [alice, LONDON],
      [bob, PARIS],
      [carol, SYDNEY],
    ]);
    await state(alice, matchId, end - 1);
    expect(await xp()).toMatchObject({ alice: 0, bob: 0, carol: 0 });
    await state(alice, matchId, end);
    expect(await xp()).toMatchObject({ alice: 5 * LONDON_XP, bob: 500, carol: 0, dave: 0 });
  });

  it('credits the XP once when every player polls at the moment it ends', async () => {
    const { matchId, round } = await game([alice, bob]);
    const end = await playOut(matchId, round, [
      [alice, PARIS],
      [bob, PARIS],
    ]);
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([state(alice, matchId, end, slow), state(bob, matchId, end, slow), state(alice, matchId, end, slow)]);
    await state(bob, matchId, end + SECOND);
    expect(await xp()).toMatchObject({ alice: 500, bob: 500 });
  });

  it('credits the rounds played when it ends early because everyone else left', async () => {
    const { matchId, round } = await game([alice, bob]);
    await pin(alice, matchId, 0, PARIS, round);
    await pin(bob, matchId, 0, PARIS, round);
    yes(await leaveMatch(db, bob, matchId, round + SECOND));
    expect(await xp()).toMatchObject({ alice: 100, bob: 100 });
  });
});
