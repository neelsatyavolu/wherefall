import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { resetDb, testDb } from '../testing.js';
import { createParty, joinParty, type PartySettings } from './parties.js';
import { configure, getMatch, guess, kick, leaveMatch, namePicker, pickTeam, pin, postPlaces, shuffleTeams, startMatch } from './play.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { COUNTDOWN_MS, INACTIVE_AFTER_MS, LAST_REVEAL_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const R0 = T + COUNTDOWN_MS;
const SCALE_KM = 20_000;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
const LONDON_SCORE = scoreForDistance(distanceKm(PARIS, LONDON), SCALE_KM);
const PARIS_SCORE = scoreForDistance(0, SCALE_KM);
const COOP = { map: 'world', mode: 'move', timeLimit: 30, rounds: 2, teams: 'coop' } as const;
const places = (count: number) => Array.from({ length: count }, (_unused, index) => ({ id: `p${index}`, ...PARIS, country: 'FR' }));

let db: Db;
let alice: string;
let bob: string;
let carol: string;

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

const state = (userId: string, matchId: string, now: number): Promise<MatchState> => getMatch(db, userId, matchId, now).then(yes);
const guessAt = (userId: string, matchId: string, round: number, where: Spot, now: number) =>
  guess(db, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const pinAt = (userId: string, matchId: string, round: number, where: Spot, now: number) =>
  pin(db, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);

/** A lobby with alice as host and the others in it, in order. */
async function lobby(settings: PartySettings = COOP, others: string[] = [bob]): Promise<{ id: string; code: string }> {
  const made = yes(await createParty(db, alice, settings, T));
  for (const userId of others) {
    yes(await joinParty(db, userId, made.code ?? '', T));
  }
  return { id: made.id, code: made.code ?? '' };
}

/** The same, started, with its places posted at T: the first round runs from R0. `picker` is named in the lobby. */
async function playing(others: string[] = [bob], picker: string | null = null, settings: PartySettings = COOP): Promise<{ id: string; code: string }> {
  const party = await lobby(settings, others);
  if (picker !== null) {
    yes(await namePicker(db, alice, party.id, picker, T));
  }
  yes(await startMatch(db, alice, party.id, T));
  yes(await postPlaces(db, alice, { matchId: party.id, places: places(settings.rounds), scaleKm: SCALE_KM }, T));
  return party;
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  [alice, bob, carol] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol')]);
});

describe('a co-op lobby', () => {
  it('has no teams, and its host is the picker until another is named', async () => {
    const made = yes(await createParty(db, alice, COOP, T));

    expect(made).toMatchObject({ settings: { teams: 'coop' }, teams: null, picker: 'alice' });
  });

  it('names no picker in a party that is not co-op', async () => {
    const made = yes(await createParty(db, alice, { ...COOP, teams: 'none' }, T));

    expect(made.picker).toBeNull();
  });

  it('lets the host name the picker', async () => {
    const party = await lobby();

    const named = yes(await namePicker(db, alice, party.id, 'bob', T));

    expect(named.picker).toBe('bob');
    expect((await state(bob, party.id, T)).picker).toBe('bob');
  });

  it('lets the host take the pick back', async () => {
    const party = await lobby();
    yes(await namePicker(db, alice, party.id, 'bob', T));

    const named = yes(await namePicker(db, alice, party.id, 'alice', T));

    expect(named.picker).toBe('alice');
  });

  it('lets nobody but the host name the picker', async () => {
    const party = await lobby();

    expect(await namePicker(db, bob, party.id, 'bob', T)).toEqual({ ok: false, status: 403, error: 'Only the host can do that.' });
  });

  it('refuses a picker who is not in the party', async () => {
    const party = await lobby();

    expect(await namePicker(db, alice, party.id, 'carol', T)).toEqual({ ok: false, status: 409, error: 'There is no such player in this match.' });
  });

  it('refuses a picker in a party that is not co-op', async () => {
    const party = await lobby({ ...COOP, teams: 'best' });

    expect(await namePicker(db, alice, party.id, 'bob', T)).toEqual({ ok: false, status: 409, error: 'This party is not co-op.' });
  });

  it('gives the pick back to the host when the named picker leaves', async () => {
    const party = await lobby();
    yes(await namePicker(db, alice, party.id, 'bob', T));

    yes(await leaveMatch(db, bob, party.id, T));

    expect((await state(alice, party.id, T)).picker).toBe('alice');
  });

  it('has no teams to pick or shuffle', async () => {
    const party = await lobby();
    const off = { ok: false, status: 409, error: 'Teams are off in this party.' };

    expect(await pickTeam(db, bob, party.id, 0, T)).toEqual(off);
    expect(await shuffleTeams(db, alice, party.id, T)).toEqual(off);
  });

  it('takes everyone off their team when a party with teams becomes co-op', async () => {
    const party = await lobby({ ...COOP, teams: 'best' });
    yes(await pickTeam(db, bob, party.id, 1, T));

    const changed = yes(await configure(db, alice, party.id, { ...COOP, communication: 'chat', guests: true }, T));

    expect(changed.players.map((player) => player.team)).toEqual([null, null]);
  });

  it('starts with two players and no teams', async () => {
    const party = await lobby();

    const started = yes(await startMatch(db, alice, party.id, T));

    expect(started).toMatchObject({ phase: 'preparing', teams: null, picker: 'alice' });
  });
});

