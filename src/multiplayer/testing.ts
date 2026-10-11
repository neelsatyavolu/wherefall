import type { ChatEntry, Mate, MatchOutcome, MatchSettings, MatchState, Place, QueueState, TeamState } from './client.ts';

/** Test data shared by the unit tests and the browser tests' stand-in server. Not used by the game. */

export const PLACES: Place[] = [
  { id: 'place-one', lng: 2.3522, lat: 48.8566, country: 'FR' },
  { id: 'place-two', lng: 139.6917, lat: 35.6895, country: 'JP' },
  { id: 'place-three', lng: -58.3816, lat: -34.6037, country: 'AR' },
];

export const NOW = '2026-10-11T12:00:00.000Z';

export const at = (seconds: number) => new Date(Date.parse(NOW) + seconds * 1000).toISOString();

type Player = MatchState['players'][number];

/** A player with an account, no country, on no team. */
export const player = (username: string, change: Partial<Player> = {}): Player => ({
  username,
  country: null,
  guest: false,
  team: null,
  total: 0,
  guessed: false,
  active: true,
  rating: null,
  health: null,
  ...change,
});

/** A guest, named as the server names them. */
export const guest = (number: number, change: Partial<Player> = {}): Player => player(`Guest #${number}`, { guest: true, ...change });

type Viewer = MatchState['you'];

/** `you` for "neel" as a player who is not the host: an account, on no team, with nobody muted. */
export const viewer = (change: Partial<Viewer> = {}): Viewer => ({ username: 'neel', isHost: false, isResolver: false, team: null, guest: false, muted: [], ...change });

/** A party's settings: world, moving, 30 seconds, 3 rounds, chat on, no teams, guests allowed. */
export const settings = (change: Partial<MatchSettings> = {}): MatchSettings => ({
  map: 'world',
  mode: 'move',
  timeLimit: 30,
  rounds: 3,
  communication: 'chat',
  teams: 'none',
  guests: true,
  ...change,
});

/** The settings the server fixes for each matchmade kind. */
export const KIND_SETTINGS = {
  unranked: settings({ timeLimit: 45, rounds: 5, communication: 'reactions' }),
  ranked: settings({ timeLimit: 60, rounds: 5, communication: 'reactions' }),
  team: settings({ timeLimit: 60, rounds: 5, communication: 'chat', teams: 'best' }),
} as const;

/** A two-player party in its lobby, seen by its host "neel". */
export function matchState(change: Partial<MatchState> = {}): MatchState {
  return {
    id: 'm1',
    code: 'ABC123',
    kind: 'party',
    phase: 'lobby',
    settings: settings(),
    locked: false,
    seed: 'e2e00001',
    serverNow: NOW,
    round: 0,
    roundStartsAt: null,
    roundEndsAt: null,
    revealEndsAt: null,
    you: viewer({ isHost: true, isResolver: true }),
    players: [player('neel'), player('sam')],
    teams: null,
    mates: [],
    places: null,
    results: [],
    outcome: null,
    chat: [],
    movedToQueue: null,
    ...change,
  };
}

/** A ranked duel between "neel" and "sam", seen by "neel": 5000 health each, no code, nobody the host. */
export function rankedState(change: Partial<MatchState> = {}): MatchState {
  return matchState({
    kind: 'ranked',
    code: null,
    settings: KIND_SETTINGS.ranked,
    you: viewer({ isResolver: true }),
    players: [player('neel', { rating: 1016, health: 5000 }), player('sam', { rating: 1004, health: 5000 })],
    ...change,
  });
}

/** A 2v2 seen by "neel", whose teammate is "sam"; "ana" and "kit" are the other team. Each team has 5000 health. */
export function teamState(change: Partial<MatchState> = {}): MatchState {
  return matchState({
    kind: 'team',
    code: null,
    settings: KIND_SETTINGS.team,
    you: viewer({ isResolver: true, team: 0 }),
    players: [player('neel', { team: 0 }), player('sam', { team: 0 }), player('ana', { team: 1 }), player('kit', { team: 1 })],
    teams: [teamRow(0), teamRow(1)],
    ...change,
  });
}

/** One team's line in `teams`: full health and no points unless changed. */
export const teamRow = (team: 0 | 1, change: Partial<TeamState> = {}): TeamState => ({ team, health: 5000, total: 0, ...change });

/** A teammate's pin while a round is played. */
export const mate = (username: string, change: Partial<Mate> = {}): Mate => ({ username, lng: 12, lat: 34, guessed: false, ...change });

type Guess = MatchState['results'][number]['guesses'][number];

export const guessRow = (username: string, score: number, change: Partial<Guess> = {}): Guess => ({
  username,
  lng: 10,
  lat: 20,
  distanceKm: 1234.5,
  score,
  ...change,
});

export const noGuess = (username: string): Guess => ({ username, lng: null, lat: null, distanceKm: null, score: 0 });

/** How a match ended: no rating changes and nobody dodging unless changed. */
export const outcome = (winners: string[], change: Partial<MatchOutcome> = {}): MatchOutcome => ({ winners, ratingChanges: [], dodgedBy: null, ...change });

/** A chat message to everyone, or a reaction when `emote` is given. */
export const chatEntry = (id: number, username: string, text: string | null, change: Partial<ChatEntry> = {}): ChatEntry => ({
  id,
  username,
  text,
  emote: null,
  at: at(id),
  scope: 'all',
  ...change,
});

/** The queue as a player who is in none is told of it. */
export function queueState(change: Partial<QueueState> = {}): QueueState {
  return { queued: false, kind: null, waiting: 0, matchId: null, startsAt: null, since: null, serverNow: NOW, window: null, lockedUntil: null, typicalWaitSeconds: null, ...change };
}
