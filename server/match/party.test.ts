import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { insertUser } from '../db/users.js';
import { pausingAfter, resetDb, testDb } from '../testing.js';
import { createParty, joinParty, type PartySettings } from './parties.js';
import {
  backToLobby,
  configure,
  endRound,
  getMatch,
  guess,
  handOver,
  kick,
  leaveMatch,
  lock,
  mute,
  pickTeam,
  postPlaces,
  say,
  shuffleTeams,
  startMatch,
} from './play.js';
import { joinQueue, pollQueue } from './queue.js';
import { COUNTDOWN_MS, CUT_MS, GATHER_MS, INACTIVE_AFTER_MS, LAST_REVEAL_MS, REVEAL_MS, type MatchState, type Reply } from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const R0 = T + COUNTDOWN_MS;
const SCALE_KM = 20_000;
type Spot = { lng: number; lat: number };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const LONDON = { lng: -0.1276, lat: 51.5072 };
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

function yes<T>(reply: Reply<T>): T {
  if (!reply.ok) {
    throw new Error(`refused with ${reply.status}: ${reply.error}`);
  }
  return reply.data;
}

const state = (userId: string, matchId: string, now: number, on: Db = db): Promise<MatchState> => getMatch(on, userId, matchId, now).then(yes);
const guessAt = (userId: string, matchId: string, round: number, where: Spot, now: number) =>
  guess(db, userId, { matchId, round, lng: where.lng, lat: where.lat }, now).then(yes);
const line = (userId: string, matchId: string, text: string, now: number) => say(db, userId, matchId, { text, emote: null, scope: 'all' }, now);
const stored = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);
const namesIn = (seen: MatchState): string[] => seen.players.map((player) => player.username);

/** A lobby with alice as host and the others in it, in order. */
async function lobby(settings: PartySettings = SETTINGS, others: string[] = [bob]): Promise<{ id: string; code: string }> {
  const made = yes(await createParty(db, alice, settings, T));
  for (const userId of others) {
    yes(await joinParty(db, userId, made.code ?? '', T));
  }
  return { id: made.id, code: made.code ?? '' };
}

/** The same, started, with its places posted at T: the first round runs from R0. */
async function playing(settings: PartySettings = SETTINGS, others: string[] = [bob]): Promise<{ id: string; code: string }> {
  const party = await lobby(settings, others);
  yes(await startMatch(db, alice, party.id, T));
  yes(await postPlaces(db, alice, { matchId: party.id, places: places(settings.rounds), scaleKm: SCALE_KM }, T));
  return party;
}

/** Everyone guesses in Paris in each of `rounds`. Returns when the party is finished. */
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

describe('party settings', () => {
  it('can be anything from 1 to 20 rounds, with or without a timer, and say how players may talk and whether there are teams', async () => {
    const chosen = { map: 'country:FR', mode: 'nmpz', timeLimit: 0, rounds: 20, communication: 'reactions', teams: 'average', guests: true } as const;
    const made = yes(await createParty(db, alice, chosen, T));
    expect(made).toMatchObject({ settings: chosen, locked: false, teams: [{ team: 0, health: null, total: 0 }, { team: 1, health: null, total: 0 }] });
  });

  it('can be changed by the host while the party is in its lobby, and by nobody else', async () => {
    const { id } = await lobby();
    const next = { map: 'europe', mode: 'no-move', timeLimit: 120, rounds: 7, communication: 'off', teams: 'none', guests: true } as const;
    expect(yes(await configure(db, alice, id, next, T)).settings).toEqual(next);
    expect((await state(bob, id, T)).settings).toEqual(next);
    expect(await configure(db, bob, id, next, T)).toEqual(HOST_ONLY);
    yes(await startMatch(db, alice, id, T));
    expect(yes(await configure(db, alice, id, { ...next, rounds: 3 }, T)).settings.rounds).toBe(7);
  });

  it('plays as many rounds as were chosen', async () => {
    const { id } = await playing({ ...SETTINGS, rounds: 1 });
    await guessAt(alice, id, 0, PARIS, R0);
    const last = await guessAt(bob, id, 0, LONDON, R0);
    expect(last).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(R0 + LAST_REVEAL_MS).toISOString() });
    expect(await state(alice, id, R0 + LAST_REVEAL_MS)).toMatchObject({ phase: 'finished', outcome: { winners: ['alice'] } });
  });
});

