import { continentOf } from '../src/game/continents.ts';
import { isMapId } from '../src/game/locations.ts';
import { MODES } from '../src/game/settings.ts';
import { COMMUNICATIONS, PARTY_LIMITS, TEAM_MODES, type MatchSettings, type MatchState, type Team } from '../src/multiplayer/client.ts';
import { guessRow, noGuess, teamRow } from '../src/multiplayer/testing.ts';
import { checkPlaces, type PlaceFile, type PlaceRow, type SentPlace } from './place-rules.ts';

/**
 * The rules of `/api/match` that the stand-in server follows, as the wave-5 and wave-6 contracts state them:
 * every function takes a match and gives back the match that follows, or the refusal the real
 * server would send. Nothing here knows about requests.
 */

export interface Refusal {
  status: number;
  error: string;
}

/** The server's own words, verbatim. */
export const SAYS = {
  signIn: 'Sign in first.',
  guests: 'Guests cannot do that. Make an account first.',
  hostOnly: 'Only the host can do that.',
  badSettings: 'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.',
  teamsNeedPlayers: 'Each team needs at least one player.',
  chatOff: 'Chat is off in this match.',
  reactionsOff: 'Reactions are off in this match.',
  removed: 'You were removed from that party.',
  locked: 'That party is locked.',
  full: 'That party is full: it has 40 players.',
  lastRound: 'That party is on its last round. Try again when it is back in its lobby.',
  noSuchPlayer: 'There is no such player in this match.',
  notYourself: 'You cannot do that to yourself.',
  guestHost: 'A guest cannot host.',
  teamsOff: 'Teams are off in this party.',
  pairOnly: 'To queue as a pair, be the host of a party of exactly two.',
  dodgeLock: (seconds: number) => `You left two ranked matches before they began. You can queue again in ${seconds} seconds.`,
  accountsOnly: 'This party is for accounts only. Make an account to join.',
  slowDown: 'Too many requests. Slow down a little.',
  banned: 'This account is banned from online play.',
  notResolver: 'Only the player picking the places can post them.',
  placeCount: (rounds: number) => `This match needs exactly ${rounds} places.`,
  notOnMap: "Those places are not on this match's map.",
  tooFewContinents: 'A world game needs places on at least three continents.',
  // one answer for a match that does not exist and for one the asker is not in (`NO_SUCH_MATCH` in server/match/play.ts)
  noSuchMatch: 'That match does not exist, or you are not in it.',
} as const;

export const refusal = (status: number, error: string): Refusal => ({ status, error });
export const isRefusal = (value: object): value is Refusal => 'status' in value && 'error' in value;

type Body = Record<string, unknown>;
type Step = MatchState | Refusal;

const TEAM_DAMAGE = 1.3;
/** When a guess leaves one player still to guess, the round ends this soon; sooner in a ranked duel. */
const CUT_MS = 20_000;
const RANKED_CUT_MS = 15_000;
const REVEAL_MS = 10_000;
const RANKED_REVEAL_MS = 8000;
const LAST_REVEAL_MS = 5000;

const isOneOf = <T extends string>(all: readonly T[], value: unknown): value is T => all.includes(value as T);

/** A public world game of this many rounds or more has its places on this many continents. */
const SPREAD = { rounds: 3, continents: 3 };
/** The widest a ranked search gets, either side of the player's rating. */
export const MAX_RANKED_WINDOW = 400;

/** Party settings as posted, checked as the server checks them. Left out, chat is on, teams are off and guests may join. */
export function readSettings(raw: unknown): MatchSettings | Refusal {
  const { map, mode, timeLimit, rounds, communication = 'chat', teams = 'none', guests = true } = (raw ?? {}) as Body;
  const { minRounds, maxRounds, minTime, maxTime, timeStep } = PARTY_LIMITS;
  const timed = Number.isInteger(timeLimit) && (timeLimit === 0 || ((timeLimit as number) >= minTime && (timeLimit as number) <= maxTime && (timeLimit as number) % timeStep === 0));
  const counted = Number.isInteger(rounds) && (rounds as number) >= minRounds && (rounds as number) <= maxRounds;
  if (typeof map !== 'string' || !isMapId(map) || !isOneOf(MODES, mode) || !timed || !counted || !isOneOf(COMMUNICATIONS, communication) || !isOneOf(TEAM_MODES, teams) || typeof guests !== 'boolean') {
    return refusal(400, SAYS.badSettings);
  }
  return { map, mode, timeLimit: timeLimit as number, rounds: rounds as number, communication, teams, guests };
}

