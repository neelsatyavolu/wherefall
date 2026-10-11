import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { setBanned } from '../db/moderation.js';
import { typicalWait } from '../db/queue.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty, type PartySettings } from './parties.js';
import { backToLobby, configure, endRound, getMatch, guess, handOver, kick, leaveMatch, lock, postPlaces, startMatch } from './play.js';
import { joinQueue, pollQueue, queueAsPair } from './queue.js';
import { COUNTDOWN_MS, GATHER_MS, LAST_REVEAL_MS, PREPARE_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

// What the security review found in matches, each as it should now behave.
const T = 1_800_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const R0 = T + COUNTDOWN_MS;
const SCALE_KM = 20_000;
const PARIS = { lng: 2.3522, lat: 48.8566 };
const FAR = { lng: 2.3522 - 180, lat: -48.8566 };
const SETTINGS = { map: 'world', mode: 'move', timeLimit: 30, rounds: 2 } as const;
const places = (count: number) => Array.from({ length: count }, (_unused, index) => ({ id: `p${index}`, ...PARIS, country: 'FR' }));
const HOST_ONLY = { ok: false, status: 403, error: 'Only the host can do that.' };

let db: Db;
let alice: string;
let bob: string;
let carol: string;
let dave: string;

async function addUser(username: string, guest = false): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: T });
  if (guest) {
    await db.query('UPDATE users SET guest = true WHERE id = $1', [id]);
  }
  return id;
}

function yes<V>(reply: Reply<V>): V {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const state = (userId: string, matchId: string, now: number): Promise<MatchState> => getMatch(db, userId, matchId, now).then(yes);
const guessAt = (userId: string, matchId: string, round: number, where: { lng: number; lat: number }, now: number) =>
  guess(db, userId, { matchId, round, ...where }, now).then(yes);
const namesIn = (seen: MatchState): string[] => seen.players.map((player) => player.username);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);

async function lobby(settings: PartySettings = SETTINGS, others: string[] = [bob]): Promise<{ id: string; code: string }> {
  const made = yes(await createParty(db, alice, settings, T));
  for (const userId of others) {
    yes(await joinParty(db, userId, made.code ?? '', T));
  }
  return { id: made.id, code: made.code ?? '' };
}

async function playing(settings: PartySettings = SETTINGS, others: string[] = [bob]): Promise<{ id: string; code: string }> {
  const party = await lobby(settings, others);
  yes(await startMatch(db, alice, party.id, T));
  yes(await postPlaces(db, alice, { matchId: party.id, places: places(settings.rounds), scaleKm: SCALE_KM }, T));
  return party;
}

/** Everyone guesses in Paris in every round. Returns when the party is finished. */
async function playOut(id: string, rounds: number, players: string[]): Promise<number> {
  let at = R0;
  for (let round = 0; round < rounds; round += 1) {
    for (const userId of players) {
      await guessAt(userId, id, round, PARIS, at);
    }
    at += round === rounds - 1 ? LAST_REVEAL_MS : REVEAL_MS + COUNTDOWN_MS;
  }
  return at;
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol, dave] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol'), addUser('dave')]);
});