describe('a round with no timer', () => {
  it('has no end time, waits as long as it takes, and ends when everyone has guessed', async () => {
    const { id } = await playing({ ...SETTINGS, timeLimit: 0 });
    expect(await state(alice, id, R0)).toMatchObject({ phase: 'playing', roundStartsAt: new Date(R0).toISOString(), roundEndsAt: null });
    await guessAt(alice, id, 0, PARIS, R0);
    // Both keep polling for ten minutes; nothing happens, and one guess with no timer cuts nothing short.
    for (let minute = 1; minute <= 10; minute += 1) {
      for (const userId of [alice, bob]) {
        expect(await state(userId, id, R0 + minute * 20 * SECOND)).toMatchObject({ phase: 'playing', roundEndsAt: null });
      }
    }
    expect((await guessAt(bob, id, 0, PARIS, R0 + 201 * SECOND)).phase).toBe('reveal');
  });

  it('can be ended by the host, and only once it is under way', async () => {
    const { id } = await playing({ ...SETTINGS, timeLimit: 0 });
    expect(yes(await endRound(db, alice, id, R0 - 1)).phase).toBe('playing');
    await guessAt(bob, id, 0, PARIS, R0);
    expect(await endRound(db, bob, id, R0 + SECOND)).toEqual(HOST_ONLY);
    const ended = yes(await endRound(db, alice, id, R0 + SECOND));
    expect(ended).toMatchObject({ phase: 'reveal', revealEndsAt: new Date(R0 + SECOND + REVEAL_MS).toISOString() });
    expect(ended.results[0]?.guesses.map((made) => made.score)).toEqual([0, 5000]);
    // Ending a round that is not being played changes nothing.
    expect(yes(await endRound(db, alice, id, R0 + 2 * SECOND)).revealEndsAt).toBe(ended.revealEndsAt);
  });
});

describe('the last player to guess', () => {
  it('has 20 seconds at most once everyone else has, in a party of three', async () => {
    const { id } = await playing({ ...SETTINGS, timeLimit: 120 }, [bob, carol]);
    expect((await guessAt(alice, id, 0, PARIS, R0 + SECOND)).roundEndsAt).toBe(new Date(R0 + 120 * SECOND).toISOString());
    const cut = await guessAt(bob, id, 0, PARIS, R0 + 2 * SECOND);
    expect(cut.roundEndsAt).toBe(new Date(R0 + 2 * SECOND + CUT_MS).toISOString());
    expect((await state(carol, id, R0 + 2 * SECOND)).roundEndsAt).toBe(cut.roundEndsAt);
  });
});

