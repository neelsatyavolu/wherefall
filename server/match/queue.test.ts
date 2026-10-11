import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import type { QueueKind } from './input.js';
import { createParty } from './parties.js';
import { getMatch, leaveMatch } from './play.js';
import { joinQueue, leaveQueue, pollQueue } from './queue.js';
import { INACTIVE_AFTER_MS, PREPARE_MS, QUEUE_LAPSE_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const NOT_QUEUED = { queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null };

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

const queue = (userId: string, kind: QueueKind, now = T, on: Db = db) => joinQueue(on, userId, kind, now).then(yes);
const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);

/** Puts players in a queue without the matchmaking a real join would trigger. */
async function waiting(kind: QueueKind, userIds: string[], now = T): Promise<void> {
  for (const [index, userId] of userIds.entries()) {
    const times = [new Date(now + index), new Date(now)];
    await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $4)', [userId, kind, ...times]);
  }
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol, dave] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol'), addUser('dave')]);
});

describe('joinQueue', () => {
  it('waits when nobody else is looking', async () => {
    expect(await queue(alice, 'ranked')).toEqual({ queued: true, kind: 'ranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: expect.any(Number), typicalWaitSeconds: null, lockedUntil: null });
    expect(await pollQueue(db, alice, T + SECOND)).toEqual({ queued: true, kind: 'ranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: expect.any(Number), typicalWaitSeconds: null, lockedUntil: null });
  });

  it('pairs two players, and tells each of them the match on their next request', async () => {
    await queue(alice, 'ranked');
    const second = await queue(bob, 'ranked', T + SECOND);
    expect(second).toEqual({ ...NOT_QUEUED, matchId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await pollQueue(db, alice, T + 2 * SECOND)).toMatchObject({ queued: false, matchId: second.matchId });
    expect(await pollQueue(db, bob, T + 2 * SECOND)).toMatchObject({ queued: false, matchId: second.matchId });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('starts a ranked duel with its fixed settings, the first player matched picking the places', async () => {
    const kind = 'ranked';
    const settings = { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'reactions', teams: 'none', guests: true };
    const rating = 500;
    await queue(alice, kind);
    const { matchId } = await queue(bob, kind, T + SECOND);
    const mine = await state(alice, matchId ?? '', T + SECOND);
    expect(mine).toMatchObject({
      kind,
      code: null,
      phase: 'preparing',
      settings,
      seed: expect.stringMatching(/^[a-z0-9]{1,32}$/),
      you: { username: 'alice', isHost: false, isResolver: true, team: null },
      players: [
        { username: 'alice', team: null, active: true, rating },
        { username: 'bob', team: null, active: true, rating },
      ],
    });
    expect((await state(bob, matchId ?? '', T + SECOND)).you).toEqual({ username: 'bob', isHost: false, isResolver: false, team: null, guest: false, muted: [] });
    expect((await state(bob, matchId ?? '', T + SECOND + PREPARE_MS)).phase).toBe('finished');
  });

  it('keeps the queues apart', async () => {
    await queue(alice, 'ranked');
    expect(await queue(bob, 'unranked')).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await queue(carol, 'team')).toEqual({ queued: true, kind: 'team', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
  });

  it('gathers four for a team match and splits them into two random teams of two', async () => {
    await queue(alice, 'team', T - 3);
    await queue(bob, 'team', T - 2);
    expect(await queue(carol, 'team', T - 1)).toEqual({ queued: true, kind: 'team', waiting: 3, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    const { matchId } = await queue(dave, 'team');
    const mine = await state(carol, matchId ?? '', T);
    expect(mine).toMatchObject({ kind: 'team', phase: 'preparing', settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 } });
    expect(mine.players.map((player) => player.username).sort()).toEqual(['alice', 'bob', 'carol', 'dave']);
    // Seats run team by team.
    expect(mine.players.map((player) => player.team)).toEqual([0, 0, 1, 1]);
    expect(mine.you.team).toBe(mine.players.find((player) => player.username === 'carol')?.team);
    expect((await state(alice, matchId ?? '', T)).you.isResolver).toBe(true);
    expect(mine.players.every((player) => player.rating === null)).toBe(true);
  });

  it('does not always draw the same teams', async () => {
    const partners = new Set<string>();
    for (let attempt = 0; attempt < 40 && partners.size < 2; attempt += 1) {
      await resetDb(db);
      const ids = await Promise.all(['a_one', 'b_two', 'c_three', 'd_four'].map(addUser));
      await waiting('team', ids);
      const { matchId } = await pollQueue(db, ids[0] ?? '', T);
      const { players, you } = await state(ids[0] ?? '', matchId ?? '', T);
      partners.add(players.find((player) => player.team === you.team && player.username !== you.username)?.username ?? '');
    }
    expect(partners.size).toBe(2);
  });

  it('matches the four who have waited longest and leaves the fifth waiting', async () => {
    const eve = await addUser('eve');
    await waiting('team', [alice, bob, carol, dave, eve]);
    expect(await pollQueue(db, eve, T)).toEqual({ queued: true, kind: 'team', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect((await pollQueue(db, alice, T)).matchId).not.toBeNull();
  });

  it('refuses a player who is in an unfinished match, naming the situation', async () => {
    yes(await createParty(db, alice, { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 }, T));
    expect(await joinQueue(db, alice, 'ranked', T + SECOND)).toEqual({
      ok: false,
      status: 409,
      error: 'You are already in a match. Leave it before you start another.',
    });
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('tells a player who asks about the queue which unfinished match they are in, so the browser can offer to leave it', async () => {
    const party = yes(await createParty(db, alice, { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 }, T));
    expect(await pollQueue(db, alice, T)).toEqual({ ...NOT_QUEUED, matchId: party.id });
    yes(await leaveMatch(db, alice, party.id, T));
    expect(await pollQueue(db, alice, T)).toEqual(NOT_QUEUED);
    expect((await queue(alice, 'ranked')).queued).toBe(true);
  });

  it('lets a player back in once the match they walked away from has run its course', async () => {
    await queue(alice, 'ranked', T - 1);
    const { matchId } = await queue(bob, 'ranked');
    expect((await joinQueue(db, alice, 'team', T + SECOND)).ok).toBe(false);
    expect((await queue(alice, 'team', T + INACTIVE_AFTER_MS)).queued).toBe(true);
    expect(await stored('SELECT phase FROM matches WHERE id = $1', [matchId])).toEqual([{ phase: 'finished' }]);
  });

  it('moves a player who asks for another queue: they are only ever in one', async () => {
    await queue(alice, 'ranked');
    expect(await queue(alice, 'unranked', T + SECOND)).toEqual({ queued: true, kind: 'unranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: null, typicalWaitSeconds: null, lockedUntil: null });
    expect(await stored('SELECT kind FROM match_queue')).toEqual([{ kind: 'unranked' }]);
    expect(await queue(bob, 'ranked', T + SECOND)).toMatchObject({ waiting: 1, matchId: null });
  });

  it('keeps a player their place in line when they ask for the same queue again', async () => {
    const eve = await addUser('eve');
    await waiting('team', [alice, bob, carol, dave, eve]);
    await enqueueAgain(alice);
    expect(await pollQueue(db, eve, T + SECOND)).toMatchObject({ queued: true, waiting: 1 });
    expect((await pollQueue(db, alice, T + SECOND)).matchId).not.toBeNull();

    async function enqueueAgain(userId: string): Promise<void> {
      // The other four are held back so that asking again does not form the match yet.
      await db.query('UPDATE match_queue SET kind = $2 WHERE user_id <> $1', [userId, 'ranked']);
      await queue(userId, 'team', T + SECOND);
      await db.query('UPDATE match_queue SET kind = $1, last_seen_at = $2', ['team', new Date(T + SECOND)]);
    }
  });

  it('answers a player whose account is gone as signed out', async () => {
    expect(await joinQueue(db, randomUUID(), 'ranked', T)).toMatchObject({ ok: false, status: 401 });
  });

  it('clears out entries that lapsed long ago', async () => {
    await waiting('ranked', [alice]);
    await queue(bob, 'unranked', T + QUEUE_LAPSE_MS);
    expect((await stored('SELECT user_id FROM match_queue')).map((row) => row.user_id)).toEqual([bob]);
  });
});

describe('a queue entry', () => {
  it('stays for as long as it is polled within every 10 seconds', async () => {
    await queue(alice, 'ranked');
    for (let poll = 1; poll <= 4; poll += 1) {
      expect((await pollQueue(db, alice, T + poll * (QUEUE_LAPSE_MS - 1))).queued).toBe(true);
    }
    expect((await queue(bob, 'ranked', T + 4 * (QUEUE_LAPSE_MS - 1))).matchId).not.toBeNull();
  });

  it('lapses after 10 seconds without a poll, and is not matched afterwards', async () => {
    await queue(alice, 'ranked');
    expect(await queue(bob, 'ranked', T + QUEUE_LAPSE_MS)).toEqual({ queued: true, kind: 'ranked', waiting: 1, matchId: null, startsAt: null, since: expect.any(String), serverNow: expect.any(String), window: expect.any(Number), typicalWaitSeconds: null, lockedUntil: null });
    expect(await pollQueue(db, alice, T + QUEUE_LAPSE_MS)).toEqual(NOT_QUEUED);
    expect(await stored('SELECT id FROM matches')).toEqual([]);
  });

  it('goes to the back of the line when its player asks again after lapsing', async () => {
    await waiting('ranked', [alice]);
    await waiting('ranked', [bob], T + QUEUE_LAPSE_MS);
    expect(await queue(alice, 'ranked', T + QUEUE_LAPSE_MS + SECOND)).toMatchObject({ matchId: expect.any(String) });
    expect((await stored('SELECT resolver_id FROM matches'))[0]?.resolver_id).toBe(bob);
  });
});

describe('leaveQueue', () => {
  it('takes the player out, so the next to join waits instead of being matched with them', async () => {
    await queue(alice, 'ranked');
    expect(await leaveQueue(db, alice, T)).toEqual({ queued: false });
    expect(await pollQueue(db, alice, T)).toEqual(NOT_QUEUED);
    expect(await queue(bob, 'ranked')).toMatchObject({ queued: true, waiting: 1, matchId: null });
  });

  it('answers the same for a player who was not waiting', async () => {
    expect(await leaveQueue(db, alice, T)).toEqual({ queued: false });
  });
});

describe('matchmaking under concurrency', () => {
  const openMatches = async () => (await stored('SELECT user_id, match_id FROM match_players WHERE open')).map((row) => [row.user_id, row.match_id]);

  it('makes one match when two polls would each form it from the same two players', async () => {
    await waiting('ranked', [alice, bob]);
    const slow = pausingAfter(db, /FROM match_queue/);
    const seen = await Promise.all([pollQueue(slow, alice, T), pollQueue(slow, bob, T)]);
    expect(await stored('SELECT id FROM matches')).toHaveLength(1);
    expect(await openMatches()).toHaveLength(2);

    // Whichever poll lost the race learns of the match on its next turn.
    const settled = await Promise.all([pollQueue(db, alice, T + SECOND), pollQueue(db, bob, T + SECOND)]);
    expect(settled[0].matchId).toBe(settled[1].matchId);
    expect(settled[0].matchId).not.toBeNull();
    expect(seen.some((reply) => reply.matchId === settled[0].matchId)).toBe(true);
  });

  it('puts four players polling at once into two matches, each player in exactly one', async () => {
    await waiting('ranked', [alice, bob, carol, dave]);
    const slow = pausingAfter(db, /FROM match_queue/);
    await Promise.all([alice, bob, carol, dave].map((userId) => pollQueue(slow, userId, T)));
    await Promise.all([alice, bob, carol, dave].map((userId) => pollQueue(db, userId, T + SECOND)));

    const open = await openMatches();
    expect(open.map(([userId]) => userId).sort()).toEqual([alice, bob, carol, dave].sort());
    expect(new Set(open.map(([, matchId]) => matchId)).size).toBe(2);
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('never matches a player twice when three join the same queue at once', async () => {
    await Promise.all([queue(alice, 'ranked'), queue(bob, 'ranked'), queue(carol, 'ranked')]);
    expect(await openMatches()).toHaveLength(2);
    expect(await stored('SELECT user_id FROM match_queue')).toHaveLength(1);
  });

  it('passes over a waiting player who is somehow in a match already, instead of failing', async () => {
    yes(await createParty(db, alice, { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 }, T));
    await waiting('ranked', [alice, bob]);
    expect(await pollQueue(db, bob, T)).toMatchObject({ queued: true, matchId: null });
    expect(await queue(carol, 'ranked')).toMatchObject({ matchId: expect.any(String) });
    expect((await openMatches()).filter(([userId]) => userId === alice)).toHaveLength(1);
  });

  it('leaves a player in one match when they open a party just as the queue pairs them', async () => {
    await waiting('ranked', [alice]);
    const slow = pausingAfter(db, /FROM match_queue/);
    const settings = { map: 'world', mode: 'move', timeLimit: 30, rounds: 3 } as const;
    const [created] = await Promise.all([createParty(slow, alice, settings, T), queue(bob, 'ranked', T, slow)]);
    const mine = (await openMatches()).filter(([userId]) => userId === alice);
    expect(mine).toHaveLength(1);
    expect(created.ok || created.status === 409).toBe(true);
    expect(await stored('SELECT user_id FROM match_queue WHERE user_id = $1', [alice])).toEqual([]);
  });
});