describe('a co-op round', () => {
  it('ends as soon as the picker guesses, with nobody else to wait for', async () => {
    const party = await playing([bob, carol], 'bob');

    const after = await guessAt(bob, party.id, 0, LONDON, R0 + SECOND);

    expect(after.phase).toBe('reveal');
    expect(after.results[0]?.guesses).toMatchObject([
      { username: 'alice', score: 0, lng: null },
      { username: 'bob', score: LONDON_SCORE, lng: LONDON.lng },
      { username: 'carol', score: 0, lng: null },
    ]);
  });

  it('ignores a guess from anyone but the picker', async () => {
    const party = await playing([bob], 'bob');

    const after = await guessAt(alice, party.id, 0, PARIS, R0 + SECOND);

    expect(after.phase).toBe('playing');
    expect(after.players.map((player) => player.guessed)).toEqual([false, false]);
    expect(await stored('SELECT 1 FROM match_guesses')).toEqual([]);
  });

  it("shows the picker everyone's pin, and everyone the picker's", async () => {
    const party = await playing([bob, carol], 'bob');
    await pinAt(alice, party.id, 0, LONDON, R0 + SECOND);
    await pinAt(bob, party.id, 0, PARIS, R0 + SECOND);

    const picker = await state(bob, party.id, R0 + 2 * SECOND);
    const other = await state(carol, party.id, R0 + 2 * SECOND);

    expect(picker.mates).toEqual([{ username: 'alice', ...LONDON, guessed: false }]);
    expect(other.mates).toEqual([
      { username: 'alice', ...LONDON, guessed: false },
      { username: 'bob', ...PARIS, guessed: false },
    ]);
  });

  it('scores nothing when the time runs out without the picker guessing', async () => {
    const party = await playing([bob], 'bob');

    const after = await state(alice, party.id, R0 + 32 * SECOND);

    expect(after.phase).toBe('reveal');
    expect(after.results[0]?.guesses.map((made) => made.score)).toEqual([0, 0]);
  });
});

describe('the picker of a co-op match under way', () => {
  it('passes to the next player by seat when the picker leaves', async () => {
    const party = await playing([bob, carol], 'bob');

    yes(await leaveMatch(db, bob, party.id, R0 + SECOND));

    expect((await state(alice, party.id, R0 + SECOND)).picker).toBe('carol');
  });

  it('comes round to the first seat when the last-seated picker leaves', async () => {
    const party = await playing([bob, carol], 'carol');

    yes(await leaveMatch(db, carol, party.id, R0 + SECOND));

    expect((await state(alice, party.id, R0 + SECOND)).picker).toBe('alice');
  });

  it('passes on when the host removes the picker', async () => {
    const party = await playing([bob, carol], 'bob');

    const after = yes(await kick(db, alice, party.id, 'bob', R0 + SECOND));

    expect(after.picker).toBe('alice');
  });

  it('passes on when the picker has not been heard from for a while', async () => {
    const party = await playing([bob, carol], 'bob', { ...COOP, timeLimit: 60 });
    const later = R0 + INACTIVE_AFTER_MS + SECOND;
    await state(carol, party.id, later);

    const after = await state(alice, party.id, later);

    expect(after).toMatchObject({ phase: 'playing', picker: 'carol' });
    expect((await guessAt(carol, party.id, 0, PARIS, later)).phase).toBe('reveal');
  });

  it('stays with a picker who is still there', async () => {
    const party = await playing([bob, carol], 'bob');
    await guessAt(bob, party.id, 0, PARIS, R0 + SECOND);

    const next = await state(alice, party.id, R0 + SECOND + REVEAL_MS + COUNTDOWN_MS);

    expect(next).toMatchObject({ phase: 'playing', round: 1, picker: 'bob' });
  });

  it('can be named again by the host between rounds', async () => {
    const party = await playing([bob, carol], 'bob');
    await guessAt(bob, party.id, 0, PARIS, R0 + SECOND);

    const named = yes(await namePicker(db, alice, party.id, 'carol', R0 + 2 * SECOND));

    expect(named.picker).toBe('carol');
  });

  it('is never someone who joined too late to play the round', async () => {
    const party = await playing([bob], 'bob');
    yes(await joinParty(db, carol, party.code, R0 + SECOND));

    yes(await leaveMatch(db, bob, party.id, R0 + 2 * SECOND));

    expect((await state(alice, party.id, R0 + 2 * SECOND)).picker).toBe('alice');
  });
});