describe('teams in a party', () => {
  const TEAMS = { ...SETTINGS, teams: 'best', guests: true } as const;

  it('are picked by the players in the lobby', async () => {
    const { id } = await lobby(TEAMS, [bob, carol]);
    expect((await state(alice, id, T)).players.map((player) => player.team)).toEqual([null, null, null]);
    expect(yes(await pickTeam(db, bob, id, 1, T)).you.team).toBe(1);
    yes(await pickTeam(db, alice, id, 0, T));
    expect((await state(carol, id, T)).players.map((player) => player.team)).toEqual([0, 1, null]);
  });

  it('can be dealt at random by the host, as evenly as the number of players allows', async () => {
    const { id } = await lobby(TEAMS, [bob, carol, dave, await addUser('erin')]);
    expect(await shuffleTeams(db, bob, id, T)).toEqual(HOST_ONLY);
    const dealt = yes(await shuffleTeams(db, alice, id, T)).players.map((player) => player.team);
    expect(dealt.filter((team) => team === 0).length + dealt.filter((team) => team === 1).length).toBe(5);
    expect(Math.abs(dealt.filter((team) => team === 0).length - dealt.filter((team) => team === 1).length)).toBe(1);
  });

  it('are refused where the party has none', async () => {
    const { id } = await lobby();
    const off = { ok: false, status: 409, error: 'Teams are off in this party.' };
    expect(await pickTeam(db, bob, id, 0, T)).toEqual(off);
    expect(await shuffleTeams(db, alice, id, T)).toEqual(off);
  });

  it('need a player each to start; players who have not picked go to the smaller team', async () => {
    const { id } = await lobby(TEAMS, [bob, carol, dave]);
    for (const userId of [alice, bob]) {
      yes(await pickTeam(db, userId, id, 0, T));
    }
    const started = yes(await startMatch(db, alice, id, T));
    expect(started.players.map((player) => player.team)).toEqual([0, 0, 1, 1]);

    const lopsided = await addUser('host2');
    const other = yes(await createParty(db, lopsided, TEAMS, T));
    const guest = await addUser('guest2');
    yes(await joinParty(db, guest, other.code ?? '', T));
    yes(await pickTeam(db, lopsided, other.id, 0, T));
    yes(await pickTeam(db, guest, other.id, 0, T));
    expect(await startMatch(db, lopsided, other.id, T)).toEqual({ ok: false, status: 409, error: 'Each team needs at least one player.' });
  });

  it('are cleared when the host turns teams off', async () => {
    const { id } = await lobby(TEAMS);
    yes(await pickTeam(db, bob, id, 1, T));
    const off = yes(await configure(db, alice, id, { ...SETTINGS, communication: 'chat', teams: 'none', guests: true }, T));
    expect(off.teams).toBeNull();
    expect(off.players.map((player) => player.team)).toEqual([null, null]);
  });

  it('win by their best guess in each round, or by the average of their guesses, as the host chose', async () => {
    const result = async (teams: 'best' | 'average'): Promise<MatchState> => {
      await resetDb(db);
      [alice, bob, carol, dave] = await Promise.all([addUser('alice'), addUser('bob'), addUser('carol'), addUser('dave')]);
      const party = await lobby({ ...SETTINGS, rounds: 1, teams }, [bob, carol, dave]);
      for (const [userId, team] of [[alice, 0], [bob, 0], [carol, 1], [dave, 1]] as const) {
        yes(await pickTeam(db, userId, party.id, team, T));
      }
      yes(await startMatch(db, alice, party.id, T));
      yes(await postPlaces(db, alice, { matchId: party.id, places: places(1), scaleKm: SCALE_KM }, T));
      // Team 0: one perfect guess and one worth nothing. Team 1: two good ones.
      await guessAt(alice, party.id, 0, PARIS, R0);
      await guessAt(bob, party.id, 0, FAR, R0);
      await guessAt(carol, party.id, 0, LONDON, R0);
      await guessAt(dave, party.id, 0, LONDON, R0);
      return state(alice, party.id, R0 + LAST_REVEAL_MS);
    };
    const byBest = await result('best');
    expect(byBest.outcome?.winners).toEqual(['alice', 'bob']);
    expect(byBest.teams?.map((team) => team.total)).toEqual([5000, byBest.results[0]?.guesses[2]?.score]);
    const byAverage = await result('average');
    expect(byAverage.outcome?.winners).toEqual(['carol', 'dave']);
    expect(byAverage.teams?.[0]?.total).toBe(2500);
  });

  it('take a player who joins under way onto the smaller team', async () => {
    const TEAMS3 = { ...SETTINGS, rounds: 3, teams: 'best', guests: true } as const;
    const party = await lobby(TEAMS3, [bob, carol]);
    yes(await pickTeam(db, alice, party.id, 0, T));
    yes(await pickTeam(db, bob, party.id, 0, T));
    yes(await pickTeam(db, carol, party.id, 1, T));
    yes(await startMatch(db, alice, party.id, T));
    expect(yes(await joinParty(db, dave, party.code, T + SECOND)).you.team).toBe(1);
  });
});

