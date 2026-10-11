import { PARTY_LIMITS, type MatchPlayer, type MatchSettings, type MatchState, type PartySettings } from './client.ts';

/**
 * Pure reading of a party: what its form may send, what its host is offered, who sits on which
 * team, and where a player who joins a game under way comes in. No requests, no DOM.
 */

/** What the party form opens on: the world, moving, a minute a round, five rounds, chat on, no teams, guests allowed. */
export const DEFAULT_PARTY: MatchSettings = { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'chat', teams: 'none', guests: true };

const within = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A whole number of rounds the server takes: 1 to 20. Anything that is no number is one round. */
export function clampRounds(rounds: number): number {
  return Number.isFinite(rounds) ? within(Math.round(rounds), PARTY_LIMITS.minRounds, PARTY_LIMITS.maxRounds) : PARTY_LIMITS.minRounds;
}

/** A round's time the server takes: 0 for no timer, or 10 to 300 seconds in steps of 10. */
export function clampTime(seconds: number): number {
  const { minTime, maxTime, timeStep } = PARTY_LIMITS;
  if (!Number.isFinite(seconds) || seconds < minTime / 2) {
    return 0;
  }
  return within(Math.round(seconds / timeStep) * timeStep, minTime, maxTime);
}

/** Settings as the server takes them, whatever a control handed over: every field present and within its limits. */
export function partySettings(settings: PartySettings): MatchSettings {
  return {
    map: settings.map,
    mode: settings.mode,
    timeLimit: clampTime(settings.timeLimit),
    rounds: clampRounds(settings.rounds),
    communication: settings.communication ?? DEFAULT_PARTY.communication,
    teams: settings.teams ?? DEFAULT_PARTY.teams,
    guests: settings.guests ?? DEFAULT_PARTY.guests,
  };
}

const hosting = (state: MatchState) => state.kind === 'party' && state.you.isHost;

export interface PlayerOffers {
  /** put the player out of the party for good */
  kick: boolean;
  /** hand the party to the player */
  makeHost: boolean;
}

/**
 * What the viewer may do to one player. Only a party's host is offered anything, and never on
 * themselves. A guest cannot host, and the party cannot change hands while its places are found.
 */
export function playerOffers(state: MatchState, player: Pick<MatchPlayer, 'username' | 'guest'>): PlayerOffers {
  if (!hosting(state) || player.username === state.you.username) {
    return { kick: false, makeHost: false };
  }
  return { kick: true, makeHost: !player.guest && state.phase !== 'preparing' };
}

export interface PartyOffers {
  /** change the settings: in the lobby */
  configure: boolean;
  /** close the party to new players, or open it again: until it is over */
  lock: boolean;
  /** split the players into two even teams: in the lobby of a party with teams */
  shuffle: boolean;
  /** end the round being played, once it has started */
  endRound: boolean;
  /** queue for 2v2 as a pair: in a lobby holding exactly two accounts */
  pair: boolean;
}

const NOTHING: PartyOffers = { configure: false, lock: false, shuffle: false, endRound: false, pair: false };

/** What the viewer may do to the party itself. Everything here is the host's alone. */
export function partyOffers(state: MatchState, serverNowMs: number): PartyOffers {
  if (!hosting(state)) {
    return NOTHING;
  }
  const lobby = state.phase === 'lobby';
  const started = state.roundStartsAt !== null && Date.parse(state.roundStartsAt) <= serverNowMs;
  return {
    configure: lobby,
    lock: state.phase !== 'finished',
    shuffle: lobby && state.settings.teams !== 'none',
    endRound: state.phase === 'playing' && started,
    pair: lobby && state.players.length === PARTY_LIMITS.minPlayers && state.players.every((player) => !player.guest),
  };
}

export interface Seating {
  /** the members of team 1 and of team 2, in the order the server lists the players */
  teams: [MatchPlayer[], MatchPlayer[]];
  /** players who have picked no team and were dealt none */
  unseated: MatchPlayer[];
}

/** Who sits where in a party with teams. Null in a match without them. */
export function seating(state: MatchState): Seating | null {
  if (state.teams === null) {
    return null;
  }
  const on = (team: 0 | 1 | null) => state.players.filter((player) => player.team === team);
  return { teams: [on(0), on(1)], unseated: on(null) };
}

/** True for a player with a guess in this match already: one who was in it before, and has only come back to it. */
function hasPlayed(state: MatchState): boolean {
  const name = state.you.username;
  const guessedBefore = state.results.some((result) => result.guesses.some((guess) => guess.username === name && guess.lng !== null));
  return guessedBefore || state.players.some((player) => player.username === name && player.guessed);
}

/**
 * The round a player who has just joined a party under way comes in on, or null when they play
 * the round the match is on: one still being prepared, or one whose get-ready is still running.
 * Otherwise it is the round after the one being played or revealed. A player who has guessed in
 * this match before is coming back to it, not joining it, and is in the round it is on.
 */
export function partyJoinRound(state: MatchState, serverNowMs: number): number | null {
  if (state.kind !== 'party' || (state.phase !== 'playing' && state.phase !== 'reveal') || hasPlayed(state)) {
    return null;
  }
  const started = state.roundStartsAt === null || Date.parse(state.roundStartsAt) <= serverNowMs;
  return state.phase === 'playing' && !started ? null : state.round + 1;
}
