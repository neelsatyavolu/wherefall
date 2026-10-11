import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import type { Waiting } from '../db/queue.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty } from './parties.js';
import { getMatch, guess, leaveMatch, pin, postPlaces, say } from './play.js';
import { joinQueue, leaveQueue, pollQueue, queueAsPair, teamMatches } from './queue.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { COUNTDOWN_MS, LAST_REVEAL_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const R0 = T + COUNTDOWN_MS;
const SCALE_KM = 20_000;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
const FAR = { lng: 2.3522 - 180, lat: -48.8566 };
const LONDON_SCORE = scoreForDistance(distanceKm(PARIS, LONDON), SCALE_KM);
const PLACES = Array.from({ length: 5 }, (_unused, index) => ({ id: `paris-${index}`, ...PARIS, country: 'FR' }));
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 60, rounds: 5 } as const;

let db: Db;
let ids: string[];
const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];

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

const idOf = (name: string): string => ids[names.indexOf(name)] ?? '';
const state = (name: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, idOf(name), matchId, now).then(yes);
const guessAt = (name: string, matchId: string, round: number, where: Spot, now: number) =>
  guess(db, idOf(name), { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
const open = async () => (await stored('SELECT user_id, match_id FROM match_players WHERE open')).map((row) => [row.user_id, row.match_id]);

/** Puts players in the 2v2 queue without the matchmaking a real join would trigger. `groups` ties pairs. */
async function waiting(players: string[], groups: Record<string, string> = {}, now = T): Promise<void> {
  for (const [index, name] of players.entries()) {
    await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at, group_id) VALUES ($1, $2, $3, $4, $5)', [
      idOf(name),
      'team',
      new Date(now + index),
      new Date(now),
      groups[name] ?? null,
    ]);
  }
}

/** A 2v2 match of alice and bob (a pair, team 0) against carol and dave, with its first round running from R0. */
async function teamMatch(): Promise<string> {
  const pair = randomUUID();
  await waiting(['alice', 'bob', 'carol', 'dave'], { alice: pair, bob: pair });
  const { matchId } = await pollQueue(db, idOf('alice'), T);
  yes(await postPlaces(db, idOf('alice'), { matchId: matchId ?? '', places: PLACES, scaleKm: SCALE_KM }, T));
  return matchId ?? '';
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  ids = await Promise.all(names.map(addUser));
});

describe('teamMatches', () => {
  const waiter = (userId: string, order: number, groupId: string | null = null): Waiting => ({ userId, joinedAt: T + order, rating: 500, groupId, lastOpponent: null, lastRankedAt: null });
  const sides = (lineup: { seats: Array<{ userId: string; team: 0 | 1 | null }> }) =>
    [0, 1].map((team) => lineup.seats.filter((seat) => seat.team === team).map((seat) => seat.userId).sort());

  it('needs four players', () => {
    expect(teamMatches([waiter('a', 0), waiter('b', 1), waiter('c', 2)])).toEqual([]);
  });

  it('deals four who came alone into two teams of two, the longest waiting picking the places', () => {
    const [made, ...more] = teamMatches([waiter('a', 0), waiter('b', 1), waiter('c', 2), waiter('d', 3), waiter('e', 4)]);
    expect(more).toEqual([]);
    expect(made?.resolverId).toBe('a');
    expect(made?.seats.map((seat) => seat.userId).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(made?.seats.map((seat) => seat.team)).toEqual([0, 0, 1, 1]);
  });

  it('keeps a pair together, against the two who came alone', () => {
    const [made] = teamMatches([waiter('a', 0), waiter('p', 1, 'g'), waiter('b', 2), waiter('q', 3, 'g')]);
    expect(made ? sides(made) : null).toEqual([
      ['p', 'q'],
      ['a', 'b'],
    ]);
    expect(made?.resolverId).toBe('a');
  });

  it('sets two pairs against each other', () => {
    const [made] = teamMatches([waiter('p', 0, 'g'), waiter('x', 1, 'h'), waiter('q', 2, 'g'), waiter('y', 3, 'h')]);
    expect(made ? sides(made) : null).toEqual([
      ['p', 'q'],
      ['x', 'y'],
    ]);
  });

  it('passes over a pair that does not fit, and takes it into the next match', () => {
    const waiting = [waiter('a', 0), waiter('b', 1), waiter('c', 2), waiter('p', 3, 'g'), waiter('q', 4, 'g'), waiter('d', 5), waiter('e', 6), waiter('f', 7)];
    const made = teamMatches(waiting);
    expect(made.map((lineup) => lineup.seats.map((seat) => seat.userId).sort())).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'p', 'q'],
    ]);
  });

  it('counts a player whose partner has gone as one who came alone, and leaves a pair and one waiting', () => {
    expect(teamMatches([waiter('p', 0, 'g'), waiter('a', 1), waiter('b', 2), waiter('c', 3)])).toHaveLength(1);
    expect(teamMatches([waiter('p', 0, 'g'), waiter('q', 1, 'g'), waiter('a', 2)])).toEqual([]);
  });

  it('does not always deal the same teams', () => {
    const dealt = new Set<string>();
    for (let attempt = 0; attempt < 60 && dealt.size < 2; attempt += 1) {
      const [made] = teamMatches([waiter('a', 0), waiter('b', 1), waiter('c', 2), waiter('d', 3)]);
      dealt.add(JSON.stringify(made ? sides(made) : null));
    }
    expect(dealt.size).toBe(2);
  });
});