const smallerTeam = (state: MatchState): Team => (state.players.filter((p) => p.team === 0).length <= state.players.filter((p) => p.team === 1).length ? 0 : 1);

/** A party's settings replaced. Turning teams off empties them; turning them on gives two empty teams. */
export function withSettings(state: MatchState, settings: MatchSettings): MatchState {
  const teamed = settings.teams !== 'none';
  return {
    ...state,
    settings,
    teams: teamed ? [teamRow(0, { health: null }), teamRow(1, { health: null })] : null,
    players: teamed ? state.players : state.players.map((p) => ({ ...p, team: null })),
    you: teamed ? state.you : { ...state.you, team: null },
  };
}

function seat(state: MatchState, username: string, team: Team | null): MatchState {
  return {
    ...state,
    players: state.players.map((p) => (p.username === username ? { ...p, team } : p)),
    you: state.you.username === username ? { ...state.you, team } : state.you,
  };
}

/** `team`: the player takes a seat, in the lobby of a party with teams. */
export function chooseTeam(state: MatchState, team: unknown): Step {
  if (state.settings.teams === 'none') {
    return refusal(409, SAYS.teamsOff);
  }
  return state.phase === 'lobby' && (team === 0 || team === 1) ? seat(state, state.you.username, team) : state;
}

/** `shuffle`: an even split. Here it is by turns, so a test knows who lands where. */
export function shuffle(state: MatchState): Step {
  if (state.settings.teams === 'none') {
    return refusal(409, SAYS.teamsOff);
  }
  if (state.phase !== 'lobby') {
    return state;
  }
  return state.players.reduce((next, p, index) => seat(next, p.username, (index % 2) as Team), state);
}

/** `start`: with teams, each needs a player, and the players with no seat go to the smaller team. */
export function start(state: MatchState): Step {
  if (state.phase !== 'lobby') {
    return state;
  }
  if (state.settings.teams === 'none') {
    return { ...state, phase: 'preparing' };
  }
  const seated = state.players.filter((p) => p.team === null).reduce((next, p) => seat(next, p.username, smallerTeam(next)), state);
  const manned = ([0, 1] as const).every((team) => seated.players.some((p) => p.team === team));
  return manned ? { ...seated, phase: 'preparing' } : refusal(409, SAYS.teamsNeedPlayers);
}

/** Who a host's action is aimed at, or why it cannot be. */
function target(state: MatchState, username: unknown): MatchState['players'][number] | Refusal {
  if (username === state.you.username) {
    return refusal(409, SAYS.notYourself);
  }
  return state.players.find((p) => p.username === username) ?? refusal(409, SAYS.noSuchPlayer);
}

/** `kick`: the player is in nobody's `players` and no `results`, earlier rounds included. */
export function kick(state: MatchState, username: unknown): Step {
  const found = target(state, username);
  if (isRefusal(found)) {
    return found;
  }
  return {
    ...state,
    players: state.players.filter((p) => p.username !== found.username),
    results: state.results.map((result) => ({ ...result, guesses: result.guesses.filter((g) => g.username !== found.username) })),
    mates: state.mates.filter((m) => m.username !== found.username),
  };
}

/** `host`: the party passes to another account, who is also the resolver. Not while places are being found. */
export function handOver(state: MatchState, username: unknown): Step {
  const found = target(state, username);
  if (isRefusal(found)) {
    return found;
  }
  if (found.guest) {
    return refusal(409, SAYS.guestHost);
  }
  return state.phase === 'preparing' ? state : { ...state, you: { ...state.you, isHost: false, isResolver: false } };
}