describe('the host', () => {
  it('can remove a player from the lobby, who is then refused everything about the party', async () => {
    const { id, code } = await lobby(SETTINGS, [bob, carol]);
    expect(await kick(db, bob, id, 'carol', T)).toEqual(HOST_ONLY);
    expect(namesIn(yes(await kick(db, alice, id, 'bob', T)))).toEqual(['alice', 'carol']);
    const removed = { ok: false, status: 403, error: 'You were removed from that party.' };
    expect(await getMatch(db, bob, id, T)).toEqual(removed);
    expect(await joinParty(db, bob, code, T + SECOND)).toEqual(removed);
    expect(await line(bob, id, 'hey', T)).toEqual(removed);
    // They are free to play elsewhere.
    expect((await createParty(db, bob, SETTINGS, T + SECOND)).ok).toBe(true);
    expect(namesIn(await state(carol, id, T + 2 * SECOND))).toEqual(['alice', 'carol']);
  });

  it('can remove a player from a game under way, which goes on without them', async () => {
    const { id } = await playing(SETTINGS, [bob, carol]);
    await guessAt(carol, id, 0, PARIS, R0);
    const after = yes(await kick(db, alice, id, 'carol', R0 + SECOND));
    expect(namesIn(after)).toEqual(['alice', 'bob']);
    expect((await getMatch(db, carol, id, R0 + SECOND)).ok).toBe(false);
    await guessAt(alice, id, 0, PARIS, R0 + 2 * SECOND);
    const revealed = await guessAt(bob, id, 0, PARIS, R0 + 2 * SECOND);
    expect(revealed.phase).toBe('reveal');
    expect(revealed.results[0]?.guesses.map((made) => made.username)).toEqual(['alice', 'bob']);
  });

  it('cannot remove themselves or someone who is not there', async () => {
    const { id } = await lobby();
    expect(await kick(db, alice, id, 'alice', T)).toEqual({ ok: false, status: 409, error: 'You cannot do that to yourself.' });
    expect(await kick(db, alice, id, 'nobody', T)).toEqual({ ok: false, status: 409, error: 'There is no such player in this match.' });
  });

  it('can hand the party over, and with it the picking of places', async () => {
    const { id } = await lobby();
    expect(await handOver(db, bob, id, 'alice', T)).toEqual(HOST_ONLY);
    expect(yes(await handOver(db, alice, id, 'bob', T)).you).toMatchObject({ isHost: false, isResolver: false });
    expect((await state(bob, id, T)).you).toMatchObject({ isHost: true, isResolver: true });
    expect(await startMatch(db, alice, id, T)).toMatchObject({ ok: false, status: 403 });
    yes(await startMatch(db, bob, id, T));
    // While the places are being picked, the one picking them stays.
    expect(yes(await handOver(db, bob, id, 'alice', T)).you.isHost).toBe(true);
    expect((await postPlaces(db, bob, { matchId: id, places: places(2), scaleKm: SCALE_KM }, T)).ok).toBe(true);
    expect(yes(await handOver(db, bob, id, 'alice', T)).you.isHost).toBe(false);
  });

  it('cannot hand it to a guest, and a guest does not inherit it when the host leaves', async () => {
    const guest = await addUser('Guest #4821', true);
    const { id, code } = await lobby(SETTINGS, [guest, bob]);
    expect(await handOver(db, alice, id, 'Guest #4821', T)).toEqual({ ok: false, status: 409, error: 'A guest cannot host.' });
    yes(await leaveMatch(db, alice, id, T));
    expect((await state(bob, id, T)).you.isHost).toBe(true);
    // With only a guest left, nobody can start it: it is over.
    yes(await leaveMatch(db, bob, id, T));
    expect(await joinParty(db, carol, code, T)).toMatchObject({ ok: false, error: 'That party has ended.' });
  });

  it('can lock the party against new players, and open it again', async () => {
    const { id, code } = await lobby();
    expect(await lock(db, bob, id, true, T)).toEqual(HOST_ONLY);
    expect(yes(await lock(db, alice, id, true, T)).locked).toBe(true);
    expect(await joinParty(db, carol, code, T)).toEqual({ ok: false, status: 409, error: 'That party is locked.' });
    // A player already in it still gets its state by rejoining.
    expect((await joinParty(db, bob, code, T)).ok).toBe(true);
    yes(await lock(db, alice, id, false, T));
    expect((await joinParty(db, carol, code, T)).ok).toBe(true);
  });
});