describe('a finished co-op match', () => {
  /** Bob picks London, then Paris. Returns when the match is over. */
  async function playedOut(): Promise<{ id: string; end: number }> {
    const party = await playing([bob], 'bob');
    await guessAt(bob, party.id, 0, LONDON, R0);
    const second = R0 + REVEAL_MS + COUNTDOWN_MS;
    await guessAt(bob, party.id, 1, PARIS, second);
    return { id: party.id, end: second + LAST_REVEAL_MS };
  }

  it('has no winner', async () => {
    const { id, end } = await playedOut();

    const over = await state(alice, id, end);

    expect(over).toMatchObject({ phase: 'finished', outcome: { winners: [] } });
  });

  it("is in every player's history with what they made together, neither won nor lost", async () => {
    const { id, end } = await playedOut();
    await state(alice, id, end);

    const rows = await stored('SELECT u.username, g.result, g.score, g.max_score, g.xp_earned FROM online_games g JOIN users u ON u.id = g.user_id ORDER BY u.username');

    const together = { result: null, score: LONDON_SCORE + PARIS_SCORE, max_score: 2 * PARIS_SCORE, xp_earned: 0 };
    expect(rows).toEqual([
      { username: 'alice', ...together },
      { username: 'bob', ...together },
    ]);
  });

  it("keeps each round's guess in the history of a player who did not pick", async () => {
    const { id, end } = await playedOut();
    await state(alice, id, end);

    const [row] = await stored('SELECT g.rounds FROM online_games g JOIN users u ON u.id = g.user_id WHERE u.username = $1', ['alice']);

    expect(row?.rounds).toMatchObject([
      { score: LONDON_SCORE, guessLng: LONDON.lng, guessLat: LONDON.lat },
      { score: PARIS_SCORE, guessLng: PARIS.lng, guessLat: PARIS.lat },
    ]);
  });
});

describe('a picker the host removes', () => {
  it("leaves the rounds they placed with everyone, in the host's name", async () => {
    const party = await playing([bob, carol], 'bob');
    await guessAt(bob, party.id, 0, LONDON, R0 + SECOND);

    const after = yes(await kick(db, alice, party.id, 'bob', R0 + 2 * SECOND));

    expect(after.results[0]?.guesses).toMatchObject([
      { username: 'alice', score: LONDON_SCORE, lng: LONDON.lng, lat: LONDON.lat },
      { username: 'carol', score: 0, lng: null },
    ]);
  });

  it('leaves what they made in the history of the players who stayed', async () => {
    const party = await playing([bob, carol], 'bob');
    await guessAt(bob, party.id, 0, LONDON, R0);
    yes(await kick(db, alice, party.id, 'bob', R0 + SECOND));
    const second = R0 + REVEAL_MS + COUNTDOWN_MS;
    await guessAt(alice, party.id, 1, PARIS, second);
    await state(alice, party.id, second + LAST_REVEAL_MS);

    const rows = await stored('SELECT u.username, g.score FROM online_games g JOIN users u ON u.id = g.user_id ORDER BY u.username');

    expect(rows).toEqual([
      { username: 'alice', score: LONDON_SCORE + PARIS_SCORE },
      { username: 'carol', score: LONDON_SCORE + PARIS_SCORE },
    ]);
  });
});