/** `mute`: that player's lines and reactions are left out of this player's chat from now on. */
export function mute(state: MatchState, username: unknown, muted: unknown): Step {
  const found = target(state, username);
  if (isRefusal(found)) {
    return found;
  }
  const others = state.you.muted.filter((name) => name !== found.username);
  return { ...state, you: { ...state.you, muted: muted === true ? [...others, found.username] : others } };
}

/** `lobby`: a finished party goes back to its lobby with the same id, code, settings and players. */
export function backToLobby(state: MatchState): MatchState {
  if (state.kind !== 'party' || state.phase !== 'finished') {
    return state;
  }
  return {
    ...state,
    phase: 'lobby',
    round: 0,
    roundStartsAt: null,
    roundEndsAt: null,
    revealEndsAt: null,
    places: null,
    results: [],
    outcome: null,
    chat: [],
    mates: [],
    movedToQueue: null,
    players: state.players.map((p) => ({ ...p, total: 0, guessed: false })),
    teams: state.teams?.map((team) => ({ ...team, total: 0 })) ?? null,
  };
}

/** A player joining: in the lobby, or under way to play from the next round. With teams they go to the smaller one. */
export function join(state: MatchState, username: string, guest: boolean): Step {
  const here = state.players.some((p) => p.username === username);
  if (state.kind !== 'party' || state.phase === 'finished' || here) {
    return state;
  }
  if (guest && !state.settings.guests) {
    return refusal(403, SAYS.accountsOnly);
  }
  if (state.locked) {
    return refusal(409, SAYS.locked);
  }
  if (state.players.length >= PARTY_LIMITS.maxPlayers) {
    return refusal(409, SAYS.full);
  }
  if (state.phase !== 'lobby' && state.round >= state.settings.rounds - 1) {
    return refusal(409, SAYS.lastRound);
  }
  const team = state.phase !== 'lobby' && state.settings.teams !== 'none' ? smallerTeam(state) : null;
  const player = { username, country: null, guest, team, total: 0, guessed: false, active: true, rating: null, health: null };
  return { ...state, players: [...state.players, player] };
}

/**
 * `places`, checked in the server's order: who is posting, whether places are still wanted, one for
 * each round, every one a place of the match's map where its list has it, and for a public world
 * game of three rounds or more, on three continents. A set that is refused changes nothing.
 */
export function postPlaces(state: MatchState, sent: unknown, lists: readonly PlaceFile[], rows: readonly PlaceRow[] | null): Step {
  if (!state.you.isResolver) {
    return refusal(403, SAYS.notResolver);
  }
  if (state.phase !== 'preparing' || state.places !== null) {
    return state;
  }
  const places = Array.isArray(sent) ? (sent as SentPlace[]) : [];
  if (places.length !== state.settings.rounds) {
    return refusal(400, SAYS.placeCount(state.settings.rounds));
  }
  const checked = checkPlaces(lists, state.settings.map, places, rows);
  if (!checked) {
    return refusal(400, SAYS.notOnMap);
  }
  const continents = new Set(checked.places.map(continentOf).filter((continent) => continent !== null)).size;
  if (state.kind !== 'party' && state.settings.rounds >= SPREAD.rounds && continents < SPREAD.continents) {
    return refusal(400, SAYS.tooFewContinents);
  }
  return { ...state, places: checked.places.map(({ id, lng, lat, country }) => ({ id, lng, lat, country })) };
}

/** Whether free chat exists in this match, and whether reactions do. */
export const chatAllowed = (state: MatchState) => state.kind === 'team' || (state.kind === 'party' && state.settings.communication === 'chat');
export const reactionsAllowed = (state: MatchState) => state.kind !== 'party' || state.settings.communication !== 'off';