describe('a host who leaves a game under way', () => {
  it('has none of the host’s powers afterwards', async () => {
    const party = await playing(SETTINGS, [bob, carol]);
    yes(await leaveMatch(db, alice, party.id, R0));
    expect(await kick(db, alice, party.id, 'bob', R0 + SECOND)).toEqual(HOST_ONLY);
    expect(await lock(db, alice, party.id, true, R0 + SECOND)).toEqual(HOST_ONLY);
    expect(await endRound(db, alice, party.id, R0 + SECOND)).toEqual(HOST_ONLY);
    expect(await handOver(db, alice, party.id, 'carol', R0 + SECOND)).toEqual(HOST_ONLY);
    expect(await configure(db, alice, party.id, { ...SETTINGS, communication: 'off', teams: 'none', guests: true }, R0 + SECOND)).toEqual(HOST_ONLY);
    const at = await playOut(party.id, 2, [bob, carol]);
    expect(await backToLobby(db, alice, party.id, at)).toEqual(HOST_ONLY);
    expect(namesIn(await state(bob, party.id, at))).toEqual(['alice', 'bob', 'carol']);
  });

  it('either locks the party first or is refused, never locks it after leaving, when the two arrive together', async () => {
    const party = await playing(SETTINGS, [bob, carol]);
    const slow = pausingAfter(db, /FROM matches/);
    const [locked] = await Promise.all([lock(slow, alice, party.id, true, R0), leaveMatch(slow, alice, party.id, R0)]);
    const seen = await state(bob, party.id, R0);
    expect(seen.you.isHost).toBe(true);
    expect(seen.locked).toBe(locked.ok);
    if (!locked.ok) {
      expect(locked).toEqual(HOST_ONLY);
    }
  });

  it('makes one new host when the host leaves as the next player in line does', async () => {
    const party = await playing(SETTINGS, [bob, carol, dave]);
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([leaveMatch(slow, alice, party.id, R0), leaveMatch(slow, bob, party.id, R0)]);
    const hosts = await Promise.all([carol, dave].map(async (userId) => (await state(userId, party.id, R0 + SECOND)).you.isHost));
    expect(hosts.filter(Boolean)).toHaveLength(1);
  });

  it('leaves the party to the next account in it, who can end the round and take everyone back to the lobby', async () => {
    const party = await playing(SETTINGS, [bob, carol]);
    yes(await leaveMatch(db, alice, party.id, R0));
    expect(await state(bob, party.id, R0)).toMatchObject({ you: { isHost: true, isResolver: true } });
    expect((await state(carol, party.id, R0)).you.isHost).toBe(false);
    // Bob ends the first round, the two of them play the second, and bob takes the party back to its lobby.
    const ended = R0 + SECOND;
    expect(yes(await endRound(db, bob, party.id, ended)).phase).toBe('reveal');
    const second = ended + REVEAL_MS + COUNTDOWN_MS;
    await guessAt(bob, party.id, 1, PARIS, second);
    await guessAt(carol, party.id, 1, PARIS, second);
    const over = second + LAST_REVEAL_MS;
    expect((await state(bob, party.id, over)).phase).toBe('finished');
    await state(carol, party.id, over);
    expect(yes(await backToLobby(db, bob, party.id, over))).toMatchObject({ phase: 'lobby', you: { isHost: true } });
    expect(namesIn(await state(carol, party.id, over))).toEqual(['bob', 'carol']);
  });

  it('leaves it to an account who is still being heard from before one who is not, and never to a guest', async () => {
    const guest = await addUser('Guest #1234', true);
    const party = await playing(SETTINGS, [guest, bob, carol]);
    // Bob stopped polling long ago; carol is there.
    await state(guest, party.id, R0 + 40 * SECOND);
    await state(carol, party.id, R0 + 40 * SECOND);
    yes(await leaveMatch(db, alice, party.id, R0 + 40 * SECOND));
    expect((await state(carol, party.id, R0 + 41 * SECOND)).you.isHost).toBe(true);
  });

  it('plays on with no host when only guests are left', async () => {
    const guest = await addUser('Guest #1234', true);
    const other = await addUser('Guest #5678', true);
    const party = await playing(SETTINGS, [guest, other]);
    yes(await leaveMatch(db, alice, party.id, R0));
    const seen = await state(guest, party.id, R0);
    expect(seen).toMatchObject({ phase: 'playing', you: { isHost: false } });
    expect((await guessAt(guest, party.id, 0, PARIS, R0)).phase).toBe('playing');
  });

  it('passes the picking of places on too when they leave before posting them', async () => {
    const party = await lobby(SETTINGS, [bob]);
    yes(await startMatch(db, alice, party.id, T));
    yes(await leaveMatch(db, alice, party.id, T + SECOND));
    expect(await state(bob, party.id, T + SECOND)).toMatchObject({ phase: 'preparing', you: { isHost: true, isResolver: true } });
    // One player is not a game, but the places are bob's to post until the match notices.
    const posted = await postPlaces(db, bob, { matchId: party.id, places: places(2), scaleKm: SCALE_KM }, T + 2 * SECOND);
    expect(posted.ok).toBe(true);
  });
});

describe('a player banned while in a party', () => {
  it('is left behind when the party goes back to its lobby, and cannot be played with again', async () => {
    const party = await playing(SETTINGS, [bob, carol]);
    await setBanned(db, bob, true);
    const at = await playOut(party.id, 2, [alice, bob, carol]);
    expect(namesIn(yes(await backToLobby(db, alice, party.id, at)))).toEqual(['alice', 'carol']);
    expect(await getMatch(db, bob, party.id, at)).toMatchObject({ ok: false, status: 404 });
    expect(await stored('SELECT 1 FROM match_players WHERE user_id = $1 AND open', [bob])).toEqual([]);
  });

  it('is left behind when the party they were waiting in starts', async () => {
    const party = await lobby(SETTINGS, [bob, carol]);
    await setBanned(db, bob, true);
    expect(namesIn(yes(await startMatch(db, alice, party.id, T)))).toEqual(['alice', 'carol']);
    expect(await getMatch(db, bob, party.id, T)).toMatchObject({ ok: false, status: 404 });
  });

  it('is not counted towards the two a party needs to start', async () => {
    const party = await lobby();
    await setBanned(db, bob, true);
    expect(await startMatch(db, alice, party.id, T)).toEqual({ ok: false, status: 409, error: 'A party needs at least 2 players to start.' });
  });

  it('cannot be queued for 2v2 as a partner', async () => {
    const party = await lobby();
    await setBanned(db, bob, true);
    expect(await queueAsPair(db, alice, party.id, T)).toEqual({ ok: false, status: 409, error: 'To queue as a pair, be the host of a party of exactly two.' });
    expect(await stored('SELECT 1 FROM match_queue')).toEqual([]);
  });

  it('is not put back in the ranked queue when their opponent walks out', async () => {
    yes(await joinQueue(db, alice, 'ranked', T - 1));
    const { matchId } = yes(await joinQueue(db, bob, 'ranked', T));
    await setBanned(db, bob, true);
    yes(await leaveMatch(db, alice, matchId ?? '', T + SECOND));
    expect((await state(bob, matchId ?? '', T + SECOND)).outcome).toEqual({ winners: [], ratingChanges: [], dodgedBy: 'alice' });
    expect(await stored('SELECT 1 FROM match_queue')).toEqual([]);
  });
});

