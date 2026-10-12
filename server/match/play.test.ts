import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty } from './parties.js';
import { getMatch, guess, leaveMatch, lock, postPlaces, startMatch } from './play.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { COUNTDOWN_MS, GUESS_GRACE_MS, INACTIVE_AFTER_MS, LAST_REVEAL_MS, PREPARE_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const ROUND_MS = 30 * SECOND;
/** When the first round starts and ends, for a match whose places were posted at T. */
const R0 = T + COUNTDOWN_MS;
const END0 = R0 + ROUND_MS;
const SCALE_KM = 14_916.862;
const SETTINGS = { map: 'europe', mode: 'nmpz', timeLimit: 30, rounds: 3 } as const;

const PARIS = { id: 'paris', lng: 2.3522, lat: 48.8566, country: 'FR' };
const NEW_YORK = { id: 'new-york', lng: -74.006, lat: 40.7128, country: 'US' };
const TOKYO = { id: 'tokyo', lng: 139.6917, lat: 35.6895, country: 'JP' };
const PLACES = [PARIS, NEW_YORK, TOKYO];
const LONDON = { lng: -0.1276, lat: 51.5072 };
const LONDON_FOR_PARIS = scoreForDistance(distanceKm(PARIS, LONDON), SCALE_KM);

let db: Db;
let alice: string;
let bob: string;
let carol: string;

async function addUser(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: T });
  return id;
}

/** The data of a reply that should have been accepted. */
function yes<T>(reply: Reply<T>): T {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const pin = (userId: string, matchId: string, round: number, where: { lng: number; lat: number }, now: number, on: Db = db) =>
  guess(on, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);

/** A lobby with alice as host and bob in it. */
async function lobby(): Promise<MatchState> {
  const created = yes(await createParty(db, alice, SETTINGS, T));
  return yes(await joinParty(db, bob, created.code ?? '', T));
}

/** A party of alice and bob whose places were posted at T, so its first round runs from R0 to END0. */
async function playing(): Promise<string> {
  const { id } = await lobby();
  yes(await startMatch(db, alice, id, T));
  yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T));
  return id;
}

const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol')]);
});

