import type { LngLat } from '../game/geo.ts';
import type { ResolvedRound } from '../game/rounds.ts';
import type { RoundResult } from '../game/session.ts';
import { MAX_ROUND_SCORE } from '../game/scoring.ts';
import { formatNumber, t, tn } from '../i18n/index.ts';
import type { ChatEntry, Communication, MatchState, Place } from './client.ts';

/** Pure reading of a `MatchState`: what to show, who is ahead, how long is left. No requests, no DOM. */

const SHORT_NAME_LENGTH = 3;

type Team = 0 | 1 | null;

/**
 * What the player should be looking at. `msLeft` counts down to the end of the round or the reveal;
 * in a round it is null when the round has no timer. It is always read from the server's own
 * `roundEndsAt`, which can move earlier while a round is played, and never worked out here.
 */
export type Stage =
  | { kind: 'lobby' }
  /** `resolve` is true for the one client that has to find the places and post them */
  | { kind: 'preparing'; resolve: boolean }
  /** `msLeft` is how long the round will last once it starts */
  | { kind: 'starting'; round: number; startsInMs: number; msLeft: number | null }
  | { kind: 'guessing'; round: number; msLeft: number | null }
  /** the player has guessed and the others have not all done so */
  | { kind: 'waiting'; round: number; msLeft: number | null }
  /** the time ran out without a guess and the server has not revealed the round yet */
  | { kind: 'timeup'; round: number }
  | { kind: 'reveal'; round: number; msLeft: number }
  | { kind: 'finished'; cancelled: boolean };

export interface RoundRow {
  username: string;
  isYou: boolean;
  team: Team;
  /** null when the player placed no pin */
  guess: LngLat | null;
  distanceKm: number | null;
  score: number;
  /** points over every round up to and including this one */
  total: number;
}

export interface StandingRow {
  username: string;
  isYou: boolean;
  team: Team;
  total: number;
  won: boolean;
  active: boolean;
  /** ranked duels only */
  rating: { before: number; after: number } | null;
  /** ranked duels only: what is left of the 5000 the player started with */
  health: number | null;
}

/** Every ranked player starts a duel with this much health. */
export const START_HEALTH = 5000;

export interface HealthRow {
  username: string;
  isYou: boolean;
  health: number;
  /** what the given round took off: the gap to the higher score, for the lower scorer */
  lost: number;
  /** 0 to 1 of the starting health, for the bar */
  share: number;
}

export interface GuessStatus {
  username: string;
  isYou: boolean;
  status: 'guessed' | 'guessing' | 'away';
}

/** Milliseconds from the server's now until a server time. Zero once passed, or when there is no time. */
export function msUntil(iso: string | null, serverNowMs: number): number {
  const target = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(target) ? 0 : Math.max(0, target - serverNowMs);
}

/** A started second counts as a whole one, so the clock reads 0:30 for the first second of thirty. */
export const secondsLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * A match is cancelled when it finished without places (the resolver never posted them, or it never
 * left its lobby), or when a player left a ranked duel before anyone had guessed.
 */
export const isCancelled = (state: MatchState) => state.phase === 'finished' && (state.places === null || (state.outcome?.dodgedBy ?? null) !== null);

const you = (state: MatchState) => state.players.find((player) => player.username === state.you.username);

/** True for a party everyone plays together, where the picker's guess is everyone's. */
export const isCoop = (state: MatchState) => state.settings.teams === 'coop';

/** Whether a guess from this player counts: always, but in co-op only the picker's does. */
export const mayGuess = (state: MatchState) => !isCoop(state) || state.picker === state.you.username;

/** Co-op: who places the guess, said to the player it is said to. Empty in every other match. */
export function pickLine(state: MatchState): string {
  if (!isCoop(state) || state.picker === null) {
    return '';
  }
  return mayGuess(state) ? t('coop.youPick') : t('coop.theyPick', { name: state.picker });
}

/** True while the viewer has someone to show a pin to: on a team or in co-op, in a round being played, their own guess not yet in. */
export function sharesPin(state: MatchState): boolean {
  const together = isCoop(state) || (state.teams !== null && state.you.team !== null);
  return together && state.phase === 'playing' && you(state)?.guessed !== true;
}