/** When a guess leaves exactly one player who can still guess, the round's end comes forward. Never in a round with no timer. */
export function cutTimer(state: MatchState, nowMs: number): MatchState {
  const left = state.players.filter((p) => p.active && !p.guessed).length;
  if (state.phase !== 'playing' || state.roundEndsAt === null || left !== 1) {
    return state;
  }
  const cut = nowMs + (state.kind === 'ranked' ? RANKED_CUT_MS : CUT_MS);
  return cut < Date.parse(state.roundEndsAt) ? { ...state, roundEndsAt: new Date(cut).toISOString() } : state;
}

const sum = (numbers: readonly number[]) => numbers.reduce((total, n) => total + n, 0);

/** What each team made of a round: its best member's score, or the rounded mean of them all. */
function teamScores(state: MatchState, scoreOf: (username: string) => number): [number, number] {
  const scored = (team: Team) => {
    const scores = state.players.filter((p) => p.team === team).map((p) => scoreOf(p.username));
    if (scores.length === 0) {
      return 0;
    }
    return state.settings.teams === 'average' ? Math.round(sum(scores) / scores.length) : Math.max(...scores);
  };
  return [scored(0), scored(1)];
}

/** A round is the last when it is the last by count or leaves a duellist or a team with no health. */
function decides(state: MatchState): boolean {
  const spent = (health: number | null) => health !== null && health <= 0;
  return state.round >= state.settings.rounds - 1 || state.players.some((p) => spent(p.health)) || (state.teams ?? []).some((team) => spent(team.health));
}

/**
 * Ends the round being played. `scores` gives each player's points; a player left out made no
 * guess. Health moves as the kind of match has it, and the reveal lasts as long as the server's.
 */
export function reveal(state: MatchState, scores: Readonly<Record<string, number>>, ownGuess: { lng: number; lat: number } | null, nowMs: number): MatchState {
  const guesses = state.players.map((p, index) => {
    if (!(p.username in scores)) {
      return noGuess(p.username);
    }
    const mine = p.username === state.you.username;
    return guessRow(p.username, scores[p.username]!, mine ? { ...(ownGuess ?? { lng: 0, lat: 0 }), distanceKm: 321 } : { lng: 100 + index, lat: -10, distanceKm: 900 });
  });
  const scoreOf = (username: string) => guesses.find((g) => g.username === username)?.score ?? 0;
  const best = Math.max(0, ...guesses.map((g) => g.score));
  const [first, second] = teamScores(state, scoreOf);
  const damage = (team: Team) => (state.kind === 'team' ? Math.round(Math.max(0, (team === 0 ? second - first : first - second) * TEAM_DAMAGE)) : 0);
  const revealed: MatchState = {
    ...state,
    phase: 'reveal',
    mates: [],
    results: [...state.results, { round: state.round, guesses }],
    players: state.players.map((p) => ({
      ...p,
      total: p.total + scoreOf(p.username),
      // in a ranked duel the lower scorer loses the difference
      health: p.health === null ? null : Math.max(0, p.health - (best - scoreOf(p.username))),
    })),
    teams:
      state.teams?.map((team) => ({
        ...team,
        total: team.total + (team.team === 0 ? first : second),
        health: team.health === null ? null : Math.max(0, team.health - damage(team.team)),
      })) ?? null,
  };
  const lasts = decides(revealed) ? LAST_REVEAL_MS : state.kind === 'ranked' ? RANKED_REVEAL_MS : REVEAL_MS;
  return { ...revealed, revealEndsAt: new Date(nowMs + lasts).toISOString() };
}

/**
 * The match as its viewer is sent it: without the chat of muted players or of the other team, and
 * with the places of the rounds reached so far only (the next round's comes when `round` moves on).
 */
export function seenBy(state: MatchState): MatchState {
  const teamOf = (username: string) => state.players.find((p) => p.username === username)?.team ?? null;
  const chat = state.chat.filter((entry) => !state.you.muted.includes(entry.username)).filter((entry) => entry.scope === 'all' || teamOf(entry.username) === state.you.team);
  const places = state.places?.slice(0, Math.max(0, state.round) + 1) ?? null;
  return { ...state, places, chat: chat.slice(-30), mates: state.phase === 'playing' ? state.mates : [] };
}