describe('createParty', () => {
  it('opens a lobby with the player as host and resolver', async () => {
    const created = yes(await createParty(db, alice, SETTINGS, T));
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      code: expect.stringMatching(/^[A-HJKMNP-Z2-9]{6}$/),
      kind: 'party',
      phase: 'lobby',
      settings: { ...SETTINGS, communication: 'chat', teams: 'none', guests: true },
      locked: false,
      seed: expect.stringMatching(/^[a-z0-9]{1,32}$/),
      serverNow: new Date(T).toISOString(),
      round: 0,
      roundStartsAt: null,
      roundEndsAt: null,
      revealEndsAt: null,
      you: { username: 'alice', isHost: true, isResolver: true, team: null, guest: false, muted: [] },
      players: [{ username: 'alice', country: null, guest: false, team: null, total: 0, guessed: false, active: true, rating: null, health: null }],
      teams: null,
      picker: null,
      mates: [],
      places: null,
      results: [],
      outcome: null,
      chat: [],
      movedToQueue: null,
    });
  });

  it.each(['africa', 'country:FR', 'country:JP'])('opens a party on the map %s', async (map) => {
    expect(yes(await createParty(db, alice, { ...SETTINGS, map }, T)).settings.map).toBe(map);
  });

  it('refuses a player who is in an unfinished match, naming the situation', async () => {
    await lobby();
    expect(await createParty(db, bob, SETTINGS, T + SECOND)).toEqual({
      ok: false,
      status: 409,
      error: 'You are already in a match. Leave it before you start another.',
    });
    expect(await stored('SELECT id FROM matches')).toHaveLength(1);
  });

  it('lets a player whose last match everyone walked away from start another', async () => {
    const old = yes(await createParty(db, alice, SETTINGS, T));
    const created = yes(await createParty(db, alice, SETTINGS, T + INACTIVE_AFTER_MS));
    expect(created.id).not.toBe(old.id);
    expect((await state(alice, old.id, T + INACTIVE_AFTER_MS)).phase).toBe('finished');
  });

  it('draws another code when the first belongs to a party already', async () => {
    const codes = ['SAME22', 'SAME22', 'FRESH2'];
    const first = yes(await createParty(db, alice, SETTINGS, T, () => codes.shift() ?? ''));
    const second = yes(await createParty(db, bob, SETTINGS, T, () => codes.shift() ?? ''));
    expect([first.code, second.code]).toEqual(['SAME22', 'FRESH2']);
  });

  it('gives up, changing nothing, when no free code turns up', async () => {
    yes(await createParty(db, alice, SETTINGS, T, () => 'TAKEN2'));
    await expect(createParty(db, bob, SETTINGS, T, () => 'TAKEN2')).rejects.toThrow('Could not find a free party code');
    expect(await stored('SELECT match_id FROM match_players WHERE user_id = $1', [bob])).toEqual([]);
  });

  it('answers a player whose account is gone as signed out', async () => {
    expect(await createParty(db, randomUUID(), SETTINGS, T)).toMatchObject({ ok: false, status: 401 });
  });

  it('takes the player out of any queue they were waiting in', async () => {
    await db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $3)', [alice, 'ranked', new Date(T)]);
    yes(await createParty(db, alice, SETTINGS, T));
    expect(await stored('SELECT user_id FROM match_queue')).toEqual([]);
  });

  it('opens one party, not two, for two requests at the same moment', async () => {
    const slow = pausingAfter(db, /FROM users/);
    const replies = await Promise.all([createParty(slow, alice, SETTINGS, T), createParty(slow, alice, SETTINGS, T)]);
    expect(replies.map((reply) => reply.ok).sort()).toEqual([false, true]);
    expect(await stored('SELECT id FROM matches')).toHaveLength(1);
  });

  it('deletes matches that finished more than a day ago, and ones everyone abandoned, but nothing newer', async () => {
    const DAY = 24 * 60 * 60 * SECOND;
    const finished = yes(await createParty(db, alice, SETTINGS, T));
    yes(await leaveMatch(db, alice, finished.id, T));
    const abandoned = yes(await createParty(db, bob, SETTINGS, T + SECOND));
    const recent = yes(await createParty(db, alice, SETTINGS, T + DAY));

    yes(await createParty(db, carol, SETTINGS, T + DAY + 2 * SECOND));
    const left = (await stored('SELECT id FROM matches')).map((row) => row.id);
    expect(left).not.toContain(finished.id);
    expect(left).not.toContain(abandoned.id);
    expect(left).toContain(recent.id);
    expect(await stored('SELECT match_id FROM match_players WHERE match_id = $1', [abandoned.id])).toEqual([]);
  });
});

