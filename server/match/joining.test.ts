import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty } from './parties.js';
import { getMatch, guess, leaveMatch, postPlaces, startMatch } from './play.js';
import { joinQueue, pollQueue } from './queue.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { COUNTDOWN_MS, GATHER_MS, INACTIVE_AFTER_MS, REVEAL_MS, type MatchState, type QueueState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const SCALE_KM = 14_916.862;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
const LONDON_SCORE = scoreForDistance(distanceKm(PARIS, LONDON), SCALE_KM);
const PLACES = [0, 1, 2, 3, 4].map((index) => ({ id: `paris-${index}`, ...PARIS, country: 'FR' }));
const NOT_QUEUED = { queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null };
// A game was found for others a moment ago in most of these tests, and how long they waited is what the next player is told.
const WAITED = expect.toBeOneOf([null, expect.any(Number)]);
const WAITING_ALONE = { queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: WAITED, lockedUntil: null };
/** The first round of a game made by `game()` runs from here; each later one starts this long after the last was guessed. */
const R0 = T + SECOND + COUNTDOWN_MS;
const BETWEEN_ROUNDS_MS = REVEAL_MS + COUNTDOWN_MS;

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
const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const pin = (userId: string, matchId: string, round: number, where: Spot, now: number) =>
  guess(db, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
const queued = async () => (await stored('SELECT user_id FROM match_queue')).map((row) => row.user_id);
const seatedIn = async (matchId: string) => (await stored('SELECT user_id FROM match_players WHERE match_id = $1 AND open ORDER BY seat', [matchId])).map((row) => row.user_id);
const openMatchesOf = async (userId: string) => (await stored('SELECT match_id FROM match_players WHERE user_id = $1 AND open', [userId])).map((row) => row.match_id);

/** A public game of the given players, alice first, gathered and started by T + 1 s. `places` false leaves it being prepared. */
async function game(players: string[], places = true): Promise<string> {
  for (const [index, userId] of players.entries()) {
    yes(await joinQueue(db, userId, 'unranked', T - GATHER_MS + index));
  }
  for (const userId of players) {
    await pollQueue(db, userId, T - GATHER_MS / 2);
  }
  const { matchId } = await pollQueue(db, alice, T + SECOND);
  if (matchId === null) {
    throw new Error('no game was started');
  }
  if (places) {
    yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: SCALE_KM }, T + SECOND));
  }
  return matchId;
}

/** Alice and bob both guess in `rounds` rounds, one straight after the reveal of the last. Returns the moment the last of those reveals ends. */
async function playRounds(matchId: string, rounds: number[]): Promise<number> {
  let revealEnds = R0;
  for (const round of rounds) {
    const at = R0 + round * BETWEEN_ROUNDS_MS;
    await pin(alice, matchId, round, LONDON, at);
    await pin(bob, matchId, round, LONDON, at);
    revealEnds = at + REVEAL_MS;
  }
  return revealEnds;
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol, dave] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol'), addUser('dave')]);
});