describe('how a party may talk', () => {
  it('is free chat by default, reactions only or nothing when the host says so', async () => {
    const chatty = await lobby();
    expect((await line(bob, chatty.id, 'hello', T)).ok).toBe(true);

    const [quiet, silent] = [await addUser('quiet'), await addUser('silent')];
    const reactions = yes(await createParty(db, quiet, { ...SETTINGS, communication: 'reactions' }, T));
    expect(await line(quiet, reactions.id, 'hello', T)).toEqual({ ok: false, status: 403, error: 'Chat is off in this match.' });
    expect((await say(db, quiet, reactions.id, { text: null, emote: 'gl' }, T)).ok).toBe(true);

    const off = yes(await createParty(db, silent, { ...SETTINGS, communication: 'off' }, T));
    expect(await line(silent, off.id, 'hello', T)).toMatchObject({ ok: false, status: 403, error: 'Chat is off in this match.' });
    expect(await say(db, silent, off.id, { text: null, emote: 'gl' }, T)).toEqual({ ok: false, status: 403, error: 'Reactions are off in this match.' });
  });

  it('lets a player mute another for themselves alone, and hear them again', async () => {
    const { id } = await lobby(SETTINGS, [bob, carol]);
    yes(await line(bob, id, 'one', T));
    const muted = yes(await mute(db, alice, id, 'bob', true, T));
    expect(muted).toMatchObject({ chat: [], you: { muted: ['bob'] } });
    yes(await line(bob, id, 'two', T + SECOND));
    yes(await say(db, bob, id, { text: null, emote: 'lol' }, T + 2 * SECOND));
    yes(await line(carol, id, 'three', T + 2 * SECOND));
    expect((await state(alice, id, T + 3 * SECOND)).chat.map((entry) => entry.text)).toEqual(['three']);
    expect((await state(carol, id, T + 3 * SECOND)).chat).toHaveLength(4);
    expect(yes(await mute(db, alice, id, 'bob', false, T + 3 * SECOND)).chat).toHaveLength(4);
  });

  it('refuses a mute of oneself or of someone who is not there', async () => {
    const { id } = await lobby();
    expect(await mute(db, alice, id, 'alice', true, T)).toMatchObject({ ok: false, status: 409, error: 'You cannot do that to yourself.' });
    expect(await mute(db, alice, id, 'nobody', true, T)).toMatchObject({ ok: false, status: 409, error: 'There is no such player in this match.' });
  });

  it('has reactions only in a public game, where free chat is refused', async () => {
    yes(await joinQueue(db, alice, 'unranked', T - GATHER_MS));
    yes(await joinQueue(db, bob, 'unranked', T - GATHER_MS + 1));
    await pollQueue(db, alice, T - GATHER_MS / 2);
    await pollQueue(db, bob, T - GATHER_MS / 2);
    const { matchId } = await pollQueue(db, alice, T + SECOND);
    expect(await line(alice, matchId ?? '', 'hello', T + SECOND)).toEqual({ ok: false, status: 403, error: 'Chat is off in this match.' });
    expect((await say(db, alice, matchId ?? '', { text: null, emote: 'gg' }, T + SECOND)).ok).toBe(true);
  });
});

