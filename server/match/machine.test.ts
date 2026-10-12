import { describe, expect, it } from 'vitest';
import { advance, cutShort, isActive, revealed, roundToJoinFrom } from './machine.js';
import {
  COUNTDOWN_MS,
  CUT_MS,
  GUESS_GRACE_MS,
  JOIN_NEEDS_LEFT_MS,
  LAST_REVEAL_MS,
  RANKED_CUT_MS,
  RANKED_REVEAL_MS,
  INACTIVE_AFTER_MS,
  PREPARE_MS,
  REVEAL_MS,
  type GuessRecord,
  type MatchKind,
  type MatchRecord,
  type PlayerRecord,
  type Team,
} from './types.js';

const T = 1_800_000_000_000;
const SECOND = 1000;
const ROUND_MS = 60 * SECOND;
const PLACES = [0, 1, 2].map((index) => ({ id: `p${index}`, lng: index, lat: index, country: 'FR' }));

const match = (change: Partial<MatchRecord> = {}): MatchRecord => ({
  id: 'm',
  code: null,
  kind: 'unranked',
  phase: 'playing',
  settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 3, communication: 'chat', teams: 'none', guests: true },
  locked: false,
  movedToQueue: null,
  seed: 'seed',
  resolverId: 'a',
  pickerId: null,
  round: 0,
  prepareEndsAt: null,
  roundStartsAt: T,
  roundEndsAt: T + ROUND_MS,
  revealEndsAt: null,
  places: PLACES,
  scaleKm: 14_916.862,
  outcome: null,
  finishedAt: null,
  chat: [],
  ...change,
});

const player = (userId: string, lastSeenAt: number, team: Team = null, leftAt: number | null = null): PlayerRecord => ({
  userId,
  username: userId,
  rating: 1000,
  seat: userId.charCodeAt(0),
  team,
  lastSeenAt,
  leftAt,
  joinedRound: 0,
  country: null,
  guest: false,
  ratedGames: 0,
  muted: [],
  pin: null,
  banned: false,
});

const guess = (userId: string, round: number, score: number): GuessRecord => ({ userId, round, lng: 0, lat: 0, distanceKm: 1, score });

/** Two players who were both polling a moment before `now`. */
const both = (now: number): PlayerRecord[] => [player('a', now), player('b', now)];

describe('isActive', () => {
  it('holds until 30 seconds have passed without a poll', () => {
    const one = player('a', T);
    expect(isActive(one, T + INACTIVE_AFTER_MS - 1)).toBe(true);
    expect(isActive(one, T + INACTIVE_AFTER_MS)).toBe(false);
  });

  it('never holds for a player who left', () => {
    expect(isActive(player('a', T, null, T), T)).toBe(false);
  });
});