describe('queueing for a public game while one is under way', () => {
  it('puts the player straight into it: no queue, and the match to go to in the reply', async () => {
    const matchId = await game([alice, bob]);
    expect(await join(carol, R0 + SECOND)).toEqual({ ...NOT_QUEUED, matchId });
    expect(await queued()).toEqual([]);
    expect(await pollQueue(db, carol, R0 + 2 * SECOND)).toEqual({ ...NOT_QUEUED, matchId });

    const mine = await state(carol, matchId, R0 + 2 * SECOND);
    expect(mine).toMatchObject({ kind: 'unranked', phase: 'playing', round: 0, places: PLACES.slice(0, 1), you: { username: 'carol', isHost: false, isResolver: false, team: null } });
    expect(mine.players).toMatchObject([
      { username: 'alice', total: 0 },
      { username: 'bob', total: 0 },
      { username: 'carol', total: 0, guessed: false, active: true, rating: null, health: null },
    ]);
    expect((await state(alice, matchId, R0 + 2 * SECOND)).players.map((player) => player.username)).toEqual(['alice', 'bob', 'carol']);
  });

  it('has them play from the next round: the one they arrived in goes on without them, and scores them nothing', async () => {
    const matchId = await game([alice, bob]);
    await join(carol, R0 + SECOND);

    // A guess in the round she arrived in is not taken.
    expect((await pin(carol, matchId, 0, PARIS, R0 + 2 * SECOND)).players[2]).toMatchObject({ guessed: false });
    await pin(alice, matchId, 0, LONDON, R0 + 3 * SECOND);
    // The round ends when the two who are playing it have guessed, without waiting for her.
    const revealed = await pin(bob, matchId, 0, LONDON, R0 + 3 * SECOND);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.results[0]?.guesses[2]).toEqual({ username: 'carol', lng: null, lat: null, distanceKm: null, score: 0 });

    // From the next round she is one of the players: the round waits for her guess, and it counts.
    const next = R0 + 3 * SECOND + BETWEEN_ROUNDS_MS;
    await pin(alice, matchId, 1, LONDON, next);
    expect((await pin(bob, matchId, 1, LONDON, next)).phase).toBe('playing');
    const second = await pin(carol, matchId, 1, PARIS, next + SECOND);
    expect(second.phase).toBe('reveal');
    expect(second.players.map((player) => player.total)).toEqual([2 * LONDON_SCORE, 2 * LONDON_SCORE, 5000]);
  });

  it('has them play the round about to start when they arrive during its countdown', async () => {
    const matchId = await game([alice, bob]);
    await join(carol, R0 - 1);
    expect((await pin(carol, matchId, 0, PARIS, R0)).players[2]).toMatchObject({ guessed: true });
    expect(await stored('SELECT joined_round FROM match_players WHERE user_id = $1', [carol])).toEqual([{ joined_round: 0 }]);
  });

  it('has them wait for the next round when they arrive during a reveal', async () => {
    const matchId = await game([alice, bob]);
    const revealEnds = await playRounds(matchId, [0]);
    await join(carol, revealEnds - SECOND);
    expect(await stored('SELECT joined_round FROM match_players WHERE user_id = $1', [carol])).toEqual([{ joined_round: 1 }]);
    expect((await pin(carol, matchId, 1, PARIS, revealEnds + COUNTDOWN_MS)).players[2]).toMatchObject({ guessed: true });
  });

  it('takes them from the first round into a game that is still being prepared', async () => {
    const matchId = await game([alice, bob], false);
    expect(await join(carol, T + 2 * SECOND)).toEqual({ ...NOT_QUEUED, matchId });
    yes(await postPlaces(db, alice, { matchId, places: PLACES, scaleKm: SCALE_KM }, T + 2 * SECOND));
    const round = T + 2 * SECOND + COUNTDOWN_MS;
    expect((await pin(carol, matchId, 0, PARIS, round)).players[2]).toMatchObject({ guessed: true });
  });

  it('seats each new player after the last, up to ten', async () => {
    const matchId = await game([alice, bob]);
    const arrivals = [carol, dave];
    for (let index = 0; index < 6; index += 1) {
      arrivals.push(await addUser(`extra${index}`));
    }
    for (const [index, userId] of arrivals.entries()) {
      expect((await join(userId, R0 + SECOND + index)).matchId).toBe(matchId);
    }
    expect(await seatedIn(matchId)).toEqual([alice, bob, ...arrivals]);
    expect(await stored('SELECT seat FROM match_players ORDER BY seat')).toEqual(Array.from({ length: 10 }, (_unused, seat) => ({ seat })));

    const eleventh = await addUser('eleventh');
    expect(await join(eleventh, R0 + 2 * SECOND)).toEqual(WAITING_ALONE);
    expect(await seatedIn(matchId)).toHaveLength(10);
  });

  it('pays everyone XP for their own guesses when it ends, the late arrival for the rounds they played', async () => {
    const matchId = await game([alice, bob]);
    await join(carol, R0 + SECOND);
    let at = R0 + 2 * SECOND;
    for (const round of [0, 1, 2, 3, 4]) {
      await pin(alice, matchId, round, LONDON, at);
      await pin(bob, matchId, round, LONDON, at);
      if (round > 0) {
        await pin(carol, matchId, round, PARIS, at);
      }
      at += round === 4 ? REVEAL_MS : BETWEEN_ROUNDS_MS;
    }
    const finished = await state(carol, matchId, at);
    expect(finished).toMatchObject({ phase: 'finished', outcome: { winners: ['carol'], ratingChanges: [] } });
    expect(finished.players.map((player) => player.total)).toEqual([5 * LONDON_SCORE, 5 * LONDON_SCORE, 20_000]);
    expect(finished.results[0]?.guesses[2]).toMatchObject({ username: 'carol', score: 0, lng: null });
    const xp = Object.fromEntries((await stored('SELECT username, xp FROM users')).map((row) => [row.username, row.xp]));
    expect(xp).toMatchObject({ alice: 5 * Math.round(LONDON_SCORE / 50), bob: 5 * Math.round(LONDON_SCORE / 50), carol: 400, dave: 0 });
  });

  it('comes before waiting: a new arrival joins the game though someone else is in the queue', async () => {
    const matchId = await game([alice, bob]);
    // Dave has been waiting since the game was full of rounds he could not join; the test puts him there directly.
    await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $3)', [dave, 'unranked', new Date(R0)]);
    expect((await join(carol, R0 + SECOND)).matchId).toBe(matchId);
    expect(await queued()).toEqual([dave]);
    expect(await pollQueue(db, dave, R0 + 2 * SECOND)).toEqual(WAITING_ALONE);
  });

  it('moves a player who was already waiting, and asks again, into the game, and stops the countdown they were part of', async () => {
    const matchId = await game([alice, bob]);
    for (const userId of [carol, dave]) {
      await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $3)', [userId, 'unranked', new Date(R0)]);
    }
    expect((await pollQueue(db, dave, R0 + SECOND)).startsAt).not.toBeNull();
    expect(await join(carol, R0 + 2 * SECOND)).toEqual({ ...NOT_QUEUED, matchId });
    expect(await queued()).toEqual([dave]);
    expect(await stored('SELECT starts_at FROM queue_gathering')).toEqual([{ starts_at: null }]);
    expect(await pollQueue(db, dave, R0 + 3 * SECOND)).toEqual(WAITING_ALONE);
  });
});