describe('going back to the lobby', () => {
  it('takes a finished party back to its lobby with the same code, settings and players, cleared for another game', async () => {
    const { id, code } = await playing(SETTINGS, [bob, carol]);
    yes(await line(carol, id, 'gg', R0));
    const end = await playOut(id, 2, [alice, bob, carol]);
    expect((await state(alice, id, end)).phase).toBe('finished');
    expect(await backToLobby(db, bob, id, end)).toEqual(HOST_ONLY);

    const back = yes(await backToLobby(db, alice, id, end + SECOND));
    expect(back).toMatchObject({ id, code, phase: 'lobby', round: 0, places: null, results: [], outcome: null, chat: [], roundStartsAt: null });
    expect(back.settings).toMatchObject(SETTINGS);
    expect(back.players.map((player) => [player.username, player.total, player.active])).toEqual([
      ['alice', 0, true],
      ['bob', 0, true],
      ['carol', 0, true],
    ]);
    expect((await state(bob, id, end + 2 * SECOND)).phase).toBe('lobby');
    expect(await stored('SELECT 1 FROM match_guesses')).toEqual([]);

    // And it plays again: a second game, kept in everyone's history beside the first.
    yes(await startMatch(db, alice, id, end + 2 * SECOND));
    yes(await postPlaces(db, alice, { matchId: id, places: places(2), scaleKm: SCALE_KM }, end + 2 * SECOND));
    expect(await stored('SELECT count(*)::int AS games FROM online_games WHERE user_id = $1', [bob])).toEqual([{ games: 1 }]);
  });

  it('leaves behind the players who have stopped polling, left, or gone into another match', async () => {
    const erin = await addUser('erin');
    const { id } = await playing(SETTINGS, [bob, carol, dave, erin]);
    yes(await leaveMatch(db, erin, id, R0));
    const end = await playOut(id, 2, [alice, bob, carol, dave]);
    await state(alice, id, end);
    // Bob opens a party of his own; carol stops polling; dave is still looking at the result.
    yes(await createParty(db, bob, SETTINGS, end + SECOND));
    const later = end + INACTIVE_AFTER_MS;
    await state(dave, id, later - SECOND);
    const back = yes(await backToLobby(db, alice, id, later));
    expect(namesIn(back)).toEqual(['alice', 'dave']);
    expect((await getMatch(db, carol, id, later)).ok).toBe(false);
    expect(await stored('SELECT match_id FROM match_players WHERE user_id = $1 AND open', [bob])).toHaveLength(1);
  });

  it('changes nothing for a party that is not finished', async () => {
    const { id } = await playing();
    expect(yes(await backToLobby(db, alice, id, R0)).phase).toBe('playing');
  });

  it('keeps out a player the host removed, even after going back to the lobby', async () => {
    const { id, code } = await playing(SETTINGS, [bob, carol]);
    yes(await kick(db, alice, id, 'carol', R0));
    const end = await playOut(id, 2, [alice, bob]);
    await state(alice, id, end);
    expect(namesIn(yes(await backToLobby(db, alice, id, end)))).toEqual(['alice', 'bob']);
    expect(await joinParty(db, carol, code, end)).toMatchObject({ ok: false, status: 403 });
  });

  it('leaves a player in one match when they open another party just as the host takes everyone back', async () => {
    const { id } = await playing();
    const end = await playOut(id, 2, [alice, bob]);
    await state(alice, id, end);
    const slow = pausingAfter(db, /FROM matches|FROM users/);
    const [back, opened] = await Promise.all([backToLobby(slow, alice, id, end + SECOND), createParty(slow, bob, SETTINGS, end + SECOND)]);
    expect(back.ok).toBe(true);
    const seats = await stored('SELECT match_id FROM match_players WHERE user_id = $1 AND open', [bob]);
    expect(seats).toHaveLength(1);
    // Either he came back with the party, and his own was refused; or he had already gone, and was left behind.
    const cameBack = seats[0]?.match_id === id;
    expect(opened.ok).toBe(!cameBack);
    expect(namesIn(await state(alice, id, end + 2 * SECOND))).toEqual(cameBack ? ['alice', 'bob'] : ['alice']);
  });

  it('goes back once when the host asks twice at the same moment', async () => {
    const { id } = await playing();
    const end = await playOut(id, 2, [alice, bob]);
    await state(alice, id, end);
    const slow = pausingAfter(db, /FROM matches/);
    const replies = await Promise.all([backToLobby(slow, alice, id, end), backToLobby(slow, alice, id, end)]);
    expect(replies.map((reply) => (reply.ok ? reply.data.phase : reply.error))).toEqual(['lobby', 'lobby']);
    expect(namesIn(await state(bob, id, end))).toEqual(['alice', 'bob']);
  });
});