describe('joinParty', () => {
  it('adds the player to the lobby, where everyone sees them', async () => {
    const joined = await lobby();
    expect(joined.you).toEqual({ username: 'bob', isHost: false, isResolver: false, team: null, guest: false, muted: [] });
    expect(joined.players.map((player) => player.username)).toEqual(['alice', 'bob']);
    expect((await state(alice, joined.id, T + SECOND)).players.map((player) => player.username)).toEqual(['alice', 'bob']);
  });

  it('refuses a code no party has', async () => {
    expect(await joinParty(db, bob, 'NOSUCH', T)).toEqual({ ok: false, status: 404, error: 'No party has that code.' });
  });

  it('lets a player into a party under way, to play from the next round', async () => {
    const id = await playing();
    const joined = yes(await joinParty(db, carol, (await state(alice, id, T)).code ?? '', R0 + SECOND));
    expect(joined).toMatchObject({ id, phase: 'playing', round: 0, you: { username: 'carol', isHost: false } });
    expect(joined.players.map((player) => player.username)).toEqual(['alice', 'bob', 'carol']);
    // The round she arrived in goes on without her, and scores her nothing.
    expect((await pin(carol, id, 0, PARIS, R0 + 2 * SECOND)).players[2]?.guessed).toBe(false);
    await pin(alice, id, 0, PARIS, R0 + 2 * SECOND);
    expect((await pin(bob, id, 0, PARIS, R0 + 2 * SECOND)).phase).toBe('reveal');
    const next = R0 + 2 * SECOND + REVEAL_MS + COUNTDOWN_MS;
    expect((await pin(carol, id, 1, PARIS, next)).players[2]).toMatchObject({ guessed: true, total: 0 });
  });

  it('lets a player into a party that is being prepared, to play from the first round', async () => {
    const { id, code } = await lobby();
    yes(await startMatch(db, alice, id, T));
    expect(yes(await joinParty(db, carol, code ?? '', T))).toMatchObject({ phase: 'preparing' });
    yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T));
    expect((await pin(carol, id, 0, PARIS, R0)).players[2]?.guessed).toBe(true);
  });

  it('refuses a party on its last round, and one that is locked', async () => {
    const id = await playing();
    const { code } = await state(alice, id, T);
    let at = R0 + SECOND;
    for (const round of [0, 1]) {
      await pin(alice, id, round, PARIS, at);
      await pin(bob, id, round, PARIS, at);
      at += REVEAL_MS + COUNTDOWN_MS;
    }
    // Round 2, the last of three, is being played.
    expect(await joinParty(db, carol, code ?? '', at)).toEqual({
      ok: false,
      status: 409,
      error: 'That party is on its last round. Try again when it is back in its lobby.',
    });
    const other = await lobby2();
    expect(await joinParty(db, carol, other, T)).toEqual({ ok: false, status: 409, error: 'That party is locked.' });

    async function lobby2(): Promise<string> {
      const dave = await addUser('dave');
      const made = yes(await createParty(db, dave, SETTINGS, T));
      yes(await lock(db, dave, made.id, true, T));
      return made.code ?? '';
    }
  });

  it('refuses a party that has ended, including one whose lobby everyone left open and walked away from', async () => {
    const left = yes(await createParty(db, alice, SETTINGS, T));
    yes(await leaveMatch(db, alice, left.id, T));
    expect(await joinParty(db, bob, left.code ?? '', T)).toEqual({ ok: false, status: 409, error: 'That party has ended.' });

    const idle = yes(await createParty(db, alice, SETTINGS, T));
    expect(await joinParty(db, bob, idle.code ?? '', T + INACTIVE_AFTER_MS)).toMatchObject({ ok: false, status: 409, error: 'That party has ended.' });
  });

  it('refuses a forty-first player', async () => {
    const { code } = await lobby();
    for (let index = 0; index < 38; index += 1) {
      yes(await joinParty(db, await addUser(`guest${index}`), code ?? '', T));
    }
    expect(await joinParty(db, carol, code ?? '', T)).toEqual({ ok: false, status: 409, error: 'That party is full: it has 40 players.' });
  });

  it('answers a player who is already in the party with its state, at any phase, and adds them once', async () => {
    const { id, code } = await lobby();
    expect(yes(await joinParty(db, bob, code ?? '', T + SECOND)).players).toHaveLength(2);
    yes(await startMatch(db, alice, id, T + SECOND));
    expect(yes(await joinParty(db, bob, code ?? '', T + 2 * SECOND))).toMatchObject({ id, phase: 'preparing' });
    expect(await stored('SELECT user_id FROM match_players')).toHaveLength(2);
  });

  it('refuses a player who is in another unfinished match', async () => {
    const { code } = await lobby();
    yes(await createParty(db, carol, SETTINGS, T));
    expect(await joinParty(db, carol, code ?? '', T + SECOND)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('already in a match') });
  });

  it('answers a player whose account is gone as signed out', async () => {
    const { code } = await lobby();
    expect(await joinParty(db, randomUUID(), code ?? '', T)).toMatchObject({ ok: false, status: 401 });
  });

  it('adds a player once when they join twice at the same moment', async () => {
    const { id, code } = yes(await createParty(db, alice, SETTINGS, T));
    const slow = pausingAfter(db, /FROM matches/);
    const replies = await Promise.all([joinParty(slow, bob, code ?? '', T), joinParty(slow, bob, code ?? '', T)]);
    expect(replies.every((reply) => reply.ok)).toBe(true);
    expect((await state(alice, id, T)).players.map((player) => player.username)).toEqual(['alice', 'bob']);
  });

  it('seats two players who join at the same moment one after the other', async () => {
    const { id, code } = yes(await createParty(db, alice, SETTINGS, T));
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([joinParty(slow, bob, code ?? '', T), joinParty(slow, carol, code ?? '', T)]);
    expect((await state(alice, id, T)).players).toHaveLength(3);
    expect((await stored('SELECT seat FROM match_players ORDER BY seat')).map((row) => row.seat)).toEqual([0, 1, 2]);
  });

  it('ends a join racing the start in one consistent state: in before the start, or refused after it', async () => {
    const { id, code } = await lobby();
    const slow = pausingAfter(db, /FROM matches/);
    const [joined, started] = await Promise.all([joinParty(slow, carol, code ?? '', T), startMatch(slow, alice, id, T)]);
    expect(started.ok).toBe(true);
    const after = await state(alice, id, T);
    expect(after.phase).toBe('preparing');
    expect(after.players.map((player) => player.username)).toEqual(joined.ok ? ['alice', 'bob', 'carol'] : ['alice', 'bob']);
    expect(joined.ok || joined.status === 409).toBe(true);
  });
});

