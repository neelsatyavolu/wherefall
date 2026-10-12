import { healthAfter, teamHealthAfter } from './health.js';
import {
  COUNTDOWN_MS,
  CUT_MS,
  GUESS_GRACE_MS,
  INACTIVE_AFTER_MS,
  JOIN_NEEDS_LEFT_MS,
  LAST_REVEAL_MS,
  MAX_PARTY_PLAYERS,
  MAX_PUBLIC_PLAYERS,
  MIN_ROUNDS_TO_JOIN,
  RANKED_CUT_MS,
  RANKED_REVEAL_MS,
  REVEAL_MS,
  type GuessRecord,
  type MatchRecord,
  type PlayerRecord,
} from './types.js';

/**
 * How a match ended. `winners` are user ids, empty for a draw or a cancelled
 * match. `rated` is false when it was cancelled, and in co-op, where there is
 * nobody to beat. `dodgedBy` is the player who left a ranked duel before its
 * first guess, which is what cancelled it.
 */
export interface MatchResult {
  winners: string[];
  rated: boolean;
  dodgedBy: string | null;
}

export interface Advance {
  /** The very same object that was passed in when nothing was due. */
  match: MatchRecord;
  /** Set on the call that finishes the match, and on no other. */
  result: MatchResult | null;
}

const CANCELLED: MatchResult = { winners: [], rated: false, dodgedBy: null };

export const isActive = (player: PlayerRecord, at: number): boolean => player.leftAt === null && player.lastSeenAt > at - INACTIVE_AFTER_MS;

/** True for a party everyone plays together, where one player's guess is everyone's. */
export const isCoop = (match: MatchRecord): boolean => match.settings.teams === 'coop';

/** True for 2v2 and for a party played in two teams. */
export const hasTeams = (match: MatchRecord): boolean => match.kind === 'team' || match.settings.teams === 'best' || match.settings.teams === 'average';

const TOGETHER = 'together';

/** Who a player's points count for: their team where there are teams, everyone in co-op, themselves in every other match. */
function sideOf(match: MatchRecord, player: PlayerRecord): string {
  if (isCoop(match)) {
    return TOGETHER;
  }
  return hasTeams(match) ? `team${player.team}` : player.userId;
}

/**
 * Who picks in a co-op match: the player the host named while they are still
 * in it, otherwise the host. Null in every other match.
 */
export function pickerOf(match: MatchRecord, players: PlayerRecord[]): PlayerRecord | null {
  if (!isCoop(match)) {
    return null;
  }
  const still = (userId: string | null): PlayerRecord | undefined => players.find((player) => player.userId === userId && player.leftAt === null);
  return still(match.pickerId) ?? still(match.resolverId) ?? null;
}

/**
 * A co-op match under way with its pick in the hands of someone who is there
 * to make it at `at`: the picker while they are being heard from, otherwise
 * the next player by seat who is, coming round to the first. The very same
 * object comes back when the pick stays where it is.
 */
function withPicker(match: MatchRecord, players: PlayerRecord[], at: number): MatchRecord {
  if (!isCoop(match) || match.phase === 'lobby' || match.phase === 'finished') {
    return match;
  }
  const named = match.pickerId ?? match.resolverId;
  // Someone who joined during this round plays from the next, so the pick is not theirs yet.
  const able = players.filter((player) => isActive(player, at) && player.joinedRound <= match.round);
  // A picker the host removed is no longer among the players, and the pick starts again from the first seat.
  const seat = players.find((player) => player.userId === named)?.seat ?? -1;
  const next = able.find((player) => player.userId === named) ?? able.find((player) => player.seat > seat) ?? able[0];
  return next === undefined || next.userId === match.pickerId ? match : { ...match, pickerId: next.userId };
}

const membersOf = (match: MatchRecord, players: PlayerRecord[], side: string): string[] =>
  players.filter((player) => sideOf(match, player) === side).map((player) => player.userId);

/** When the current phase runs out, if it does. A round with no timer never does by itself. */
function deadlineOf(match: MatchRecord): number | null {
  switch (match.phase) {
    case 'preparing':
      return match.prepareEndsAt;
    case 'playing':
      return match.roundEndsAt === null ? null : match.roundEndsAt + GUESS_GRACE_MS;
    case 'reveal':
      return match.revealEndsAt;
    default:
      return null;
  }
}

/**
 * How the match ends if too few players were still there at `at`: a party
 * with no one active is over, and a matchmade match needs two sides. A ranked
 * duel one player walks out of before anyone has guessed is not a loss: it
 * is cancelled, and that player is named.
 */