describe('advance', () => {
  it('returns the very same match when nothing is due', () => {
    const current = match();
    const moved = advance(current, both(T + SECOND), [], T + SECOND);
    expect(moved.match).toBe(current);
    expect(moved.result).toBeNull();
  });

  it('leaves a finished match alone', () => {
    const current = match({ phase: 'finished', finishedAt: T });
    expect(advance(current, [], [], T + 999_999)).toEqual({ match: current, result: null });
  });

  describe('lobby', () => {
    const lobby = match({ kind: 'party', code: 'ABCDEF', phase: 'lobby', roundStartsAt: null, roundEndsAt: null, places: null, scaleKm: null });

    it('waits for as long as someone is there', () => {
      expect(advance(lobby, [player('a', T)], [], T + INACTIVE_AFTER_MS - 1).match).toBe(lobby);
    });

    it('ends, with no winner, when no one is active', () => {
      const moved = advance(lobby, [player('a', T)], [], T + INACTIVE_AFTER_MS);
      expect(moved.match).toMatchObject({ phase: 'finished', finishedAt: T + INACTIVE_AFTER_MS });
      expect(moved.result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });

    it('ends when the last player has left', () => {
      expect(advance(lobby, [], [], T).result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });
  });

  describe('preparing', () => {
    const preparing = match({ phase: 'preparing', prepareEndsAt: T + PREPARE_MS, roundStartsAt: null, roundEndsAt: null, places: null, scaleKm: null });

    it('waits for the places until 45 seconds are up', () => {
      const now = T + PREPARE_MS - 1;
      expect(advance(preparing, both(now), [], now).match).toBe(preparing);
    });

    it('cancels the match, unrated, when the places never come', () => {
      const now = T + PREPARE_MS;
      const moved = advance(preparing, both(now), [], now);
      expect(moved.match.phase).toBe('finished');
      expect(moved.result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });
  });

  describe('playing', () => {
    it('keeps the round open through the countdown and the time limit', () => {
      const waiting = match({ roundStartsAt: T + COUNTDOWN_MS, roundEndsAt: T + COUNTDOWN_MS + ROUND_MS });
      expect(advance(waiting, both(T), [], T).match).toBe(waiting);
      const now = T + ROUND_MS + GUESS_GRACE_MS - 1;
      expect(advance(match(), both(now), [guess('a', 0, 100)], now).match.phase).toBe('playing');
    });

    it('reveals the round a moment after its time is up, for ten seconds', () => {
      const now = T + ROUND_MS + GUESS_GRACE_MS;
      const moved = advance(match(), both(now), [guess('a', 0, 100)], now);
      expect(moved.match).toMatchObject({ phase: 'reveal', round: 0, revealEndsAt: now + REVEAL_MS });
      expect(moved.result).toBeNull();
    });

    it('reveals the round at once when every active player has guessed', () => {
      const now = T + 5 * SECOND;
      const moved = advance(match(), both(now), [guess('a', 0, 100), guess('b', 0, 200)], now);
      expect(moved.match).toMatchObject({ phase: 'reveal', round: 0, revealEndsAt: now + REVEAL_MS });
    });

    it('does not wait for an inactive player in a party', () => {
      const now = T + 45 * SECOND;
      const players = [player('a', now), player('b', T)];
      const moved = advance(match({ kind: 'party' }), players, [guess('a', 0, 100)], now);
      expect(moved.match.phase).toBe('reveal');
    });

    it('does not count guesses from an earlier round', () => {
      const now = T + 5 * SECOND;
      const current = match({ round: 1 });
      expect(advance(current, both(now), [guess('a', 0, 100), guess('b', 0, 200), guess('a', 1, 50)], now).match).toBe(current);
    });

    it('does not end a round before it has started, whatever was guessed', () => {
      const waiting = match({ roundStartsAt: T + COUNTDOWN_MS, roundEndsAt: T + COUNTDOWN_MS + ROUND_MS });
      expect(advance(waiting, both(T), [guess('a', 0, 1), guess('b', 0, 1)], T).match).toBe(waiting);
    });
  });

  describe('reveal', () => {
    const reveal = match({ phase: 'reveal', revealEndsAt: T + REVEAL_MS });

    it('lasts ten seconds', () => {
      const now = T + REVEAL_MS - 1;
      expect(advance(reveal, both(now), [], now).match).toBe(reveal);
    });

    it('then schedules the next round three seconds on', () => {
      const now = T + REVEAL_MS;
      const moved = advance(reveal, both(now), [], now);
      expect(moved.match).toMatchObject({
        phase: 'playing',
        round: 1,
        roundStartsAt: now + COUNTDOWN_MS,
        roundEndsAt: now + COUNTDOWN_MS + ROUND_MS,
        revealEndsAt: null,
      });
    });

    it('finishes the match after the last round', () => {
      const now = T + REVEAL_MS;
      const moved = advance({ ...reveal, round: 2 }, both(now), [guess('a', 0, 100), guess('b', 0, 90)], now);
      expect(moved.match).toMatchObject({ phase: 'finished', round: 2, finishedAt: now });
      expect(moved.result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });
  });

  describe('a late tick', () => {
    it('schedules from the deadlines, not from when it happened to run', () => {
      const late = T + ROUND_MS + GUESS_GRACE_MS + 4 * SECOND;
      const moved = advance(match(), both(late), [], late);
      expect(moved.match).toMatchObject({ phase: 'reveal', revealEndsAt: T + ROUND_MS + GUESS_GRACE_MS + REVEAL_MS });
    });

    it('replays every phase that has passed, to the end of the match', () => {
      const perRound = ROUND_MS + GUESS_GRACE_MS + REVEAL_MS + COUNTDOWN_MS;
      const beforeEnd = T + 2 * perRound + ROUND_MS + GUESS_GRACE_MS + LAST_REVEAL_MS - 1;
      const players = both(beforeEnd);
      expect(advance(match({ kind: 'party' }), players, [], beforeEnd).match).toMatchObject({ phase: 'reveal', round: 2 });
      const moved = advance(match({ kind: 'party' }), both(beforeEnd + 1), [guess('b', 0, 10)], beforeEnd + 1);
      expect(moved.match.phase).toBe('finished');
      expect(moved.result).toEqual({ winners: ['b'], rated: true, dodgedBy: null });
    });
  });

  describe('standings', () => {
    const lastReveal = match({ phase: 'reveal', round: 2, revealEndsAt: T });
    const finish = (kind: MatchKind, players: PlayerRecord[], guesses: GuessRecord[]) => advance({ ...lastReveal, kind }, players, guesses, T).result;

    it('gives the match to the highest total over the rounds', () => {
      const guesses = [guess('a', 0, 5000), guess('b', 0, 100), guess('b', 1, 3000), guess('b', 2, 2500)];
      expect(finish('ranked', both(T), guesses)).toEqual({ winners: ['b'], rated: true, dodgedBy: null });
    });

    it('calls equal totals a draw, with no winners', () => {
      expect(finish('ranked', both(T), [guess('a', 0, 400), guess('b', 1, 400)])).toEqual({ winners: [], rated: true, dodgedBy: null });
      expect(finish('unranked', both(T), [])).toEqual({ winners: [], rated: true, dodgedBy: null });
    });

    it('calls a tie for first among three a draw', () => {
      const three = [...both(T), player('c', T)];
      expect(finish('party', three, [guess('a', 0, 400), guess('b', 0, 400), guess('c', 0, 1)])?.winners).toEqual([]);
    });

    it("scores a team by its best member's guess in each round", () => {
      const four = [player('a', T, 0), player('b', T, 0), player('c', T, 1), player('d', T, 1)];
      // Team 0: max(1000, 4000) + max(3000, 0) = 7000. Team 1: max(3500, 3500) + max(3400, 100) = 6900,
      // though its members' own totals (6900 and 3600) add up to more.
      const guesses = [
        ...[guess('a', 0, 1000), guess('b', 0, 4000), guess('a', 1, 3000)],
        ...[guess('c', 0, 3500), guess('d', 0, 3500), guess('c', 1, 3400), guess('d', 1, 100)],
      ];
      expect(finish('team', four, guesses)).toEqual({ winners: ['a', 'b'], rated: true, dodgedBy: null });
    });

    it('calls equal team totals a draw', () => {
      const four = [player('a', T, 0), player('b', T, 0), player('c', T, 1), player('d', T, 1)];
      expect(finish('team', four, [guess('a', 0, 500), guess('d', 2, 500)])?.winners).toEqual([]);
    });
  });

  describe('a ranked duel, played on health', () => {
    const reveal = (round: number) => match({ kind: 'ranked', phase: 'reveal', round, revealEndsAt: T, settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'reactions', teams: 'none', guests: true } });

    it('plays on after a reveal while both players have health left', () => {
      const moved = advance(reveal(0), both(T), [guess('a', 0, 5000), guess('b', 0, 1)], T);
      expect(moved.match).toMatchObject({ phase: 'playing', round: 1 });
      expect(moved.result).toBeNull();
    });

    it('ends after the reveal of the round that took the last of a player\'s health', () => {
      const moved = advance(reveal(0), both(T), [guess('a', 0, 5000)], T);
      expect(moved.match).toMatchObject({ phase: 'finished', round: 0 });
      expect(moved.result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });

    it('does not end before that reveal is over', () => {
      const current = { ...reveal(0), revealEndsAt: T + 1 };
      expect(advance(current, both(T), [guess('a', 0, 5000)], T).match).toBe(current);
    });

    it('adds up the rounds: health lost in one is not won back in another', () => {
      // b loses 3000, then a loses 2500, then b loses the other 2000.
      const guesses = [guess('a', 0, 3000), guess('a', 1, 0), guess('b', 1, 2500), guess('a', 2, 2000)];
      expect(advance(reveal(1), both(T), guesses, T).match).toMatchObject({ phase: 'playing', round: 2 });
      expect(advance(reveal(2), both(T), guesses, T).result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });

    it('goes to the higher health after the tenth round, and is a draw when they are equal', () => {
      expect(advance(reveal(9), both(T), [guess('b', 3, 40)], T).result).toEqual({ winners: ['b'], rated: true, dodgedBy: null });
      expect(advance(reveal(9), both(T), [guess('a', 0, 700), guess('b', 5, 700)], T).result).toEqual({ winners: [], rated: true, dodgedBy: null });
    });

    it('has no such rule in an unranked duel, which runs its rounds whatever the scores', () => {
      const unranked = { ...reveal(0), kind: 'unranked' as const };
      expect(advance(unranked, both(T), [guess('a', 0, 5000)], T).match).toMatchObject({ phase: 'playing', round: 1 });
    });
  });

  describe('a player who joined a public game under way', () => {
    const joiner = (from: number): PlayerRecord => ({ ...player('c', T + 5 * SECOND), joinedRound: from });

    it('is not waited for in the round they arrived in, which they cannot guess in', () => {
      const now = T + 5 * SECOND;
      const moved = advance(match(), [...both(now), joiner(1)], [guess('a', 0, 100), guess('b', 0, 200)], now);
      expect(moved.match.phase).toBe('reveal');
    });

    it('is waited for from their first round on, like anyone else', () => {
      const now = T + 5 * SECOND;
      const current = match({ round: 1 });
      expect(advance(current, [...both(now), joiner(1)], [guess('a', 1, 100), guess('b', 1, 200)], now).match).toBe(current);
      expect(advance(current, [...both(now), joiner(1)], [guess('a', 1, 100), guess('b', 1, 200), guess('c', 1, 5)], now).match.phase).toBe('reveal');
    });

    it('keeps the game going as a side of their own when only one of the others is left', () => {
      const now = T + 5 * SECOND;
      const current = match();
      expect(advance(current, [player('a', now), player('b', now, null, now), joiner(1)], [], now).match).toBe(current);
    });

    it('can win it on the rounds they played', () => {
      const lastReveal = match({ phase: 'reveal', round: 2, revealEndsAt: T });
      const guesses = [guess('a', 0, 1000), guess('b', 0, 900), guess('c', 1, 5000), guess('c', 2, 5000)];
      expect(advance(lastReveal, [...both(T), joiner(1)], guesses, T).result).toEqual({ winners: ['c'], rated: true, dodgedBy: null });
    });
  });

  describe('inactivity', () => {
    it('gives a duel to the player who is still there', () => {
      const now = T + INACTIVE_AFTER_MS;
      const moved = advance(match({ kind: 'ranked' }), [player('a', T), player('b', now)], [guess('a', 0, 5000)], now);
      expect(moved.match).toMatchObject({ phase: 'finished', finishedAt: now });
      expect(moved.result).toEqual({ winners: ['b'], rated: true, dodgedBy: null });
    });

    it('gives a duel to the other player the moment one leaves', () => {
      expect(advance(match(), [player('a', T), player('b', T, null, T)], [], T).result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });

    it('cancels a duel no one is left in', () => {
      const now = T + INACTIVE_AFTER_MS;
      expect(advance(match({ kind: 'ranked' }), both(T), [], now).result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });

    it('ends a duel while it is still being prepared', () => {
      const preparing = match({ phase: 'preparing', prepareEndsAt: T + PREPARE_MS, places: null });
      const now = T + INACTIVE_AFTER_MS;
      expect(advance(preparing, [player('a', now), player('b', T)], [], now).result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });

    it('keeps a team match going while each team has someone active', () => {
      const now = T + INACTIVE_AFTER_MS;
      const four = [player('a', now, 0), player('b', T, 0), player('c', T, 1), player('d', now, 1)];
      const current = match({ kind: 'team' });
      expect(advance(current, four, [], now).match).toBe(current);
    });

    it('gives a team match to the whole team that stayed', () => {
      const now = T + INACTIVE_AFTER_MS;
      const four = [player('a', T, 0), player('b', T, 0), player('c', now, 1), player('d', T, 1)];
      expect(advance(match({ kind: 'team' }), four, [], now).result).toEqual({ winners: ['c', 'd'], rated: true, dodgedBy: null });
    });

    it('lets a party play on with one player, and ends it when no one is active', () => {
      const now = T + INACTIVE_AFTER_MS;
      const party = match({ kind: 'party' });
      expect(advance(party, [player('a', now), player('b', T)], [], now).match).toBe(party);
      expect(advance(party, both(T), [guess('a', 0, 9)], now).result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });

    it('judges who was there at the time a deadline passed, not at the time of the tick', () => {
      // Both players were polling when the last reveal ended, then went away. The match was played out.
      const lastReveal = match({ kind: 'ranked', phase: 'reveal', round: 2, revealEndsAt: T + 5 * SECOND });
      const moved = advance(lastReveal, both(T), [guess('a', 0, 10)], T + 10 * 60 * SECOND);
      expect(moved.result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
    });

    it('stops replaying rounds once everyone has been gone for 30 seconds', () => {
      const moved = advance(match({ kind: 'ranked' }), both(T), [guess('a', 0, 10)], T + 10 * 60 * SECOND);
      expect(moved.match).toMatchObject({ phase: 'finished', round: 0 });
      expect(moved.result).toEqual({ winners: [], rated: false, dodgedBy: null });
    });
  });
});

describe('roundToJoinFrom', () => {
  const five = { map: 'world', mode: 'move', timeLimit: 45, rounds: 5, communication: 'reactions', teams: 'none', guests: true } as const;
  const game = (change: Partial<MatchRecord> = {}): MatchRecord => match({ settings: five, roundEndsAt: T + 45 * SECOND, ...change });

  it('is the first round for a game still being prepared', () => {
    expect(roundToJoinFrom(game({ phase: 'preparing', roundStartsAt: null, roundEndsAt: null, places: null }), 2, T)).toBe(0);
  });

  it('is the round about to start for a player who arrives during its get-ready', () => {
    const counting = game({ round: 1, roundStartsAt: T + COUNTDOWN_MS, roundEndsAt: T + COUNTDOWN_MS + 45 * SECOND });
    expect(roundToJoinFrom(counting, 2, T + COUNTDOWN_MS - 1)).toBe(1);
    expect(roundToJoinFrom(counting, 2, T + COUNTDOWN_MS)).toBe(2);
  });

  it('is the round after the one being played or revealed', () => {
    expect(roundToJoinFrom(game({ round: 0 }), 2, T + SECOND)).toBe(1);
    expect(roundToJoinFrom(game({ round: 1, phase: 'reveal', revealEndsAt: T + REVEAL_MS }), 2, T)).toBe(2);
  });

  it('needs at least three rounds still to start in a public game', () => {
    // Five rounds: joining from round 2 leaves three to play, from round 3 only two.
    expect(roundToJoinFrom(game({ round: 1 }), 2, T + SECOND)).toBe(2);
    expect(roundToJoinFrom(game({ round: 2 }), 2, T + SECOND)).toBeNull();
    expect(roundToJoinFrom(game({ round: 2, roundStartsAt: T + COUNTDOWN_MS }), 2, T)).toBe(2);
    expect(roundToJoinFrom(game({ round: 1, phase: 'reveal', revealEndsAt: T + REVEAL_MS }), 2, T)).toBe(2);
    expect(roundToJoinFrom(game({ round: 2, phase: 'reveal', revealEndsAt: T + REVEAL_MS }), 2, T)).toBeNull();
  });

  it('needs more than 15 seconds left in the round being played', () => {
    const ends = T + 45 * SECOND;
    expect(roundToJoinFrom(game(), 2, ends - JOIN_NEEDS_LEFT_MS - 1)).toBe(1);
    expect(roundToJoinFrom(game(), 2, ends - JOIN_NEEDS_LEFT_MS)).toBeNull();
    // A round cut short by the last-player rule counts by its new end.
    expect(roundToJoinFrom(game({ roundEndsAt: T + 10 * SECOND }), 2, T + SECOND)).toBeNull();
  });

  it('needs a free seat: ten is a full public game', () => {
    expect(roundToJoinFrom(game(), 9, T + SECOND)).toBe(1);
    expect(roundToJoinFrom(game(), 10, T + SECOND)).toBeNull();
  });

  it('lets a party take a player while one round is still to start and it has a seat among its forty', () => {
    const party = (change: Partial<MatchRecord> = {}): MatchRecord => game({ kind: 'party', ...change });
    expect(roundToJoinFrom(party({ round: 3 }), 2, T + 44 * SECOND)).toBe(4);
    expect(roundToJoinFrom(party({ round: 4 }), 2, T + SECOND)).toBeNull();
    expect(roundToJoinFrom(party({ round: 4, roundStartsAt: T + COUNTDOWN_MS }), 2, T)).toBe(4);
    expect(roundToJoinFrom(party(), 39, T + SECOND)).toBe(1);
    expect(roundToJoinFrom(party(), 40, T + SECOND)).toBeNull();
    expect(roundToJoinFrom(party({ phase: 'lobby' }), 2, T)).toBeNull();
  });

  it('is never for a game that is over, a ranked duel or a 2v2 match', () => {
    expect(roundToJoinFrom(game({ phase: 'finished', finishedAt: T }), 2, T)).toBeNull();
    for (const kind of ['ranked', 'team'] as const) {
      expect(roundToJoinFrom(game({ kind }), 2, T + SECOND)).toBeNull();
    }
  });
});

describe('pacing', () => {
  const unranked = (change: Partial<MatchRecord> = {}): MatchRecord => match({ settings: { ...match().settings, rounds: 5 }, ...change });

  it('shows a result for 10 seconds, 8 in a ranked duel, and 5 after the last round of any match', () => {
    const shownFor = (current: MatchRecord): number => (revealed(current, both(T), [], T).revealEndsAt ?? 0) - T;
    expect([REVEAL_MS, RANKED_REVEAL_MS, LAST_REVEAL_MS]).toEqual([10_000, 8_000, 5_000]);
    expect(shownFor(unranked({ round: 1 }))).toBe(REVEAL_MS);
    expect(shownFor(unranked({ kind: 'ranked', round: 1 }))).toBe(RANKED_REVEAL_MS);
    expect(shownFor(unranked({ round: 4 }))).toBe(LAST_REVEAL_MS);
    expect(shownFor(unranked({ kind: 'ranked', round: 4 }))).toBe(LAST_REVEAL_MS);
  });

  it('shows the round that decides a duel on health for 5 seconds, as the last round it is', () => {
    const knockout = revealed(unranked({ kind: 'ranked', round: 0 }), both(T), [guess('a', 0, 5000)], T);
    expect((knockout.revealEndsAt ?? 0) - T).toBe(LAST_REVEAL_MS);
  });

  it('gets ready for 5 seconds before each round', () => {
    expect(COUNTDOWN_MS).toBe(5_000);
    const moved = advance(unranked({ phase: 'reveal', revealEndsAt: T }), both(T), [], T);
    expect(moved.match).toMatchObject({ phase: 'playing', round: 1, roundStartsAt: T + 5_000, roundEndsAt: T + 5_000 + ROUND_MS });
  });

  describe('when one player is all a round is waiting for', () => {
    const three = (now: number): PlayerRecord[] => [...both(now), player('c', now)];

    it('leaves them 20 seconds at most', () => {
      const cut = cutShort(match(), three(T + SECOND), [guess('a', 0, 1), guess('b', 0, 1)], T + SECOND);
      expect(cut.roundEndsAt).toBe(T + SECOND + CUT_MS);
      expect(CUT_MS).toBe(20_000);
    });

    it('leaves them 15 in a ranked duel', () => {
      const cut = cutShort(match({ kind: 'ranked' }), both(T + SECOND), [guess('a', 0, 1)], T + SECOND);
      expect(cut.roundEndsAt).toBe(T + SECOND + RANKED_CUT_MS);
      expect(RANKED_CUT_MS).toBe(15_000);
    });

    it('never gives them longer than the round had', () => {
      const late = T + ROUND_MS - 5 * SECOND;
      const current = match();
      expect(cutShort(current, both(late), [guess('a', 0, 1)], late)).toBe(current);
    });

    it('does nothing while two or more have yet to guess, or when everyone has', () => {
      const current = match();
      expect(cutShort(current, three(T + SECOND), [guess('a', 0, 1)], T + SECOND)).toBe(current);
      expect(cutShort(current, both(T + SECOND), [guess('a', 0, 1), guess('b', 0, 1)], T + SECOND)).toBe(current);
    });

    it('does not count a player who is inactive, has left, or joined too late to play the round', () => {
      const now = T + SECOND;
      const players = [...both(now), player('c', now - INACTIVE_AFTER_MS), player('d', now, null, now), { ...player('e', now), joinedRound: 1 }];
      expect(cutShort(match(), players, [guess('a', 0, 1)], now).roundEndsAt).toBe(now + CUT_MS);
    });

    it('does nothing for a player playing alone, before the round starts, or in a round with no timer', () => {
      const alone = match({ kind: 'party' });
      expect(cutShort(alone, [player('a', T + SECOND)], [], T + SECOND)).toBe(alone);
      const waiting = match({ roundStartsAt: T + COUNTDOWN_MS, roundEndsAt: T + COUNTDOWN_MS + ROUND_MS });
      expect(cutShort(waiting, both(T), [guess('a', 0, 1)], T)).toBe(waiting);
      const untimed = match({ kind: 'party', roundEndsAt: null });
      expect(cutShort(untimed, both(T + SECOND), [guess('a', 0, 1)], T + SECOND)).toBe(untimed);
    });
  });

  describe('a round with no timer', () => {
    const untimed = match({ kind: 'party', roundEndsAt: null, settings: { ...match().settings, timeLimit: 0 } });

    it('never ends by itself', () => {
      const now = T + 60 * 60 * SECOND;
      expect(advance(untimed, both(now), [guess('a', 0, 1)], now).match).toBe(untimed);
    });

    it('ends when everyone playing it has guessed', () => {
      const now = T + 10 * 60 * SECOND;
      expect(advance(untimed, both(now), [guess('a', 0, 1), guess('b', 0, 1)], now).match).toMatchObject({ phase: 'reveal', revealEndsAt: now + REVEAL_MS });
    });

    it('is followed by another with no timer', () => {
      const moved = advance({ ...untimed, phase: 'reveal', revealEndsAt: T }, both(T), [], T);
      expect(moved.match).toMatchObject({ phase: 'playing', round: 1, roundStartsAt: T + COUNTDOWN_MS, roundEndsAt: null });
    });
  });
});

describe('teams', () => {
  const lastReveal = (kind: MatchKind, teams: 'best' | 'average'): MatchRecord =>
    match({ kind, phase: 'reveal', round: 2, revealEndsAt: T, settings: { ...match().settings, teams } });
  const four = [player('a', T, 0), player('b', T, 0), player('c', T, 1), player('d', T, 1)];

  it("scores a party team by the average of its members' guesses when asked to, a missing guess counting as 0", () => {
    // Team 0: (4000 + 0) / 2 = 2000. Team 1: (2500 + 2500) / 2 = 2500. By best guess team 0 would win.
    const guesses = [guess('a', 0, 4000), guess('c', 0, 2500), guess('d', 0, 2500)];
    expect(advance(lastReveal('party', 'average'), four, guesses, T).result).toEqual({ winners: ['c', 'd'], rated: true, dodgedBy: null });
    expect(advance(lastReveal('party', 'best'), four, guesses, T).result).toEqual({ winners: ['a', 'b'], rated: true, dodgedBy: null });
  });

  it('rounds an average to a whole number, and leaves out of it a member who joined after the round', () => {
    const late = [player('a', T, 0), { ...player('b', T, 0), joinedRound: 1 }, player('c', T, 1)];
    // Team 0 in round 0 is a alone (1001), not (1001 + 0) / 2; team 1 is c with 1000.
    expect(advance(lastReveal('party', 'average'), late, [guess('a', 0, 1001), guess('c', 0, 1000)], T).result?.winners).toEqual(['a', 'b']);
  });

  it('ends a 2v2 match when a team has no health left, the difference counting 1.3 times', () => {
    const playing = (round: number): MatchRecord => match({ kind: 'team', phase: 'reveal', round, revealEndsAt: T, settings: { ...match().settings, rounds: 5, teams: 'best', guests: true } });
    // Team 1 loses round((3846 - 0) * 1.3) = 5000: exactly all of it.
    expect(advance(playing(0), four, [guess('a', 0, 3846)], T).result).toEqual({ winners: ['a', 'b'], rated: true, dodgedBy: null });
    // One point less leaves it 1 health, and the match goes on.
    expect(advance(playing(0), four, [guess('a', 0, 3845)], T).match).toMatchObject({ phase: 'playing', round: 1 });
  });

  it('gives a 2v2 match to the team with more health after five rounds, though the other scored more in total', () => {
    const playing = match({ kind: 'team', phase: 'reveal', round: 4, revealEndsAt: T, settings: { ...match().settings, rounds: 5, teams: 'best', guests: true } });
    // Team 0 wins four rounds by 100 (team 1 loses 4 x 130); team 1 wins one by 300 (team 0 loses 390).
    const guesses = [0, 1, 2, 3].flatMap((round) => [guess('a', round, 1100), guess('c', round, 1000)]).concat([guess('a', 4, 1000), guess('d', 4, 1300)]);
    expect(advance(playing, four, guesses, T).result).toEqual({ winners: ['a', 'b'], rated: true, dodgedBy: null });
  });
});

describe('leaving a ranked duel before anyone has guessed', () => {
  const duel = match({ kind: 'ranked' });

  it('cancels it, unrated, and names who left', () => {
    expect(advance(duel, [player('a', T), player('b', T, null, T)], [], T).result).toEqual({ winners: [], rated: false, dodgedBy: 'b' });
  });

  it('is the same for a player who just stops polling, and while the places are still being picked', () => {
    const now = T + INACTIVE_AFTER_MS;
    expect(advance(duel, [player('a', T), player('b', now)], [], now).result).toEqual({ winners: [], rated: false, dodgedBy: 'a' });
    const preparing = match({ kind: 'ranked', phase: 'preparing', prepareEndsAt: T + PREPARE_MS, places: null });
    expect(advance(preparing, [player('a', T, null, T), player('b', T)], [], T).result).toEqual({ winners: [], rated: false, dodgedBy: 'a' });
  });

  it('is a loss like any other once a guess has been made', () => {
    expect(advance(duel, [player('a', T), player('b', T, null, T)], [guess('b', 0, 1)], T).result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
  });

  it('names nobody when both have gone, and is no dodge in a match that is not ranked', () => {
    expect(advance(duel, both(T), [], T + INACTIVE_AFTER_MS).result).toEqual({ winners: [], rated: false, dodgedBy: null });
    expect(advance(match(), [player('a', T), player('b', T, null, T)], [], T).result).toEqual({ winners: ['a'], rated: true, dodgedBy: null });
  });
});