describe('a party when two things are asked of it at the same moment', () => {
  const slowly = () => pausingAfter(db, /FROM matches/);

  it('removes a player for good though they guess as the host removes them', async () => {
    const party = await playing(SETTINGS, [bob, carol]);
    const slow = slowly();
    const [removed, guessed] = await Promise.all([kick(slow, alice, party.id, 'bob', R0), guess(slow, bob, { matchId: party.id, round: 0, ...PARIS }, R0)]);
    expect(removed.ok).toBe(true);
    if (!guessed.ok) {
      expect(guessed).toMatchObject({ status: 403, error: 'You were removed from that party.' });
    }
    expect(await getMatch(db, bob, party.id, R0 + SECOND)).toMatchObject({ ok: false, status: 403 });
    await guessAt(alice, party.id, 0, PARIS, R0 + SECOND);
    const revealed = await guessAt(carol, party.id, 0, PARIS, R0 + SECOND);
    expect(namesIn(revealed)).toEqual(['alice', 'carol']);
    expect(revealed.results[0]?.guesses.map((one) => one.username)).toEqual(['alice', 'carol']);
  });

  it('either hands the party to a player or removes them, never both, when the host asks for both', async () => {
    const party = await lobby(SETTINGS, [bob, carol]);
    const slow = slowly();
    const [handed, removed] = await Promise.all([handOver(slow, alice, party.id, 'bob', T), kick(slow, alice, party.id, 'bob', T)]);
    expect([handed.ok, removed.ok].filter(Boolean)).toHaveLength(1);
    if (handed.ok) {
      // The party was bob's by the time alice asked to remove him.
      expect(removed).toEqual(HOST_ONLY);
      expect(await state(bob, party.id, T)).toMatchObject({ you: { isHost: true, isResolver: true } });
      expect(namesIn(await state(alice, party.id, T))).toEqual(['alice', 'bob', 'carol']);
    } else {
      expect(handed).toMatchObject({ status: 409, error: 'There is no such player in this match.' });
      expect(await state(alice, party.id, T)).toMatchObject({ you: { isHost: true, isResolver: true } });
      expect(namesIn(await state(alice, party.id, T))).toEqual(['alice', 'carol']);
    }
  });

  it('lets a player in or keeps them out, as the lock fell, when they join as the host locks the party', async () => {
    const party = await lobby();
    const slow = slowly();
    const [locked, joined] = await Promise.all([lock(slow, alice, party.id, true, T), joinParty(slow, carol, party.code, T)]);
    expect(locked.ok).toBe(true);
    if (!joined.ok) {
      expect(joined).toMatchObject({ status: 409, error: 'That party is locked.' });
    }
    const seen = await state(alice, party.id, T);
    expect(seen.locked).toBe(true);
    expect(namesIn(seen)).toEqual(joined.ok ? ['alice', 'bob', 'carol'] : ['alice', 'bob']);
    expect(await stored('SELECT 1 FROM match_players WHERE user_id = $1 AND open', [carol])).toHaveLength(joined.ok ? 1 : 0);
  });

  it('gives the fortieth seat to one of two players who join at once', async () => {
    const more = await Promise.all(Array.from({ length: 37 }, (_unused, index) => addUser(`player${index}`)));
    const party = await lobby(SETTINGS, [bob, ...more]);
    const slow = slowly();
    const replies = await Promise.all([joinParty(slow, carol, party.code, T), joinParty(slow, dave, party.code, T)]);
    expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
    expect(replies.find((reply) => !reply.ok)).toMatchObject({ status: 409, error: 'That party is full: it has 40 players.' });
    expect((await state(alice, party.id, T)).players).toHaveLength(40);
    expect(await stored('SELECT 1 FROM match_players WHERE match_id = $1', [party.id])).toHaveLength(40);
  });

  it('seats two players who join a team game under way at once one on each team, each from the same round', async () => {
    const party = await lobby({ ...SETTINGS, rounds: 3, teams: 'best', guests: true }, [bob]);
    yes(await pickTeam(db, alice, party.id, 0, T));
    yes(await pickTeam(db, bob, party.id, 1, T));
    yes(await startMatch(db, alice, party.id, T));
    yes(await postPlaces(db, alice, { matchId: party.id, places: places(3), scaleKm: SCALE_KM }, T));
    const slow = slowly();
    const replies = await Promise.all([joinParty(slow, carol, party.code, R0), joinParty(slow, dave, party.code, R0)]);
    expect(replies.map((reply) => reply.ok)).toEqual([true, true]);
    const seen = await state(alice, party.id, R0);
    expect(seen.players.map((player) => player.team).sort()).toEqual([0, 0, 1, 1]);
    expect(await stored('SELECT DISTINCT joined_round FROM match_players WHERE user_id IN ($1, $2)', [carol, dave])).toEqual([{ joined_round: 1 }]);
  });

  it('seats a player once when they join a game under way twice at the same moment', async () => {
    const party = await playing({ ...SETTINGS, rounds: 3 });
    const slow = slowly();
    const replies = await Promise.all([joinParty(slow, carol, party.code, R0), joinParty(slow, carol, party.code, R0)]);
    expect(replies.map((reply) => reply.ok)).toEqual([true, true]);
    expect(await stored('SELECT 1 FROM match_players WHERE user_id = $1', [carol])).toHaveLength(1);
    expect(namesIn(await state(alice, party.id, R0))).toEqual(['alice', 'bob', 'carol']);
  });
});