describe('a party that does not take guests', () => {
  const NO_GUESTS = { ok: false, status: 403, error: 'This party is for accounts only. Make an account to join.' };

  it('takes guests unless its host says otherwise, and says which in its settings', async () => {
    const guest = await addUser('Guest #1234', true);
    const party = await lobby();
    expect((await state(alice, party.id, T)).settings.guests).toBe(true);
    expect(namesIn(yes(await joinParty(db, guest, party.code, T)))).toContain('Guest #1234');
  });

  it('refuses a guest at the door, in its lobby and with a game under way, and lets an account in', async () => {
    const guest = await addUser('Guest #1234', true);
    const party = await lobby({ ...SETTINGS, rounds: 3, guests: false });
    expect((await state(alice, party.id, T)).settings.guests).toBe(false);
    expect(await joinParty(db, guest, party.code, T)).toEqual(NO_GUESTS);
    yes(await startMatch(db, alice, party.id, T));
    yes(await postPlaces(db, alice, { matchId: party.id, places: places(3), scaleKm: SCALE_KM }, T));
    expect(await joinParty(db, guest, party.code, R0)).toEqual(NO_GUESTS);
    expect(namesIn(yes(await joinParty(db, carol, party.code, R0)))).toContain('carol');
    expect(await stored('SELECT 1 FROM match_players WHERE user_id = $1', [guest])).toEqual([]);
  });

  it('keeps the guests already in it when the host turns guests off, and takes no more', async () => {
    const [guest, late] = [await addUser('Guest #1234', true), await addUser('Guest #5678', true)];
    const party = await lobby(SETTINGS, [guest]);
    const closed = yes(await configure(db, alice, party.id, { ...SETTINGS, communication: 'chat', teams: 'none', guests: false }, T));
    expect(closed.settings.guests).toBe(false);
    expect(namesIn(closed)).toEqual(['alice', 'Guest #1234']);
    expect(await joinParty(db, late, party.code, T)).toEqual(NO_GUESTS);
    // The host can still remove the one who is there.
    expect(namesIn(yes(await kick(db, alice, party.id, 'Guest #1234', T)))).toEqual(['alice']);
  });
});

describe('the 2v2 record', () => {
  const record = async () =>
    Object.fromEntries((await stored('SELECT username, team_wins, team_losses, team_ties FROM users')).map((row) => [row.username, [row.team_wins, row.team_losses, row.team_ties]]));

  /** A 2v2 match of alice and bob against carol and dave, with its first round running from R0. */
  async function teamMatch(): Promise<string> {
    const pair = randomUUID();
    for (const [index, userId] of [alice, bob, carol, dave].entries()) {
      await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at, group_id) VALUES ($1, $2, $3, $4, $5)', [userId, 'team', new Date(T + index), new Date(T), index < 2 ? pair : null]);
    }
    const { matchId } = await pollQueue(db, alice, T);
    yes(await postPlaces(db, alice, { matchId: matchId ?? '', places: places(5), scaleKm: SCALE_KM }, T));
    return matchId ?? '';
  }

  it('counts a win for each of the winners and a loss for each of the losers, once', async () => {
    const matchId = await teamMatch();
    for (const [userId, where] of [[alice, PARIS], [bob, PARIS], [carol, FAR], [dave, FAR]] as const) {
      await guessAt(userId, matchId, 0, where, R0);
    }
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([alice, bob, carol, dave].map((userId) => getMatch(slow, userId, matchId, R0 + LAST_REVEAL_MS)));
    expect((await state(alice, matchId, R0 + LAST_REVEAL_MS)).outcome?.winners).toEqual(['alice', 'bob']);
    expect(await record()).toEqual({ alice: [1, 0, 0], bob: [1, 0, 0], carol: [0, 1, 0], dave: [0, 1, 0] });
  });

  it('counts a tie for all four when the teams finish level', async () => {
    const matchId = await teamMatch();
    let at = R0;
    for (let round = 0; round < 5; round += 1) {
      for (const userId of [alice, bob, carol, dave]) {
        await guessAt(userId, matchId, round, PARIS, at);
      }
      at += round === 4 ? LAST_REVEAL_MS : REVEAL_MS + COUNTDOWN_MS;
    }
    expect((await state(alice, matchId, at)).outcome?.winners).toEqual([]);
    expect(await record()).toEqual({ alice: [0, 0, 1], bob: [0, 0, 1], carol: [0, 0, 1], dave: [0, 0, 1] });
  });

  it('is not touched by a party, a duel or a public game', async () => {
    const party = await playing();
    await playOut(party.id, 2, [alice, bob]);
    await state(alice, party.id, R0 + HOUR);
    expect(await record()).toMatchObject({ alice: [0, 0, 0], bob: [0, 0, 0] });
  });
});