describe('a 2v2 match', () => {
  it('is five rounds of 60 seconds with chat, each team on 5000 health', async () => {
    const matchId = await teamMatch();
    const seen = await state('carol', matchId, T);
    expect(seen).toMatchObject({ kind: 'team', settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'chat', teams: 'best', guests: true } });
    expect(seen.teams).toEqual([
      { team: 0, health: 5000, total: 0 },
      { team: 1, health: 5000, total: 0 },
    ]);
    // The pair sit together; the two who came alone are seated in either order.
    const seats = seen.players.map((player) => [player.username, player.team, player.health]).sort();
    expect(seats).toEqual([
      ['alice', 0, null],
      ['bob', 0, null],
      ['carol', 1, null],
      ['dave', 1, null],
    ]);
  });

  it('takes the difference between the teams\' best guesses, and three tenths more, from the lower team', async () => {
    const matchId = await teamMatch();
    await guessAt('alice', matchId, 0, FAR, R0);
    await guessAt('bob', matchId, 0, PARIS, R0);
    await guessAt('carol', matchId, 0, LONDON, R0);
    const revealed = await guessAt('dave', matchId, 0, FAR, R0);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.teams).toEqual([
      { team: 0, health: 5000, total: 5000 },
      { team: 1, health: 5000 - Math.round((5000 - LONDON_SCORE) * 1.3), total: LONDON_SCORE },
    ]);
  });

  it('ends when a team runs out of health, for the other team, and pays everyone XP for their own guesses', async () => {
    const matchId = await teamMatch();
    await guessAt('alice', matchId, 0, PARIS, R0);
    await guessAt('bob', matchId, 0, LONDON, R0);
    await guessAt('carol', matchId, 0, FAR, R0);
    const last = await guessAt('dave', matchId, 0, FAR, R0);
    // 5000 x 1.3 is more than a team has: the first round decides it, and is shown as a last round is.
    expect(last).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(R0 + LAST_REVEAL_MS).toISOString() });
    const finished = await state('dave', matchId, R0 + LAST_REVEAL_MS);
    expect(finished).toMatchObject({ phase: 'finished', round: 0, outcome: { winners: ['alice', 'bob'], ratingChanges: [], dodgedBy: null } });
    expect(finished.teams?.map((team) => team.health)).toEqual([5000, 0]);

    const xp = Object.fromEntries((await stored('SELECT username, xp, rating FROM users')).map((row) => [row.username, [row.xp, row.rating]]));
    expect(xp).toMatchObject({ alice: [100, 500], bob: [Math.round(LONDON_SCORE / 50), 500], carol: [0, 500], dave: [0, 500] });
    const history = await stored('SELECT u.username, g.result, g.players, g.kind FROM online_games g JOIN users u ON u.id = g.user_id ORDER BY u.username');
    expect(history).toEqual([
      { username: 'alice', result: 'win', players: 4, kind: 'team' },
      { username: 'bob', result: 'win', players: 4, kind: 'team' },
      { username: 'carol', result: 'loss', players: 4, kind: 'team' },
      { username: 'dave', result: 'loss', players: 4, kind: 'team' },
    ]);
  });

  it('goes to the team with more health after five rounds, and is a draw when they are level', async () => {
    const matchId = await teamMatch();
    let at = R0;
    for (const round of [0, 1, 2, 3, 4]) {
      for (const name of ['alice', 'bob', 'carol', 'dave']) {
        await guessAt(name, matchId, round, LONDON, at);
      }
      at += round === 4 ? LAST_REVEAL_MS : REVEAL_MS + COUNTDOWN_MS;
    }
    expect(await state('alice', matchId, at)).toMatchObject({ phase: 'finished', round: 4, outcome: { winners: [] } });
  });

  it('shows a player where their teammate\'s pin is while the round is played, and never an opponent\'s', async () => {
    const matchId = await teamMatch();
    const pinned = yes(await pin(db, idOf('alice'), { matchId, round: 0, lng: 10, lat: 20 }, R0));
    expect(pinned.mates).toEqual([]);
    expect((await state('bob', matchId, R0)).mates).toEqual([{ username: 'alice', lng: 10, lat: 20, guessed: false }]);
    expect((await state('carol', matchId, R0)).mates).toEqual([]);

    yes(await pin(db, idOf('alice'), { matchId, round: 0, lng: 11, lat: 21 }, R0 + SECOND));
    await guessAt('alice', matchId, 0, LONDON, R0 + 2 * SECOND);
    expect((await state('bob', matchId, R0 + 2 * SECOND)).mates).toEqual([{ username: 'alice', ...LONDON, guessed: true }]);
    expect(JSON.stringify(await state('dave', matchId, R0 + 2 * SECOND))).not.toContain(String(LONDON.lat));
  });

  it('ignores a pin for another round, or before the round has started', async () => {
    const matchId = await teamMatch();
    yes(await pin(db, idOf('alice'), { matchId, round: 1, lng: 10, lat: 20 }, R0));
    yes(await pin(db, idOf('alice'), { matchId, round: 0, lng: 10, lat: 20 }, R0 - 1));
    expect((await state('bob', matchId, R0)).mates).toEqual([]);
  });

  it('delivers a line said to the team to the team only, and one said to all to everyone', async () => {
    const matchId = await teamMatch();
    yes(await say(db, idOf('alice'), matchId, { text: 'try north', emote: null, scope: 'team' }, T));
    yes(await say(db, idOf('carol'), matchId, { text: 'good luck', emote: null, scope: 'all' }, T));
    const seenBy = async (name: string) => (await state(name, matchId, T + SECOND)).chat.map((entry) => [entry.username, entry.text, entry.scope]);
    expect(await seenBy('bob')).toEqual([
      ['alice', 'try north', 'team'],
      ['carol', 'good luck', 'all'],
    ]);
    expect(await seenBy('dave')).toEqual([['carol', 'good luck', 'all']]);
  });

  it('goes to the team that stayed when the other team has both gone', async () => {
    const matchId = await teamMatch();
    await guessAt('alice', matchId, 0, PARIS, R0);
    yes(await leaveMatch(db, idOf('carol'), matchId, R0 + SECOND));
    expect((await state('alice', matchId, R0 + SECOND)).phase).toBe('playing');
    yes(await leaveMatch(db, idOf('dave'), matchId, R0 + 2 * SECOND));
    expect(await state('bob', matchId, R0 + 2 * SECOND)).toMatchObject({ phase: 'finished', outcome: { winners: ['alice', 'bob'] } });
  });
});