describe('a finished party in the history', () => {
  it('is saved for each account in it, with their own score and no XP', async () => {
    const guest = await addUser('Guest #7777', true);
    const { id } = await playing(SETTINGS, [bob, guest]);
    await guessAt(alice, id, 0, PARIS, R0);
    await guessAt(bob, id, 0, LONDON, R0);
    await guessAt(guest, id, 0, PARIS, R0);
    const end = await playOut(id, 2, [alice, bob, guest]);
    await state(alice, id, end);
    const rows = await stored(
      `SELECT u.username, g.kind, g.result, g.score, g.max_score, g.xp_earned, g.players, g.rating_before, jsonb_array_length(g.rounds) AS rounds
         FROM online_games g JOIN users u ON u.id = g.user_id ORDER BY u.username`,
    );
    // The guest played, and is counted among the players, but has no history of their own.
    expect(rows).toEqual([
      { username: 'alice', kind: 'party', result: 'draw', score: 10_000, max_score: 10_000, xp_earned: 0, players: 3, rating_before: null, rounds: 2 },
      { username: 'bob', kind: 'party', result: 'draw', score: expect.any(Number), max_score: 10_000, xp_earned: 0, players: 3, rating_before: null, rounds: 2 },
    ]);
    expect(await stored('SELECT DISTINCT xp FROM users')).toEqual([{ xp: 0 }]);
  });
});