describe('the typical wait of a queue', () => {
  it('is unknown while no match has been found in it, and a queue that has never been waited in says so', async () => {
    expect(await typicalWait(db, 'ranked', T)).toBeNull();
    expect(yes(await joinQueue(db, alice, 'ranked', T)).typicalWaitSeconds).toBeNull();
    expect((await pollQueue(db, dave, T)).typicalWaitSeconds).toBeNull();
  });

  it('is the median of how long the players of the last day’s matches waited, in that queue only', async () => {
    // Alice waited 8 seconds, bob none: a median of 4.
    yes(await joinQueue(db, alice, 'ranked', T - 8 * SECOND));
    await pollQueue(db, alice, T - SECOND);
    expect(yes(await joinQueue(db, bob, 'ranked', T)).matchId).not.toBeNull();
    expect(await typicalWait(db, 'ranked', T)).toBe(4);
    expect(await typicalWait(db, 'team', T)).toBeNull();
    expect(yes(await joinQueue(db, carol, 'ranked', T + SECOND)).typicalWaitSeconds).toBe(4);
    expect(yes(await joinQueue(db, dave, 'team', T + SECOND)).typicalWaitSeconds).toBeNull();
    expect(await stored('SELECT kind, waited_ms FROM queue_waits ORDER BY waited_ms')).toEqual([
      { kind: 'ranked', waited_ms: 0 },
      { kind: 'ranked', waited_ms: 8000 },
    ]);
  });

  it('forgets a match found more than a day ago', async () => {
    await db.query("INSERT INTO queue_waits (kind, found_at, waited_ms) VALUES ('team', $1, 90000), ('team', $2, 30000)", [new Date(T - 24 * HOUR), new Date(T - 23 * HOUR)]);
    expect(await typicalWait(db, 'team', T)).toBe(30);
    expect(await typicalWait(db, 'team', T + HOUR)).toBeNull();
    // Old rows go when a queue is next joined.
    yes(await joinQueue(db, alice, 'team', T + HOUR));
    expect(await stored('SELECT 1 FROM queue_waits')).toEqual([]);
  });

  it('counts the players of a public game by how long each waited, and one put straight into a game under way as not waiting', async () => {
    yes(await joinQueue(db, alice, 'unranked', T - GATHER_MS));
    yes(await joinQueue(db, bob, 'unranked', T - GATHER_MS + 2 * SECOND));
    await pollQueue(db, alice, T - GATHER_MS / 2);
    await pollQueue(db, bob, T - GATHER_MS / 2);
    const { matchId } = await pollQueue(db, alice, T + 2 * SECOND);
    yes(await postPlaces(db, alice, { matchId: matchId ?? '', places: places(5), scaleKm: SCALE_KM }, T + 2 * SECOND));
    expect(yes(await joinQueue(db, carol, 'unranked', T + 3 * SECOND)).matchId).toBe(matchId);
    expect((await stored("SELECT waited_ms FROM queue_waits WHERE kind = 'unranked' ORDER BY waited_ms")).map((row) => row.waited_ms)).toEqual([0, 10_000, 12_000]);
    expect(await typicalWait(db, 'unranked', T + 3 * SECOND)).toBe(10);
  });
});

describe('a round that is called off because the places never came', () => {
  it('is nobody’s walk-out in a party or a public game', async () => {
    const party = await lobby();
    yes(await startMatch(db, alice, party.id, T));
    await state(bob, party.id, T + 20 * SECOND);
    await state(alice, party.id, T + 20 * SECOND);
    expect((await state(bob, party.id, T + PREPARE_MS)).outcome).toEqual({ winners: [], ratingChanges: [], dodgedBy: null });
  });
});
