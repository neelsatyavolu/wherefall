import { describe, expect, it } from 'vitest';
import { matchState } from './state.js';
import type { GuessRecord, MatchRecord, PlayerRecord, Snapshot } from './types.js';

const T = 1_800_000_000_000;
const PLACES = [0, 1, 2].map((index) => ({ id: `p${index}`, lng: index, lat: index, country: 'FR' }));

const match = (change: Partial<MatchRecord> = {}): MatchRecord => ({
  id: 'm',
  code: null,
  kind: 'ranked',
  phase: 'playing',
  settings: { map: 'world', mode: 'no-move', timeLimit: 60, rounds: 3, communication: 'chat', teams: 'none', guests: true },
  locked: false,
  movedToQueue: null,
  seed: 'seed',
  resolverId: 'a',
  pickerId: null,
  round: 1,
  prepareEndsAt: null,
  roundStartsAt: T,
  roundEndsAt: T + 60_000,
  revealEndsAt: null,
  places: PLACES,
  scaleKm: 14_916.862,
  outcome: null,
  finishedAt: null,
  chat: [],
  ...change,
});

const player = (userId: string, change: Partial<PlayerRecord> = {}): PlayerRecord => ({
  userId,
  username: `user_${userId}`,
  rating: 1000,
  seat: userId.charCodeAt(0),
  team: null,
  lastSeenAt: T,
  leftAt: null,
  joinedRound: 0,
  country: null,
  guest: false,
  ratedGames: 0,
  muted: [],
  pin: null,
  banned: false,
  ...change,
});

const guess = (userId: string, round: number, score: number): GuessRecord => ({ userId, round, lng: 10 + round, lat: 20 + round, distanceKm: 3.5, score });

const PLAYERS = [player('a', { rating: 1016 }), player('b', { rating: 984 })];
const GUESSES = [guess('a', 0, 4000), guess('b', 0, 1000), guess('b', 1, 2500)];
const snapshot = (change: Partial<MatchRecord> = {}, players = PLAYERS, guesses = GUESSES): Snapshot => ({ match: match(change), players, guesses, barred: [] });

/** The state as the player with that id sees it. */
function stateFor(shown: Snapshot, userId: string, now: number) {
  const you = shown.players.find((entry) => entry.userId === userId);
  if (!you) {
    throw new Error(`${userId} is not in the match`);
  }
  return matchState(shown, you, now);
}