function abandoned(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], at: number): MatchResult | null {
  const active = players.filter((player) => isActive(player, at));
  if (match.kind === 'party') {
    return active.length === 0 ? CANCELLED : null;
  }
  const [remaining, ...others] = new Set(active.map((player) => sideOf(match, player)));
  if (others.length > 0) {
    return null;
  }
  if (remaining === undefined) {
    return CANCELLED;
  }
  if (match.kind === 'ranked' && guesses.length === 0) {
    const gone = players.find((player) => sideOf(match, player) !== remaining);
    return { ...CANCELLED, dodgedBy: gone?.userId ?? null };
  }
  return { winners: membersOf(match, players, remaining), rated: true, dodgedBy: null };
}

/** A side's score in one round: its own guess, its best member's, or the rounded mean of the members who could play the round. */
function roundScore(match: MatchRecord, members: PlayerRecord[], guesses: GuessRecord[], round: number): number {
  const playing = members.filter((member) => member.joinedRound <= round);
  const scores = playing.map((member) => guesses.find((guess) => guess.userId === member.userId && guess.round === round)?.score ?? 0);
  if (scores.length === 0) {
    return 0;
  }
  return match.settings.teams === 'average' ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : Math.max(...scores);
}

/** Each side's total over the first `rounds` rounds. */
export function sideTotals(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], rounds: number): Map<string, number> {
  const sides = [...new Set(players.map((player) => sideOf(match, player)))];
  return new Map(
    sides.map((side) => {
      const members = players.filter((player) => sideOf(match, player) === side);
      const total = Array.from({ length: rounds }, (_unused, round) => roundScore(match, members, guesses, round)).reduce((sum, score) => sum + score, 0);
      return [side, total];
    }),
  );
}

/** What decides a match, by side, after the first `rounds` rounds: health in a duel and in 2v2, the total everywhere else. */
function standingsAfter(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], rounds: number): Map<string, number> {
  if (match.kind === 'ranked') {
    return healthAfter(players, guesses, rounds);
  }
  if (match.kind === 'team') {
    return new Map([...teamHealthAfter(players, guesses, rounds)].map(([team, health]) => [`team${team}`, health]));
  }
  return sideTotals(match, players, guesses, rounds);
}

/** True when the round being played or revealed is the match's last: by count, or because someone's health has run out. */
function isLastRound(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[]): boolean {
  if (match.round + 1 >= match.settings.rounds) {
    return true;
  }
  const byHealth = match.kind === 'ranked' || match.kind === 'team';
  return byHealth && [...standingsAfter(match, players, guesses, match.round + 1).values()].some((health) => health <= 0);
}

/** The result of a match played to the end: the side with the most wins, and a tie for first is a draw. Co-op has one side, and no winner. */
function standings(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[]): MatchResult {
  if (isCoop(match)) {
    return { winners: [], rated: false, dodgedBy: null };
  }
  const totals = standingsAfter(match, players, guesses, match.round + 1);
  const top = Math.max(...totals.values());
  const [leader, ...tied] = [...totals].filter(([, total]) => total === top).map(([side]) => side);
  return { winners: leader !== undefined && tied.length === 0 ? membersOf(match, players, leader) : [], rated: true, dodgedBy: null };
}

const finish = (match: MatchRecord, result: MatchResult, now: number): Advance => ({
  match: { ...match, phase: 'finished', finishedAt: now },
  result,
});

/** The match with its round's result on show from `at`: for less time in a duel, and least after the round that ends it. */
export function revealed(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], at: number): MatchRecord {
  const shownFor = isLastRound(match, players, guesses) ? LAST_REVEAL_MS : match.kind === 'ranked' ? RANKED_REVEAL_MS : REVEAL_MS;
  return { ...match, phase: 'reveal', revealEndsAt: at + shownFor };
}

/** The match after its current phase has run out at `deadline`. */
function afterDeadline(match: MatchRecord, deadline: number, players: PlayerRecord[], guesses: GuessRecord[], now: number): Advance {
  if (match.phase === 'preparing') {
    // The places never came. In a ranked duel that is the doing of the player who was to post them, and counts as their walking out.
    return finish(match, match.kind === 'ranked' ? { ...CANCELLED, dodgedBy: match.resolverId } : CANCELLED, now);
  }
  if (match.phase === 'playing') {
    return { match: revealed(match, players, guesses, deadline), result: null };
  }
  if (isLastRound(match, players, guesses)) {
    return finish(match, standings(match, players, guesses), now);
  }
  const startsAt = deadline + COUNTDOWN_MS;
  const next: MatchRecord = {
    ...match,
    phase: 'playing',
    round: match.round + 1,
    roundStartsAt: startsAt,
    roundEndsAt: match.settings.timeLimit === 0 ? null : startsAt + match.settings.timeLimit * 1000,
    revealEndsAt: null,
  };
  return { match: next, result: null };
}