export function stageOf(state: MatchState, serverNowMs: number): Stage {
  const { phase, round } = state;
  if (phase === 'lobby') {
    return { kind: 'lobby' };
  }
  if (phase === 'preparing') {
    return { kind: 'preparing', resolve: state.you.isResolver && state.places === null };
  }
  if (phase === 'finished') {
    return { kind: 'finished', cancelled: isCancelled(state) };
  }
  if (phase === 'reveal') {
    return { kind: 'reveal', round, msLeft: msUntil(state.revealEndsAt, serverNowMs) };
  }
  const startsInMs = msUntil(state.roundStartsAt, serverNowMs);
  // a round with no timer has no end to count down to: it lasts until everyone has guessed or the host ends it
  const msLeft = state.roundEndsAt === null ? null : msUntil(state.roundEndsAt, serverNowMs);
  if (you(state)?.guessed) {
    return { kind: 'waiting', round, msLeft };
  }
  if (startsInMs > 0) {
    return { kind: 'starting', round, startsInMs, msLeft: msLeft === null ? null : msLeft - startsInMs };
  }
  return msLeft === null || msLeft > 0 ? { kind: 'guessing', round, msLeft } : { kind: 'timeup', round };
}

/**
 * How long the round being played has been running, from the server's own start time. Zero before
 * it starts and outside a round. Not the time limit less what is left: the end can move earlier.
 */
export function runningForMs(state: MatchState, serverNowMs: number): number {
  const started = state.phase !== 'playing' || state.roundStartsAt === null ? Number.NaN : Date.parse(state.roundStartsAt);
  return Number.isNaN(started) ? 0 : Math.max(0, serverNowMs - started);
}

/** A number that only grows as a match moves on, to tell an old reply from a new one. */
function progressOf(state: MatchState): number {
  switch (state.phase) {
    case 'lobby':
      return -2;
    case 'preparing':
      return -1;
    case 'playing':
      return state.round * 2;
    case 'reveal':
      return state.round * 2 + 1;
    case 'finished':
      return Number.POSITIVE_INFINITY;
  }
}

/**
 * Picks the state to show. Replies can arrive out of order (a poll sent before a guess can land
 * after the guess's own reply), so one that is behind the current state is dropped, and within a
 * round a guess that was seen is never taken back.
 */
export function latest(current: MatchState | null, next: MatchState): MatchState {
  if (!current || current.id !== next.id) {
    return next;
  }
  if ((current.phase === 'finished') !== (next.phase === 'finished')) {
    // a finished party can go back to its lobby, so the end is not the end: here only the server's clock tells old from new
    const [shownAt, arrivingAt] = [Date.parse(current.serverNow), Date.parse(next.serverNow)];
    const newer = current.phase === 'finished' ? arrivingAt > shownAt : arrivingAt >= shownAt;
    return newer ? next : current;
  }
  const [shown, arriving] = [progressOf(current), progressOf(next)];
  if (arriving < shown) {
    return current;
  }
  if (arriving > shown || next.phase !== 'playing') {
    return next;
  }
  return sameRound(current, next);
}

/** The earlier of two ends of one round. A round with no timer has none. */
function earlierEnd(shown: string | null, arriving: string | null): string | null {
  if (shown === null || arriving === null) {
    return arriving;
  }
  return Date.parse(shown) < Date.parse(arriving) ? shown : arriving;
}

/**
 * Two replies about the one round being played. The server only ever takes a guess in and only
 * ever moves the end of the round earlier, so a reply that says otherwise is the older one.
 */
function sameRound(current: MatchState, next: MatchState): MatchState {
  const guessed = new Set(current.players.filter((player) => player.guessed).map((player) => player.username));
  const takenBack = next.players.some((player) => !player.guessed && guessed.has(player.username));
  const roundEndsAt = earlierEnd(current.roundEndsAt, next.roundEndsAt);
  if (!takenBack && roundEndsAt === next.roundEndsAt) {
    return next;
  }
  return { ...next, roundEndsAt, players: next.players.map((player) => (guessed.has(player.username) ? { ...player, guessed: true } : player)) };
}

/** The label on a player's pin. */
export const shortName = (username: string) => username.slice(0, SHORT_NAME_LENGTH).toUpperCase();

export function guessStatus(state: MatchState): GuessStatus[] {
  return state.players.map((player) => ({
    username: player.username,
    isYou: player.username === state.you.username,
    status: player.guessed ? 'guessed' : player.active ? 'guessing' : 'away',
  }));
}