describe('queueing for 2v2 as a pair', () => {
  /** A party lobby of alice (host) and bob. */
  async function lobbyOfTwo(): Promise<string> {
    const lobby = yes(await createParty(db, idOf('alice'), SETTINGS, T));
    yes(await joinParty(db, idOf('bob'), lobby.code ?? '', T));
    return lobby.id;
  }

  it('closes the lobby, tells its other player where they have gone, and queues both together', async () => {
    const lobbyId = await lobbyOfTwo();
    const queued = yes(await queueAsPair(db, idOf('alice'), lobbyId, T + SECOND));
    expect(queued).toMatchObject({ queued: true, kind: 'team', waiting: 2, matchId: null });
    expect(await state('bob', lobbyId, T + 2 * SECOND)).toMatchObject({ phase: 'finished', movedToQueue: 'team', outcome: { winners: [] } });
    expect(await pollQueue(db, idOf('bob'), T + 2 * SECOND)).toMatchObject({ queued: true, kind: 'team', waiting: 2 });
    expect(await stored('SELECT DISTINCT group_id FROM match_queue')).toEqual([{ group_id: lobbyId }]);
    expect(await stored('SELECT 1 FROM online_games')).toEqual([]);
  });

  it('puts the pair on one team when two more arrive', async () => {
    const lobbyId = await lobbyOfTwo();
    yes(await queueAsPair(db, idOf('alice'), lobbyId, T));
    yes(await joinQueue(db, idOf('carol'), 'team', T + SECOND));
    const { matchId } = yes(await joinQueue(db, idOf('dave'), 'team', T + SECOND));
    const seen = await state('bob', matchId ?? '', T + SECOND);
    const teamOf = new Map(seen.players.map((player) => [player.username, player.team]));
    expect(teamOf.get('alice')).toBe(teamOf.get('bob'));
    expect(teamOf.get('carol')).toBe(teamOf.get('dave'));
    expect(teamOf.get('alice')).not.toBe(teamOf.get('carol'));
  });

  it('leaves one of a pair queued, alone, when the other leaves the queue', async () => {
    const lobbyId = await lobbyOfTwo();
    yes(await queueAsPair(db, idOf('alice'), lobbyId, T));
    await leaveQueue(db, idOf('alice'), T + SECOND);
    expect(await pollQueue(db, idOf('bob'), T + SECOND)).toMatchObject({ queued: true, kind: 'team', waiting: 1 });
    for (const name of ['carol', 'dave']) {
      yes(await joinQueue(db, idOf(name), 'team', T + SECOND));
    }
    expect((await joinQueue(db, idOf('erin'), 'team', T + SECOND)).ok).toBe(true);
    expect(await open()).toHaveLength(4);
  });

  it.each([
    ['is not its host', async (lobbyId: string) => queueAsPair(db, idOf('bob'), lobbyId, T)],
    ['is not in it', async (lobbyId: string) => queueAsPair(db, idOf('carol'), lobbyId, T)],
    ['names a match that does not exist', async () => queueAsPair(db, idOf('alice'), randomUUID(), T)],
  ])('is refused for a player who %s', async (_name, attempt) => {
    const lobbyId = await lobbyOfTwo();
    expect(await attempt(lobbyId)).toEqual({ ok: false, status: 409, error: 'To queue as a pair, be the host of a party of exactly two.' });
    expect((await state('alice', lobbyId, T)).phase).toBe('lobby');
    expect(await stored('SELECT 1 FROM match_queue')).toEqual([]);
  });

  it('is refused for a lobby of one or of three, and for one whose other player has stopped polling', async () => {
    const alone = yes(await createParty(db, idOf('alice'), SETTINGS, T));
    expect((await queueAsPair(db, idOf('alice'), alone.id, T)).ok).toBe(false);
    yes(await joinParty(db, idOf('bob'), alone.code ?? '', T));
    yes(await joinParty(db, idOf('carol'), alone.code ?? '', T));
    expect((await queueAsPair(db, idOf('alice'), alone.id, T)).ok).toBe(false);
    yes(await leaveMatch(db, idOf('carol'), alone.id, T));
    expect((await queueAsPair(db, idOf('alice'), alone.id, T + 31 * SECOND)).ok).toBe(false);
  });
});