/** The players a round is waiting on: active, in the game since before it, and without a guess in it yet. In co-op that is the picker alone. */
function yetToGuess(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], now: number): { playing: number; waitingFor: number } {
  const guessed = new Set(guesses.filter((guess) => guess.round === match.round).map((guess) => guess.userId));
  const picker = pickerOf(match, players);
  // Someone who joined during this round plays from the next, so nobody waits for them in this one.
  const playing = players.filter((player) => isActive(player, now) && player.joinedRound <= match.round && (picker === null || player === picker));
  return { playing: playing.length, waitingFor: playing.filter((player) => !guessed.has(player.userId)).length };
}

const roundIsUnderWay = (match: MatchRecord, now: number): boolean => match.phase === 'playing' && match.roundStartsAt !== null && now >= match.roundStartsAt;

/**
 * The match with its round cut short when one player is all it is waiting
 * for: they get 20 seconds more at most, 15 in a duel. A round with no timer
 * is left alone. The very same object comes back when nothing changes.
 */
export function cutShort(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], now: number): MatchRecord {
  if (!roundIsUnderWay(match, now) || match.roundEndsAt === null) {
    return match;
  }
  const { playing, waitingFor } = yetToGuess(match, players, guesses, now);
  const cut = now + (match.kind === 'ranked' ? RANKED_CUT_MS : CUT_MS);
  return playing >= 2 && waitingFor === 1 && match.roundEndsAt > cut ? { ...match, roundEndsAt: cut } : match;
}

/**
 * The match as it stands at `now`. Nothing runs between requests, so one call
 * may have several phases to catch up on: each is taken in turn, at the time
 * it was due, and who was still playing is judged as of that time.
 */
export function advance(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], now: number): Advance {
  let current = withPicker(match, players, now);
  for (;;) {
    if (current.phase === 'finished' || current.phase === 'lobby') {
      const empty = current.phase === 'lobby' ? abandoned(current, players, guesses, now) : null;
      return empty ? finish(current, empty, now) : { match: current, result: null };
    }
    const deadline = deadlineOf(current);
    const forfeit = abandoned(current, players, guesses, deadline === null ? now : Math.min(now, deadline));
    if (forfeit) {
      return finish(current, forfeit, now);
    }
    if (deadline === null || deadline > now) {
      const done = roundIsUnderWay(current, now) && yetToGuess(current, players, guesses, now).waitingFor === 0;
      return { match: done ? revealed(current, players, guesses, now) : current, result: null };
    }
    const next = afterDeadline(current, deadline, players, guesses, now);
    if (next.result) {
      return next;
    }
    current = next.match;
  }
}

/**
 * The first round a player arriving at `now` would play in a game under way
 * that already has `seated` players, or null when it cannot take them. They
 * play the next round to start: the one about to begin when they arrive
 * during its get-ready, otherwise the one after the round being played or
 * revealed.
 *
 * A public game takes a new player while it has a seat free, at least three
 * rounds still to start and, when a round is being played, more than 15
 * seconds of it left. A party takes one while it has a seat and a round to start.
 */
export function roundToJoinFrom(match: MatchRecord, seated: number, now: number): number | null {
  const open = match.phase === 'preparing' || match.phase === 'playing' || match.phase === 'reveal';
  if (!open || (match.kind !== 'unranked' && match.kind !== 'party')) {
    return null;
  }
  const isPublic = match.kind === 'unranked';
  const underWay = roundIsUnderWay(match, now);
  const nearlyOver = isPublic && underWay && match.roundEndsAt !== null && match.roundEndsAt - now <= JOIN_NEEDS_LEFT_MS;
  const from = match.phase === 'preparing' ? 0 : match.phase === 'playing' && !underWay ? match.round : match.round + 1;
  const enoughLeft = match.settings.rounds - from >= (isPublic ? MIN_ROUNDS_TO_JOIN : 1);
  const hasSeat = seated < (isPublic ? MAX_PUBLIC_PLAYERS : MAX_PARTY_PLAYERS);
  return hasSeat && enoughLeft && !nearlyOver ? from : null;
}