const guessesOf = (state: MatchState, round: number) => state.results.find((result) => result.round === round)?.guesses ?? [];

/** Points a player has made over every revealed round up to and including `throughRound`. */
function totalOf(state: MatchState, username: string, throughRound: number): number {
  return state.results
    .filter((result) => result.round <= throughRound)
    .flatMap((result) => result.guesses)
    .filter((guess) => guess.username === username)
    .reduce((sum, guess) => sum + guess.score, 0);
}

const lastRound = (state: MatchState) => Math.max(-1, ...state.results.map((result) => result.round));

/** Co-op: what everyone has made together over every revealed round up to and including `throughRound`. */
function totalTogether(state: MatchState, throughRound: number): number {
  return state.results
    .filter((result) => result.round <= throughRound)
    .flatMap((result) => result.guesses)
    .reduce((sum, guess) => sum + guess.score, 0);
}

/** Co-op's one row for a revealed round: the guess made together, by the name of whoever placed it (the picker, when nobody did). */
function rowTogether(state: MatchState, round: number): RoundRow {
  const guess = guessesOf(state, round).find((made) => made.lng !== null && made.lat !== null);
  const username = guess?.username ?? state.picker ?? state.you.username;
  return {
    username,
    isYou: username === state.you.username,
    team: null,
    guess: guess && guess.lng !== null && guess.lat !== null ? { lng: guess.lng, lat: guess.lat } : null,
    distanceKm: guess?.distanceKm ?? null,
    score: guess?.score ?? 0,
    total: totalTogether(state, round),
  };
}

/** The row a player's own score, sound and pin are read from: their own, and in co-op the one made together. */
export const ownRow = (state: MatchState, rows: readonly RoundRow[]): RoundRow | undefined => (isCoop(state) ? rows[0] : rows.find((row) => row.isYou));

/** One row per player for a revealed round, best score first. A player with no guess scores 0. Co-op has one row for everyone. */
export function roundTable(state: MatchState, round: number): RoundRow[] {
  if (isCoop(state)) {
    return [rowTogether(state, round)];
  }
  const guesses = guessesOf(state, round);
  const rows = state.players.map((player): RoundRow => {
    const guess = guesses.find((g) => g.username === player.username);
    return {
      username: player.username,
      isYou: player.username === state.you.username,
      team: player.team,
      guess: guess && guess.lng !== null && guess.lat !== null ? { lng: guess.lng, lat: guess.lat } : null,
      distanceKm: guess?.distanceKm ?? null,
      score: guess?.score ?? 0,
      total: totalOf(state, player.username, round),
    };
  });
  return [...rows].sort((a, b) => b.score - a.score);
}

/**
 * What each team made in one round: the score of its best member, or, in a party that scores teams
 * by their average, the rounded mean of its members' scores, a member with no guess counting 0.
 */
export function teamRoundScores(state: MatchState, round: number): [number, number] {
  const guesses = guessesOf(state, round);
  const scored = (team: 0 | 1) => {
    const members = state.players.filter((player) => player.team === team).map((player) => player.username);
    const scores = members.map((username) => guesses.find((guess) => guess.username === username)?.score ?? 0);
    if (state.settings.teams === 'average') {
      return scores.length === 0 ? 0 : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
    }
    return Math.max(0, ...scores);
  };
  return [scored(0), scored(1)];
}

export function teamTotals(state: MatchState, throughRound: number = lastRound(state)): [number, number] {
  return state.results
    .filter((result) => result.round <= throughRound)
    .map((result) => teamRoundScores(state, result.round))
    .reduce<[number, number]>((sum, scores) => [sum[0] + scores[0], sum[1] + scores[1]], [0, 0]);
}

/** The final table: every player, highest total first. */
export function standing(state: MatchState): StandingRow[] {
  const winners = new Set(state.outcome?.winners ?? []);
  const through = lastRound(state);
  const rows = state.players.map((player): StandingRow => {
    const change = state.outcome?.ratingChanges.find((c) => c.username === player.username);
    return {
      username: player.username,
      isYou: player.username === state.you.username,
      team: player.team,
      total: totalOf(state, player.username, through),
      won: winners.has(player.username),
      active: player.active,
      rating: change ? { before: change.before, after: change.after } : null,
      health: player.health,
    };
  });
  // a ranked duel is decided on health, everything else on points
  return [...rows].sort((a, b) => (b.health ?? 0) - (a.health ?? 0) || b.total - a.total);
}