describe('a public game that cannot take a new player', () => {
  it('is one whose round has 15 seconds or less to run', async () => {
    const matchId = await game([alice, bob]);
    const ends = R0 + 45 * SECOND;
    await state(alice, matchId, R0 + 20 * SECOND);
    await state(bob, matchId, R0 + 20 * SECOND);
    expect((await join(carol, ends - 15 * SECOND - 1)).matchId).toBe(matchId);
    expect(await join(dave, ends - 15 * SECOND)).toEqual(WAITING_ALONE);
  });

  it('is one with fewer than three rounds still to start', async () => {
    const matchId = await game([alice, bob]);
    // Rounds 0 and 1 are played. During the get-ready before round 2, three rounds have yet to start.
    const revealEnds = await playRounds(matchId, [0, 1]);
    const thirdStarts = revealEnds + COUNTDOWN_MS;
    expect((await join(carol, thirdStarts - 1)).matchId).toBe(matchId);
    // Once round 2 is under way only two are left, and the next arrival waits for a new game.
    expect(await join(dave, thirdStarts)).toEqual(WAITING_ALONE);
    expect(await seatedIn(matchId)).toEqual([alice, bob, carol]);
  });

  it('is one that has finished', async () => {
    const matchId = await game([alice, bob]);
    yes(await leaveMatch(db, bob, matchId, R0));
    expect((await state(alice, matchId, R0)).phase).toBe('finished');
    expect(await join(carol, R0 + SECOND)).toEqual(WAITING_ALONE);
  });

  it('is one everyone walked away from, even before anyone has noticed', async () => {
    const matchId = await game([alice, bob]);
    expect(await join(carol, R0 + INACTIVE_AFTER_MS + SECOND)).toEqual(WAITING_ALONE);
    expect(await seatedIn(matchId)).toEqual([alice, bob]);
  });

  it('is one the player has left: they are not put back', async () => {
    const matchId = await game([alice, bob, carol]);
    yes(await leaveMatch(db, carol, matchId, R0));
    expect(await join(carol, R0 + SECOND)).toEqual(WAITING_ALONE);
  });

  it('is a ranked duel, a team match or a party: only public games are joined', async () => {
    yes(await joinQueue(db, alice, 'ranked', T));
    yes(await joinQueue(db, bob, 'ranked', T + 1));
    const party = yes(await createParty(db, dave, { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 }, T));
    const other = await addUser('other');
    yes(await joinParty(db, other, party.code ?? '', T));
    yes(await startMatch(db, dave, party.id, T));
    expect(await join(carol, T + SECOND)).toEqual(WAITING_ALONE);
  });

  it('is never joined by queueing for anything but a public game', async () => {
    const matchId = await game([alice, bob]);
    expect(yes(await joinQueue(db, carol, 'ranked', R0 + SECOND))).toEqual({ queued: true, kind: 'ranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: expect.any(Number), typicalWaitSeconds: null, lockedUntil: null });
    expect(yes(await joinQueue(db, dave, 'team', R0 + SECOND))).toMatchObject({ queued: true, matchId: null });
    expect(await seatedIn(matchId)).toEqual([alice, bob]);
  });

  it('is any game at all for a player who is already in a match', async () => {
    await game([alice, bob]);
    yes(await createParty(db, carol, { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 }, R0));
    expect(await joinQueue(db, carol, 'unranked', R0 + SECOND)).toMatchObject({ ok: false, status: 409 });
    expect(await openMatchesOf(carol)).toHaveLength(1);
  });
});

describe('joining a public game under concurrency', () => {
  const slowly = () => pausingAfter(db, /FROM matches|queue_gathering|FROM match_queue/);

  it('gives the last free seat to one of two players who ask at once, and queues the other as usual', async () => {
    const matchId = await game([alice, bob]);
    for (let index = 0; index < 7; index += 1) {
      await join(await addUser(`extra${index}`), R0 + SECOND);
    }
    expect(await seatedIn(matchId)).toHaveLength(9);

    const slow = slowly();
    const replies = await Promise.all([join(carol, R0 + 2 * SECOND, slow), join(dave, R0 + 2 * SECOND, slow)]);
    expect(replies.map((reply) => reply.matchId).sort()).toEqual([matchId, null].sort());
    expect(replies.find((reply) => reply.matchId === null)).toEqual(WAITING_ALONE);
    expect(await seatedIn(matchId)).toHaveLength(10);
    const [inGame, waiting] = replies[0]?.matchId === matchId ? [carol, dave] : [dave, carol];
    expect(await seatedIn(matchId)).toContain(inGame);
    expect(await queued()).toEqual([waiting]);
    expect(await openMatchesOf(waiting)).toEqual([]);
    expect(await stored('SELECT seat FROM match_players ORDER BY seat')).toEqual(Array.from({ length: 10 }, (_unused, seat) => ({ seat })));
  });

  it('seats two players who ask at once one after the other when there is room for both', async () => {
    const matchId = await game([alice, bob]);
    const slow = slowly();
    const replies = await Promise.all([join(carol, R0 + SECOND, slow), join(dave, R0 + SECOND, slow)]);
    expect(replies.map((reply) => reply.matchId)).toEqual([matchId, matchId]);
    expect((await stored('SELECT seat FROM match_players ORDER BY seat')).map((row) => row.seat)).toEqual([0, 1, 2, 3]);
  });

  it('gives a player who asks as one round gives way to the next the same first round whichever request lands first', async () => {
    const matchId = await game([alice, bob]);
    const revealEnds = await playRounds(matchId, [0]);
    const slow = slowly();
    const [joined, polled] = await Promise.all([join(carol, revealEnds, slow), state(alice, matchId, revealEnds, slow)]);
    expect(joined.matchId).toBe(matchId);
    expect(polled).toMatchObject({ phase: 'playing', round: 1 });
    expect(await stored('SELECT joined_round FROM match_players WHERE user_id = $1', [carol])).toEqual([{ joined_round: 1 }]);
    expect(await state(carol, matchId, revealEnds)).toMatchObject({ phase: 'playing', round: 1, roundStartsAt: new Date(revealEnds + COUNTDOWN_MS).toISOString() });
  });

  it('takes or turns away a player who asks just as the game stops being one to join, and never half of each', async () => {
    const matchId = await game([alice, bob]);
    // A moment before round 2 starts, three rounds have yet to start. Once it has started, two have: too late.
    const revealEnds = await playRounds(matchId, [0, 1]);
    const thirdStarts = revealEnds + COUNTDOWN_MS;
    const slow = slowly();
    const [early, late] = await Promise.all([join(carol, thirdStarts - 1, slow), join(dave, thirdStarts, slow), state(alice, matchId, thirdStarts, slow)]);
    expect(early).toEqual({ ...NOT_QUEUED, matchId });
    expect(late).toEqual(WAITING_ALONE);
    expect(await seatedIn(matchId)).toEqual([alice, bob, carol]);
    expect(await queued()).toEqual([dave]);
  });

  it('puts a player who asks as the game ends early either in a game that goes on, or in the queue, never in a game that is over', async () => {
    const matchId = await game([alice, bob]);
    const slow = slowly();
    const [joined] = await Promise.all([join(carol, R0 + SECOND, slow), leaveMatch(slow, bob, matchId, R0 + SECOND)]);
    const [{ phase } = { phase: '' }] = await stored('SELECT phase FROM matches WHERE id = $1', [matchId]);
    if (joined.matchId === null) {
      // Bob left first: with one player the game was over, and carol waits for another.
      expect(joined).toEqual(WAITING_ALONE);
      expect(phase).toBe('finished');
      expect(await openMatchesOf(carol)).toEqual([]);
      expect(await queued()).toEqual([carol]);
    } else {
      // Carol got in first: when bob left there were still two, and the game goes on.
      expect(joined.matchId).toBe(matchId);
      expect(phase).toBe('playing');
      expect(await seatedIn(matchId)).toEqual([alice, carol]);
      expect(await queued()).toEqual([]);
    }
  });

  it('never puts a player in two games when they ask as a countdown ends and a new game is formed', async () => {
    // No game is under way. Alice and bob are counting down; carol asks at the moment it ends, as alice polls.
    yes(await joinQueue(db, alice, 'unranked', T));
    yes(await joinQueue(db, bob, 'unranked', T + SECOND));
    await pollQueue(db, alice, T + 6 * SECOND);
    await pollQueue(db, bob, T + 6 * SECOND);
    const starts = T + SECOND + GATHER_MS;
    const slow = slowly();
    const [joined, polled] = await Promise.all([join(carol, starts, slow), pollQueue(slow, alice, starts)]);

    const made = (await stored('SELECT id FROM matches')).map((row) => row.id);
    expect(made).toHaveLength(1);
    expect(polled).toEqual({ ...NOT_QUEUED, matchId: made[0] });
    const mine = await openMatchesOf(carol);
    const waiting = (await queued()).includes(carol);
    // She is in the new game (gathered with it, or seated in it a moment after), or still waiting: one or the other.
    expect([mine.length, waiting]).toEqual(joined.matchId === null ? [0, true] : [1, false]);
    expect(mine.every((matchId) => matchId === made[0])).toBe(true);
    expect((await seatedIn(String(made[0]))).slice(0, 2)).toEqual([alice, bob]);
  });

  it('never puts a waiting player in two games when they ask again as their own countdown ends, with another game under way', async () => {
    const running = await game([alice, bob]);
    const eve = await addUser('eve');
    // Carol and dave are counting down to a game of their own, due at `starts`.
    for (const userId of [carol, dave]) {
      await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $3)', [userId, 'unranked', new Date(R0)]);
    }
    await db.query(`INSERT INTO queue_gathering (kind, starts_at) VALUES ('unranked', $1) ON CONFLICT (kind) DO UPDATE SET starts_at = EXCLUDED.starts_at`, [
      new Date(R0 + 5 * SECOND),
    ]);
    const starts = R0 + 5 * SECOND;
    const slow = slowly();
    // Carol asks again (and so may be moved into the running game) just as dave's poll would start theirs; eve arrives too.
    const replies = await Promise.allSettled([joinQueue(slow, carol, 'unranked', starts), pollQueue(slow, dave, starts), join(eve, starts, slow)]);
    expect(replies.every((reply) => reply.status === 'fulfilled')).toBe(true);

    for (const userId of [carol, dave, eve]) {
      const open = await openMatchesOf(userId);
      const waiting = (await queued()).includes(userId);
      expect(open.length + (waiting ? 1 : 0)).toBe(1);
    }
    expect(await openMatchesOf(alice)).toEqual([running]);
    const sizes = (await stored('SELECT count(*)::int AS players FROM match_players WHERE open GROUP BY match_id')).map((row) => row.players);
    expect(sizes.every((players) => (players as number) >= 2 && (players as number) <= 8)).toBe(true);
  });
});