describe('startMatch', () => {
  it('sends the party to the resolver, for everyone', async () => {
    const { id } = await lobby();
    expect(yes(await startMatch(db, alice, id, T))).toMatchObject({ phase: 'preparing', places: null, roundStartsAt: null });
    expect((await state(bob, id, T)).phase).toBe('preparing');
  });

  it('is for the host only', async () => {
    const { id } = await lobby();
    expect(await startMatch(db, bob, id, T)).toEqual({ ok: false, status: 403, error: 'Only the host can do that.' });
    expect((await state(bob, id, T)).phase).toBe('lobby');
  });

  it('needs at least two players', async () => {
    const { id } = yes(await createParty(db, alice, SETTINGS, T));
    expect(await startMatch(db, alice, id, T)).toEqual({ ok: false, status: 409, error: 'A party needs at least 2 players to start.' });
  });

  it('changes nothing the second time, so the resolver keeps its 45 seconds from the first', async () => {
    const { id } = await lobby();
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([startMatch(slow, alice, id, T), startMatch(slow, alice, id, T)]);
    yes(await startMatch(db, alice, id, T + 20 * SECOND));
    expect((await state(alice, id, T + PREPARE_MS - 1)).phase).toBe('preparing');
    expect((await state(alice, id, T + PREPARE_MS)).phase).toBe('finished');
  });

  it('answers someone who is not in the match as if it did not exist', async () => {
    const { id } = await lobby();
    expect(await startMatch(db, carol, id, T)).toMatchObject({ ok: false, status: 404 });
    expect(await startMatch(db, alice, randomUUID(), T)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('postPlaces', () => {
  it('schedules the first round after the get-ready, and gives every player its place and no later one', async () => {
    const id = await playing();
    for (const player of [alice, bob]) {
      expect(await state(player, id, T)).toMatchObject({
        phase: 'playing',
        round: 0,
        roundStartsAt: new Date(R0).toISOString(),
        roundEndsAt: new Date(END0).toISOString(),
        revealEndsAt: null,
        places: PLACES.slice(0, 1),
        results: [],
      });
    }
  });

  it('is for the resolver only', async () => {
    const { id } = await lobby();
    yes(await startMatch(db, alice, id, T));
    const reply = await postPlaces(db, bob, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T);
    expect(reply).toEqual({ ok: false, status: 403, error: 'Only the player picking the places can post them.' });
    expect((await state(alice, id, T)).places).toBeNull();
  });

  it('needs one place for each round', async () => {
    const { id } = await lobby();
    yes(await startMatch(db, alice, id, T));
    const reply = await postPlaces(db, alice, { matchId: id, places: PLACES.slice(0, 2), scaleKm: SCALE_KM }, T);
    expect(reply).toEqual({ ok: false, status: 400, error: 'This match needs exactly 3 places.' });
  });

  it('keeps the first list when places are posted twice, and does not restart the round', async () => {
    const id = await playing();
    const again = yes(await postPlaces(db, alice, { matchId: id, places: [TOKYO, TOKYO, TOKYO], scaleKm: 100 }, T + 5 * SECOND));
    expect(again).toMatchObject({ places: PLACES.slice(0, 1), roundStartsAt: new Date(R0).toISOString() });
  });

  it('changes nothing in a lobby', async () => {
    const { id } = await lobby();
    expect(yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T))).toMatchObject({ phase: 'lobby', places: null });
  });

  it('is too late after 45 seconds: the match is cancelled, with no winner', async () => {
    const { id } = await lobby();
    yes(await startMatch(db, alice, id, T));
    await state(bob, id, T + 20 * SECOND);
    const late = yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T + PREPARE_MS));
    expect(late).toMatchObject({ phase: 'finished', places: null, results: [], outcome: { winners: [], ratingChanges: [], dodgedBy: null } });
  });
});

describe('guess', () => {
  it('scores the guess as the game does, and keeps it from the other player until the reveal', async () => {
    const id = await playing();
    const mine = await pin(alice, id, 0, LONDON, R0 + 5 * SECOND);
    expect(mine).toMatchObject({ phase: 'playing', results: [] });
    expect(mine.players).toMatchObject([
      { username: 'alice', guessed: true, total: 0 },
      { username: 'bob', guessed: false, total: 0 },
    ]);

    const theirs = await state(bob, id, R0 + 6 * SECOND);
    expect(theirs.results).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain(String(LONDON.lat));
    expect(theirs.players.map((player) => player.guessed)).toEqual([true, false]);

    const revealed = await pin(bob, id, 0, PARIS, R0 + 7 * SECOND);
    expect(revealed).toMatchObject({ phase: 'reveal', round: 0, revealEndsAt: new Date(R0 + 7 * SECOND + REVEAL_MS).toISOString() });
    expect(revealed.results).toEqual([
      {
        round: 0,
        guesses: [
          { username: 'alice', ...LONDON, distanceKm: distanceKm(PARIS, LONDON), score: LONDON_FOR_PARIS },
          { username: 'bob', lng: PARIS.lng, lat: PARIS.lat, distanceKm: 0, score: 5000 },
        ],
      },
    ]);
    expect(revealed.players.map((player) => player.total)).toEqual([LONDON_FOR_PARIS, 5000]);
    expect(LONDON_FOR_PARIS).toBeGreaterThan(3500);
    expect(LONDON_FOR_PARIS).toBeLessThan(5000);
  });

  it('scores on the scale the resolver posted', async () => {
    const { id } = await lobby();
    yes(await startMatch(db, alice, id, T));
    yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: 2000 }, T));
    await pin(alice, id, 0, LONDON, R0);
    const revealed = await pin(bob, id, 0, LONDON, R0);
    expect(revealed.results[0]?.guesses[0]?.score).toBe(scoreForDistance(distanceKm(PARIS, LONDON), 2000));
  });

  it('ignores a second guess from the same player', async () => {
    const id = await playing();
    await pin(alice, id, 0, LONDON, R0 + SECOND);
    await pin(alice, id, 0, PARIS, R0 + 2 * SECOND);
    const revealed = await pin(bob, id, 0, PARIS, R0 + 3 * SECOND);
    expect(revealed.results[0]?.guesses[0]).toMatchObject({ username: 'alice', score: LONDON_FOR_PARIS });
  });

  it('counts one of two guesses a player sends at the same moment', async () => {
    const id = await playing();
    const slow = pausingAfter(db, /FROM matches/);
    await Promise.all([pin(alice, id, 0, LONDON, R0 + SECOND, slow), pin(alice, id, 0, LONDON, R0 + SECOND, slow)]);
    expect(await stored('SELECT user_id FROM match_guesses')).toHaveLength(1);
  });

  it('ignores a guess for a round that is not the one being played', async () => {
    const id = await playing();
    expect((await pin(alice, id, 1, LONDON, R0 + SECOND)).players[0]?.guessed).toBe(false);
    expect(await stored('SELECT user_id FROM match_guesses')).toEqual([]);
  });

  it('ignores a guess made before the round has started', async () => {
    const id = await playing();
    expect((await pin(alice, id, 0, LONDON, R0 - 1)).players[0]?.guessed).toBe(false);
    expect((await pin(alice, id, 0, LONDON, R0)).players[0]?.guessed).toBe(true);
  });

  it('takes a guess that arrives a moment after the timer reached zero, and none after that', async () => {
    const id = await playing();
    await state(bob, id, END0 - SECOND);
    expect((await pin(alice, id, 0, PARIS, END0 + GUESS_GRACE_MS - 1)).players[0]?.guessed).toBe(true);
    const late = await pin(bob, id, 0, PARIS, END0 + GUESS_GRACE_MS);
    expect(late.phase).toBe('reveal');
    expect(late.results[0]?.guesses).toMatchObject([
      { username: 'alice', score: 5000 },
      { username: 'bob', lng: null, lat: null, distanceKm: null, score: 0 },
    ]);
  });

  it('ends the round once, with both guesses in it, when the last two arrive together', async () => {
    const id = await playing();
    const slow = pausingAfter(db, /FROM matches/);
    const at = R0 + 4 * SECOND;
    const [first, second] = await Promise.all([pin(alice, id, 0, LONDON, at, slow), pin(bob, id, 0, PARIS, at, slow)]);
    expect([first.phase, second.phase].sort()).toEqual(['playing', 'reveal']);
    const after = await state(alice, id, at + SECOND);
    expect(after).toMatchObject({ phase: 'reveal', round: 0, revealEndsAt: new Date(at + REVEAL_MS).toISOString() });
    expect(after.results[0]?.guesses.map((entry) => entry.score)).toEqual([LONDON_FOR_PARIS, 5000]);
  });

  it('is refused for someone who is not in the match', async () => {
    const id = await playing();
    expect(await guess(db, carol, { matchId: id, round: 0, ...LONDON }, R0)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('the rounds', () => {
  /** Both players guess in the round being played at `at`; returns the state after the second. */
  const bothGuess = async (id: string, round: number, at: number, aliceAt = LONDON, bobAt = LONDON) => {
    await pin(alice, id, round, aliceAt, at);
    return pin(bob, id, round, bobAt, at);
  };

  it('reveal a round when its time is up, for ten seconds, then schedule the next', async () => {
    const id = await playing();
    await pin(alice, id, 0, PARIS, R0 + 20 * SECOND);
    await state(bob, id, R0 + 20 * SECOND);
    const closes = END0 + GUESS_GRACE_MS;
    expect((await state(alice, id, closes - 1)).phase).toBe('playing');
    expect(await state(alice, id, closes)).toMatchObject({ phase: 'reveal', round: 0, revealEndsAt: new Date(closes + REVEAL_MS).toISOString() });
    expect((await state(bob, id, closes + REVEAL_MS - 1)).phase).toBe('reveal');

    const next = await state(bob, id, closes + REVEAL_MS);
    expect(next).toMatchObject({
      phase: 'playing',
      round: 1,
      roundStartsAt: new Date(closes + REVEAL_MS + COUNTDOWN_MS).toISOString(),
      roundEndsAt: new Date(closes + REVEAL_MS + COUNTDOWN_MS + ROUND_MS).toISOString(),
      revealEndsAt: null,
    });
    expect(next.results.map((result) => result.round)).toEqual([0]);
    expect(next.players).toMatchObject([
      { username: 'alice', total: 5000, guessed: false },
      { username: 'bob', total: 0, guessed: false },
    ]);
  });

  it('move on once, not twice, when both players poll at the moment a round ends', async () => {
    const id = await playing();
    await Promise.all([state(alice, id, R0 + 20 * SECOND), state(bob, id, R0 + 20 * SECOND)]);
    const slow = pausingAfter(db, /FROM matches/);
    const closes = END0 + GUESS_GRACE_MS;
    const atEnd = await Promise.all([state(alice, id, closes, slow), state(bob, id, closes, slow)]);
    expect(atEnd.map((seen) => [seen.phase, seen.round, seen.revealEndsAt])).toEqual(
      Array.from({ length: 2 }, () => ['reveal', 0, new Date(closes + REVEAL_MS).toISOString()]),
    );

    const afterReveal = await Promise.all([state(alice, id, closes + REVEAL_MS, slow), state(bob, id, closes + REVEAL_MS, slow)]);
    expect(afterReveal.map((seen) => [seen.phase, seen.round])).toEqual([
      ['playing', 1],
      ['playing', 1],
    ]);
  });

  it('finish the match after the last reveal, with the highest total the winner, and free the players', async () => {
    const id = await playing();
    let at = R0 + SECOND;
    await bothGuess(id, 0, at, PARIS, LONDON);
    at += REVEAL_MS + COUNTDOWN_MS;
    await bothGuess(id, 1, at, NEW_YORK, NEW_YORK);
    at += REVEAL_MS + COUNTDOWN_MS;
    const last = await bothGuess(id, 2, at, LONDON, LONDON);
    expect(last).toMatchObject({ phase: 'reveal', round: 2, outcome: null });
    // The reveal after the last round is a short one.
    expect((await state(alice, id, at + LAST_REVEAL_MS - 1)).phase).toBe('reveal');

    const tokyoFromLondon = scoreForDistance(distanceKm(TOKYO, LONDON), SCALE_KM);
    const finished = await state(bob, id, at + LAST_REVEAL_MS);
    expect(finished).toMatchObject({ phase: 'finished', round: 2, outcome: { winners: ['alice'], ratingChanges: [], dodgedBy: null } });
    expect(finished.results.map((result) => result.round)).toEqual([0, 1, 2]);
    expect(finished.players).toMatchObject([
      { username: 'alice', total: 5000 + 5000 + tokyoFromLondon, rating: null },
      { username: 'bob', total: LONDON_FOR_PARIS + 5000 + tokyoFromLondon },
    ]);

    expect(await stored('SELECT user_id FROM match_players WHERE open')).toEqual([]);
    expect((await createParty(db, alice, SETTINGS, at + LAST_REVEAL_MS)).ok).toBe(true);
    expect((await state(alice, id, at + LAST_REVEAL_MS + SECOND)).phase).toBe('finished');
  });

  it('earn no XP in a party, whoever wins', async () => {
    const id = await playing();
    let at = R0 + SECOND;
    for (const round of [0, 1, 2]) {
      await bothGuess(id, round, at, PARIS, LONDON);
      at += REVEAL_MS + COUNTDOWN_MS;
    }
    expect((await state(alice, id, at)).phase).toBe('finished');
    expect(await stored('SELECT DISTINCT xp FROM users')).toEqual([{ xp: 0 }]);
  });

  it('call equal totals a draw', async () => {
    const id = await playing();
    let at = R0 + SECOND;
    for (const round of [0, 1, 2]) {
      await bothGuess(id, round, at);
      at += REVEAL_MS + COUNTDOWN_MS;
    }
    expect((await state(alice, id, at)).outcome).toEqual({ winners: [], ratingChanges: [], dodgedBy: null });
  });

  it('finish once when both players poll at the end of the last reveal', async () => {
    const id = await playing();
    let at = R0 + SECOND;
    for (const round of [0, 1, 2]) {
      await bothGuess(id, round, at, PARIS, LONDON);
      at += REVEAL_MS + COUNTDOWN_MS;
    }
    const slow = pausingAfter(db, /FROM matches/);
    const seen = await Promise.all([state(alice, id, at, slow), state(bob, id, at, slow)]);
    expect(seen.map((entry) => entry.outcome)).toEqual([
      { winners: ['alice'], ratingChanges: [], dodgedBy: null },
      { winners: ['alice'], ratingChanges: [], dodgedBy: null },
    ]);
  });
});

describe('inactivity', () => {
  it('shows a player who has not polled for 30 seconds as inactive, and does not wait for their guess', async () => {
    const id = await playing();
    const at = T + INACTIVE_AFTER_MS;
    expect((await state(alice, id, at - 1)).players.map((player) => player.active)).toEqual([true, true]);
    expect((await state(alice, id, at)).players.map((player) => player.active)).toEqual([true, false]);

    const revealed = await pin(alice, id, 0, PARIS, at);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.results[0]?.guesses[1]).toEqual({ username: 'bob', lng: null, lat: null, distanceKm: null, score: 0 });
  });

  it('counts a poll as a heartbeat: a player who comes back is active again and can guess', async () => {
    const id = await playing();
    await state(alice, id, R0 + 25 * SECOND);
    expect((await state(bob, id, T + INACTIVE_AFTER_MS)).players.map((player) => player.active)).toEqual([true, true]);
    // A minute in, the second round is being played, and alice has been gone for half of that minute.
    const back = await state(bob, id, T + 2 * INACTIVE_AFTER_MS);
    expect(back).toMatchObject({ phase: 'playing', round: 1 });
    expect(back.players.map((player) => player.active)).toEqual([false, true]);
    expect((await pin(bob, id, 1, NEW_YORK, T + 2 * INACTIVE_AFTER_MS + SECOND)).players[1]).toMatchObject({ guessed: true, active: true, total: 5000 });
  });

  it('ends a party, with no winner, when no one is active', async () => {
    const id = await playing();
    await pin(alice, id, 0, PARIS, R0);
    // Nobody polls again. The match is next looked at when alice starts something new.
    expect((await createParty(db, alice, SETTINGS, T + 10 * 60 * SECOND)).ok).toBe(true);
    expect(await stored('SELECT phase, round, outcome FROM matches WHERE id = $1', [id])).toEqual([
      { phase: 'finished', round: 0, outcome: { winners: [], ratingChanges: [], dodgedBy: null } },
    ]);
  });
});

describe('leaveMatch', () => {
  it('takes a guest out of the lobby, free to join again', async () => {
    const { id, code } = await lobby();
    expect(yes(await leaveMatch(db, bob, id, T))).toEqual({ left: true });
    expect((await state(alice, id, T)).players.map((player) => player.username)).toEqual(['alice']);
    expect(await getMatch(db, bob, id, T)).toMatchObject({ ok: false, status: 404 });
    expect(yes(await joinParty(db, bob, code ?? '', T)).players).toHaveLength(2);
  });

  it('passes the host on to the next player when the host leaves the lobby', async () => {
    const { id, code } = await lobby();
    yes(await joinParty(db, carol, code ?? '', T));
    yes(await leaveMatch(db, alice, id, T));
    expect((await state(bob, id, T)).you).toMatchObject({ isHost: true, isResolver: true });
    expect((await state(carol, id, T)).you).toMatchObject({ isHost: false, isResolver: false });
    expect(yes(await startMatch(db, bob, id, T)).phase).toBe('preparing');
  });

  it('ends the party when the last player leaves the lobby', async () => {
    const { id, code } = yes(await createParty(db, alice, SETTINGS, T));
    yes(await leaveMatch(db, alice, id, T));
    expect(await stored('SELECT phase, outcome FROM matches')).toEqual([{ phase: 'finished', outcome: { winners: [], ratingChanges: [], dodgedBy: null } }]);
    expect(await joinParty(db, bob, code ?? '', T)).toMatchObject({ ok: false, status: 409 });
  });

  it('leaves a party under way playing on without them, and frees the leaver for another match', async () => {
    const id = await playing();
    await pin(bob, id, 0, PARIS, R0);
    yes(await leaveMatch(db, bob, id, R0 + SECOND));

    const without = await state(alice, id, R0 + 2 * SECOND);
    expect(without.phase).toBe('playing');
    expect(without.players[1]).toMatchObject({ username: 'bob', active: false, guessed: true });
    expect((await pin(alice, id, 0, LONDON, R0 + 3 * SECOND)).phase).toBe('reveal');

    expect((await createParty(db, bob, SETTINGS, R0 + 4 * SECOND)).ok).toBe(true);
    // The leaver can still look at the match, but looking does not bring them back.
    expect((await state(bob, id, R0 + 5 * SECOND)).players[1]?.active).toBe(false);
    expect((await pin(bob, id, 0, LONDON, R0 + 5 * SECOND)).results[0]?.guesses[1]?.score).toBe(5000);
  });

  it('answers the same for a second leave, and for a match that is over', async () => {
    const id = await playing();
    yes(await leaveMatch(db, bob, id, R0));
    expect(yes(await leaveMatch(db, bob, id, R0 + SECOND))).toEqual({ left: true });
    yes(await leaveMatch(db, alice, id, R0 + SECOND));
    expect((await state(alice, id, R0 + 2 * SECOND)).phase).toBe('finished');
    expect(yes(await leaveMatch(db, alice, id, R0 + 3 * SECOND))).toEqual({ left: true });
  });

  it('is refused for someone who is not in the match', async () => {
    const { id } = await lobby();
    expect(await leaveMatch(db, carol, id, T)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('getMatch', () => {
  it('is refused for a match that does not exist and for one the asker is not in, in the same words', async () => {
    const { id } = await lobby();
    const stranger = await getMatch(db, carol, id, T);
    expect(stranger).toEqual({ ok: false, status: 404, error: 'That match does not exist, or you are not in it.' });
    expect(await getMatch(db, alice, randomUUID(), T)).toEqual(stranger);
  });

  it('carries the server clock', async () => {
    const { id } = await lobby();
    expect((await state(alice, id, T + 1234)).serverNow).toBe(new Date(T + 1234).toISOString());
  });

  it('takes the same few queries however many players and guesses the match has', async () => {
    const counting = (counts: { n: number }): Db => ({
      query: db.query,
      transaction: (fn) =>
        db.transaction((tx) =>
          fn({
            query: (sql, params) => {
              counts.n += 1;
              return tx.query(sql, params);
            },
          }),
        ),
    });
    const small = { n: 0 };
    const { id, code } = await lobby();
    await state(alice, id, T, counting(small));

    for (let index = 0; index < 6; index += 1) {
      yes(await joinParty(db, await addUser(`guest${index}`), code ?? '', T));
    }
    yes(await startMatch(db, alice, id, T));
    yes(await postPlaces(db, alice, { matchId: id, places: PLACES, scaleKm: SCALE_KM }, T));
    await pin(bob, id, 0, LONDON, R0);
    const large = { n: 0 };
    await state(alice, id, R0 + SECOND, counting(large));

    expect(small.n).toBe(4);
    expect(large.n).toBe(4);
  });
});