describe('2v2 matchmaking under concurrency', () => {
  const slowly = () => pausingAfter(db, /queue_gathering|FROM match_queue|FROM matches/);

  it('makes one match when four players poll at once', async () => {
    await waiting(['alice', 'bob', 'carol', 'dave']);
    const slow = slowly();
    const seen = await Promise.all(['alice', 'bob', 'carol', 'dave'].map((name) => pollQueue(slow, idOf(name), T)));
    const made = await stored('SELECT id FROM matches');
    expect(made).toHaveLength(1);
    expect(seen.map((reply) => reply.matchId)).toEqual(Array.from({ length: 4 }, () => made[0]?.id));
    expect(await open()).toHaveLength(4);
  });

  it('puts nobody in two matches when a pair, four alone and a late arrival are all asking at once', async () => {
    const lobby = yes(await createParty(db, idOf('alice'), SETTINGS, T));
    yes(await joinParty(db, idOf('bob'), lobby.code ?? '', T));
    await waiting(['carol', 'dave', 'erin']);
    const slow = slowly();
    await Promise.allSettled([
      queueAsPair(slow, idOf('alice'), lobby.id, T),
      pollQueue(slow, idOf('carol'), T),
      pollQueue(slow, idOf('dave'), T),
      joinQueue(slow, idOf('frank'), 'team', T),
      pollQueue(slow, idOf('erin'), T),
    ]);
    for (const name of names) {
      await pollQueue(db, idOf(name), T + SECOND);
    }
    const seats = await open();
    const players = seats.map(([userId]) => userId);
    expect(new Set(players).size).toBe(players.length);
    const queued = (await stored('SELECT user_id FROM match_queue')).map((row) => row.user_id);
    expect(players.filter((userId) => queued.includes(userId))).toEqual([]);
    // Six asked: four are playing, and the two left are still waiting.
    expect([players.length, queued.length]).toEqual([4, 2]);
    expect(new Set(seats.map(([, matchId]) => matchId)).size).toBe(1);
  });

  it('takes the health once, and ends the match once, when all four guess and then poll at the same moment', async () => {
    const matchId = await teamMatch();
    const slow = slowly();
    const at = (name: string, where: Spot) => guess(slow, idOf(name), { matchId, round: 0, lng: where.lng, lat: where.lat }, R0);
    const replies = await Promise.all([at('alice', PARIS), at('bob', LONDON), at('carol', FAR), at('dave', FAR)]);
    expect(replies.map((reply) => reply.ok)).toEqual([true, true, true, true]);
    expect((await state('alice', matchId, R0 + SECOND)).teams?.map((team) => team.health)).toEqual([5000, 0]);

    const over = R0 + LAST_REVEAL_MS;
    const four = ['alice', 'bob', 'carol', 'dave'];
    const seen = await Promise.all(four.map((name) => state(name, matchId, over, slow)));
    expect(seen.map((one) => one.outcome?.winners)).toEqual(four.map(() => ['alice', 'bob']));
    expect(await stored('SELECT u.username, g.result FROM online_games g JOIN users u ON u.id = g.user_id ORDER BY u.username')).toEqual([
      { username: 'alice', result: 'win' },
      { username: 'bob', result: 'win' },
      { username: 'carol', result: 'loss' },
      { username: 'dave', result: 'loss' },
    ]);
    const xp = Object.fromEntries((await stored('SELECT username, xp FROM users')).map((row) => [row.username, row.xp]));
    expect(xp).toMatchObject({ alice: 100, bob: Math.round(LONDON_SCORE / 50), carol: 0, dave: 0 });
    expect(await open()).toEqual([]);
  });

  it('either queues the pair or leaves the lobby as it was when its second player leaves as the host queues them', async () => {
    const lobby = yes(await createParty(db, idOf('alice'), SETTINGS, T));
    yes(await joinParty(db, idOf('bob'), lobby.code ?? '', T));
    const slow = slowly();
    const [queued] = await Promise.all([queueAsPair(slow, idOf('alice'), lobby.id, T), leaveMatch(slow, idOf('bob'), lobby.id, T)]);
    const inQueue = (await stored('SELECT user_id FROM match_queue ORDER BY user_id')).map((row) => row.user_id);
    if (queued.ok) {
      expect(inQueue).toEqual([idOf('alice'), idOf('bob')].sort());
      expect((await state('alice', lobby.id, T)).movedToQueue).toBe('team');
    } else {
      expect(inQueue).toEqual([]);
      expect(await state('alice', lobby.id, T)).toMatchObject({ phase: 'lobby', movedToQueue: null });
    }
  });
});