describe('matchState', () => {
  it('carries the server clock and the round times as ISO strings', () => {
    const state = stateFor(snapshot(), 'a', T + 1234);
    expect(state).toMatchObject({
      id: 'm',
      kind: 'ranked',
      phase: 'playing',
      seed: 'seed',
      round: 1,
      serverNow: new Date(T + 1234).toISOString(),
      roundStartsAt: new Date(T).toISOString(),
      roundEndsAt: new Date(T + 60_000).toISOString(),
      revealEndsAt: null,
      settings: { map: 'world', mode: 'no-move', timeLimit: 60, rounds: 3, communication: 'chat', teams: 'none', guests: true },
  locked: false,
  movedToQueue: null,
      outcome: null,
    });
  });

  it("keeps the round being played out of the results, the totals, and everyone's view alike", () => {
    for (const viewer of ['a', 'b']) {
      const state = stateFor(snapshot(), viewer, T);
      expect(state?.results).toEqual([
        {
          round: 0,
          guesses: [
            { username: 'user_a', lng: 10, lat: 20, distanceKm: 3.5, score: 4000 },
            { username: 'user_b', lng: 10, lat: 20, distanceKm: 3.5, score: 1000 },
          ],
        },
      ]);
      expect(state?.players.map((entry) => entry.total)).toEqual([4000, 1000]);
      expect(JSON.stringify(state)).not.toContain('2500');
    }
  });

  it('says who has guessed in the round being played', () => {
    expect(stateFor(snapshot(), 'a', T)?.players.map((entry) => entry.guessed)).toEqual([false, true]);
  });

  it('adds the round, with a blank for a player who did not guess, once it is revealed', () => {
    const state = stateFor(snapshot({ phase: 'reveal', revealEndsAt: T + 10_000 }), 'a', T);
    expect(state?.revealEndsAt).toBe(new Date(T + 10_000).toISOString());
    expect(state?.results[1]).toEqual({
      round: 1,
      guesses: [
        { username: 'user_a', lng: null, lat: null, distanceKm: null, score: 0 },
        { username: 'user_b', lng: 11, lat: 21, distanceKm: 3.5, score: 2500 },
      ],
    });
    expect(state?.players.map((entry) => entry.total)).toEqual([4000, 3500]);
    expect(state?.players.map((entry) => entry.guessed)).toEqual([false, true]);
  });

  it('shows every round played, and the outcome, when the match is finished', () => {
    const outcome = { winners: ['user_a'], ratingChanges: [{ username: 'user_a', before: 1000, after: 1016 }], dodgedBy: null };
    const state = stateFor(snapshot({ phase: 'finished', outcome, finishedAt: T }), 'b', T);
    expect(state?.results.map((result) => result.round)).toEqual([0, 1]);
    expect(state?.outcome).toEqual(outcome);
    expect(state?.players.every((entry) => !entry.guessed)).toBe(true);
  });

  it('shows no results before the places are posted, even for a match cancelled there', () => {
    const before = { places: null, scaleKm: null, round: 0, roundStartsAt: null, roundEndsAt: null };
    expect(stateFor(snapshot({ ...before, phase: 'preparing' }, PLAYERS, []), 'a', T)).toMatchObject({ places: null, results: [] });
    expect(stateFor(snapshot({ ...before, phase: 'finished' }, PLAYERS, []), 'a', T)?.results).toEqual([]);
  });

  it('gives every player the places of the rounds reached so far, and none still to come', () => {
    expect(stateFor(snapshot(), 'a', T)?.places).toEqual(PLACES.slice(0, 2));
    expect(stateFor(snapshot(), 'b', T)?.places).toEqual(PLACES.slice(0, 2));
    expect(stateFor(snapshot({ round: 0 }), 'a', T)?.places).toEqual(PLACES.slice(0, 1));
    expect(stateFor(snapshot({ round: 0, phase: 'reveal', revealEndsAt: T + 1000 }), 'a', T)?.places).toEqual(PLACES.slice(0, 1));
    expect(stateFor(snapshot({ round: 2 }), 'a', T)?.places).toEqual(PLACES);
    expect(stateFor(snapshot({ round: 2, phase: 'finished', finishedAt: T }), 'a', T)?.places).toEqual(PLACES);
    // A match that ended early never shows the rounds it did not reach.
    expect(stateFor(snapshot({ round: 1, phase: 'finished', finishedAt: T }), 'a', T)?.places).toEqual(PLACES.slice(0, 2));
    expect(stateFor(snapshot({ phase: 'preparing', places: null }), 'a', T)?.places).toBeNull();
  });

  it('shows ratings in a ranked match only', () => {
    expect(stateFor(snapshot(), 'a', T)?.players.map((entry) => entry.rating)).toEqual([1016, 984]);
    expect(stateFor(snapshot({ kind: 'unranked' }), 'a', T)?.players.map((entry) => entry.rating)).toEqual([null, null]);
  });

  it('shows health in a ranked match only, and only what the revealed rounds took', () => {
    // Round 0 is revealed: alice 4000, bob 1000. Round 1 is being played, and bob has guessed 2500 in it.
    expect(stateFor(snapshot(), 'a', T).players.map((entry) => entry.health)).toEqual([5000, 2000]);
    expect(stateFor(snapshot(), 'b', T).players.map((entry) => entry.health)).toEqual([5000, 2000]);
    const revealed = stateFor(snapshot({ phase: 'reveal', revealEndsAt: T + 10_000 }), 'a', T);
    expect(revealed.players.map((entry) => entry.health)).toEqual([2500, 2000]);
    expect(stateFor(snapshot({ kind: 'unranked' }), 'a', T).players.map((entry) => entry.health)).toEqual([null, null]);
    expect(stateFor(snapshot({ kind: 'party' }), 'a', T).players.map((entry) => entry.health)).toEqual([null, null]);
  });

  it('sends the chat as it was said, without the ids of the accounts that said it', () => {
    const at = new Date(T).toISOString();
    const chat = [
      { id: 4, userId: 'a', username: 'user_a', text: 'hello', emote: null, at },
      { id: 5, userId: 'b', username: 'user_b', text: null, emote: 'gg' as const, at },
    ];
    const state = stateFor(snapshot({ chat }), 'b', T);
    expect(state.chat).toEqual([
      { id: 4, username: 'user_a', text: 'hello', emote: null, at, scope: 'all' },
      { id: 5, username: 'user_b', text: null, emote: 'gg', at, scope: 'all' },
    ]);
    expect(stateFor(snapshot(), 'a', T).chat).toEqual([]);
  });

  it('marks a player who stopped polling, or left, as inactive', () => {
    const players = [player('a'), player('b', { lastSeenAt: T - 30_000 }), player('c', { leftAt: T })];
    expect(stateFor(snapshot({ kind: 'party' }, players), 'a', T)?.players.map((entry) => entry.active)).toEqual([true, false, false]);
  });

  it('names the host and the resolver of a party, and neither as host in a matchmade match', () => {
    const party = snapshot({ kind: 'party', code: 'ABCDEF', phase: 'lobby' });
    expect(stateFor(party, 'a', T)).toMatchObject({ code: 'ABCDEF', you: { username: 'user_a', isHost: true, isResolver: true, team: null } });
    expect(stateFor(party, 'b', T).you).toEqual({ username: 'user_b', isHost: false, isResolver: false, team: null, guest: false, muted: [] });
    expect(stateFor(snapshot(), 'a', T)?.you).toMatchObject({ isHost: false, isResolver: true });
  });

  it('tells each player their team', () => {
    const players = [player('a', { team: 1 }), player('b', { team: 0 })];
    const state = stateFor(snapshot({ kind: 'team' }, players), 'a', T);
    expect(state?.you.team).toBe(1);
    expect(state?.players.map((entry) => entry.team)).toEqual([1, 0]);
  });

  describe('with teams', () => {
    const four = [player('a', { team: 0 }), player('b', { team: 0 }), player('c', { team: 1 }), player('d', { team: 1 })];
    const played = [guess('a', 0, 4000), guess('b', 0, 1000), guess('c', 0, 2000), guess('d', 1, 3000)];
    const at = new Date(T).toISOString();

    it("gives each team's health in a 2v2 match, and its total, over the revealed rounds only", () => {
      // Round 0 is revealed: team 0's best is 4000, team 1's 2000, so team 1 has lost 2000 x 1.3.
      const state = stateFor(snapshot({ kind: 'team' }, four, played), 'c', T);
      expect(state.teams).toEqual([
        { team: 0, health: 5000, total: 4000 },
        { team: 1, health: 2400, total: 2000 },
      ]);
      expect(state.players.every((entry) => entry.health === null && entry.rating === null)).toBe(true);
    });

    it("gives each team's total in a party with teams, and no health", () => {
      const party = { kind: 'party' as const, settings: { ...match().settings, teams: 'average' as const } };
      expect(stateFor(snapshot(party, four, played), 'a', T).teams).toEqual([
        { team: 0, health: null, total: 2500 },
        { team: 1, health: null, total: 1000 },
      ]);
      expect(stateFor(snapshot({ kind: 'party' }, four, played), 'a', T).teams).toBeNull();
    });

    it("shows a player their teammates' pins while the round is played: a guess once made, else where the pin was last put", () => {
      const pinned = four.map((one) => (one.userId === 'a' ? { ...one, pin: { round: 1, lng: 7, lat: 8 } } : one));
      // Round 1 is being played. a has a pin down, d has guessed, b and c have done neither.
      expect(stateFor(snapshot({ kind: 'team' }, pinned, played), 'b', T).mates).toEqual([{ username: 'user_a', lng: 7, lat: 8, guessed: false }]);
      expect(stateFor(snapshot({ kind: 'team' }, pinned, played), 'c', T).mates).toEqual([{ username: 'user_d', lng: 11, lat: 21, guessed: true }]);
      expect(stateFor(snapshot({ kind: 'team' }, pinned, played), 'a', T).mates).toEqual([]);
    });

    it('never shows a pin from another round, outside a round, to the other team, or where there are no teams', () => {
      const stale = four.map((one) => (one.userId === 'a' ? { ...one, pin: { round: 0, lng: 7, lat: 8 } } : one));
      expect(stateFor(snapshot({ kind: 'team' }, stale, played), 'b', T).mates).toEqual([]);
      const pinned = four.map((one) => (one.userId === 'a' ? { ...one, pin: { round: 1, lng: 7, lat: 8 } } : one));
      expect(stateFor(snapshot({ kind: 'team', phase: 'reveal', revealEndsAt: T }, pinned, played), 'b', T).mates).toEqual([]);
      expect(JSON.stringify(stateFor(snapshot({ kind: 'team' }, pinned, played), 'c', T).mates)).not.toContain('user_a');
      expect(stateFor(snapshot({ kind: 'unranked' }, pinned, played), 'b', T).mates).toEqual([]);
    });

    it('delivers a line said to a team to that team only, and marks it', () => {
      const chat = [
        { id: 1, userId: 'a', username: 'user_a', text: 'for all', emote: null, at, scope: 'all' as const, team: null },
        { id: 2, userId: 'a', username: 'user_a', text: 'for my team', emote: null, at, scope: 'team' as const, team: 0 as const },
      ];
      const seenBy = (userId: string) => stateFor(snapshot({ kind: 'team', chat }, four, played), userId, T).chat.map((entry) => [entry.text, entry.scope]);
      expect(seenBy('b')).toEqual([
        ['for all', 'all'],
        ['for my team', 'team'],
      ]);
      expect(seenBy('c')).toEqual([['for all', 'all']]);
    });
  });

  it("leaves out of a player's chat everything from the players they muted, and tells them who those are", () => {
    const at = new Date(T).toISOString();
    const chat = [
      { id: 1, userId: 'a', username: 'user_a', text: 'hello', emote: null, at },
      { id: 2, userId: 'b', username: 'user_b', text: null, emote: 'gg' as const, at },
    ];
    const players = [player('a', { muted: ['b'] }), player('b')];
    const mine = stateFor(snapshot({ chat }, players), 'a', T);
    expect(mine.chat.map((entry) => entry.id)).toEqual([1]);
    expect(mine.you.muted).toEqual(['user_b']);
    expect(stateFor(snapshot({ chat }, players), 'b', T)).toMatchObject({ chat: [{ id: 1 }, { id: 2 }], you: { muted: [] } });
  });

  it("carries each player's country and whether they are a guest, and the party's lock and settings", () => {
    const players = [player('a', { country: 'FR' }), player('b', { guest: true, username: 'Guest #4821' })];
    const state = stateFor(snapshot({ kind: 'party', locked: true }, players), 'b', T);
    expect(state.players.map((entry) => [entry.username, entry.country, entry.guest])).toEqual([
      ['user_a', 'FR', false],
      ['Guest #4821', null, true],
    ]);
    expect(state).toMatchObject({ locked: true, movedToQueue: null, you: { guest: true }, settings: { communication: 'chat', teams: 'none', guests: true } });
  });
});