/**
 * Health in a ranked duel, one row per player in the order the server lists them. `round` is the
 * revealed round whose damage to show, or null for none. Empty for every other kind of match.
 */
export function healthRows(state: MatchState, round: number | null): HealthRow[] {
  if (state.kind !== 'ranked') {
    return [];
  }
  const guesses = round === null ? [] : guessesOf(state, round);
  const best = Math.max(0, ...guesses.map((guess) => guess.score));
  return state.players.map((player) => {
    const health = player.health ?? START_HEALTH;
    const scored = guesses.find((guess) => guess.username === player.username)?.score ?? 0;
    return {
      username: player.username,
      isYou: player.username === state.you.username,
      health,
      lost: guesses.length === 0 ? 0 : best - scored,
      share: Math.min(1, Math.max(0, health / START_HEALTH)),
    };
  });
}

/**
 * Whether a revealed round is the match's last: the last by count, or the one that leaves a player
 * of a ranked duel, or a team of a 2v2, with no health.
 */
export function isLastRound(state: MatchState, round: number): boolean {
  const spent = (health: number | null) => health !== null && health <= 0;
  return round >= state.settings.rounds - 1 || state.players.some((player) => spent(player.health)) || (state.teams ?? []).some((team) => spent(team.health));
}

/**
 * What this player can say in the match. Free chat exists only in a party whose host allows it and
 * in 2v2, and never for a guest; public games and ranked duels have the reactions alone.
 */
export function chatMode(state: MatchState): Communication {
  const allowed = state.kind === 'party' ? state.settings.communication : state.kind === 'team' ? 'chat' : 'reactions';
  return allowed === 'chat' && state.you.guest ? 'reactions' : allowed;
}

/** Messages and reactions from other players that arrived after the one the player last saw. */
export function unreadCount(chat: readonly ChatEntry[], lastSeenId: number, username: string): number {
  return chat.filter((entry) => entry.id > lastSeenId && entry.username !== username).length;
}

/** What a chat entry says: the message, or the reaction's word. */
export const chatLine = (entry: ChatEntry) => entry.text ?? entry.emote ?? '';

/** One sentence on how the match ended. Empty while it is still running. */
export function outcomeLine(state: MatchState): string {
  if (!state.outcome) {
    return '';
  }
  if (isCancelled(state)) {
    return t('outcome.cancelled');
  }
  if (isCoop(state)) {
    const max = state.results.length * MAX_ROUND_SCORE;
    return t('outcome.coop', { score: formatNumber(totalTogether(state, lastRound(state))), max: formatNumber(max) });
  }
  const { winners } = state.outcome;
  if (winners.length === 0) {
    return t('outcome.draw');
  }
  const won = winners.includes(state.you.username);
  if (state.teams !== null) {
    return won ? t('outcome.yourTeam') : t('outcome.otherTeam');
  }
  return won ? t('outcome.you') : tn('outcome.won', winners.length, { names: winners.reduce((first, second) => t('common.pair', { first, second })) });
}

/** The player's own guesses (in co-op, the ones made together) against the true places, in the shape the map and tables already draw. */
export function ownResults(state: MatchState): RoundResult[] {
  const places = state.places ?? [];
  return state.results.flatMap((result) => {
    const location = places[result.round];
    const row = ownRow(state, roundTable(state, result.round));
    return location && row ? [{ location, guess: row.guess, distanceKm: row.distanceKm, score: row.score, hinted: false }] : [];
  });
}

/**
 * The posted places still to be loaded before `round` can be shown, by a client that has loaded
 * the first `loaded` of them. The server may send every round's place at once or only those of the
 * rounds reached so far, so a round can come whose place was not there when the first were loaded.
 * Empty while the round has its picture, and when the server has sent nothing more.
 */
export function placesToLoad(places: readonly Place[] | null, loaded: number, round: number): Place[] {
  const posted = places ?? [];
  return round >= loaded && posted.length > loaded ? posted.slice(loaded) : [];
}

/**
 * What the resolver posts: each place where its list has it. The picture can stand a little off
 * that spot (a retired panorama's neighbour), and the server takes a place only where it knows it.
 */
export function toPlaces(rounds: ReadonlyArray<ResolvedRound<LngLat>>): Place[] {
  return rounds.map(({ location: { id, lng, lat, country } }) => ({ id, lng, lat, country }));
}
