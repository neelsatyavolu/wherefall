import type { ChatEntry } from './chat.js';
import type { Place, QueueKind, Settings } from './input.js';

export type MatchKind = 'party' | QueueKind;
export type Phase = 'lobby' | 'preparing' | 'playing' | 'reveal' | 'finished';
export type Team = 0 | 1 | null;

/** How long the resolver has to post the places before the match is cancelled. */
export const PREPARE_MS = 45_000;
/** The get-ready before a round starts, so every browser can load the view. */
export const COUNTDOWN_MS = 5_000;
/** How long a round's result is shown: shorter in a duel, and shortest after the round that ends the match. */
export const REVEAL_MS = 10_000;
export const RANKED_REVEAL_MS = 8_000;
export const LAST_REVEAL_MS = 5_000;
/** Once only one player has yet to guess, the round has this long left at most; less in a duel. */
export const CUT_MS = 20_000;
export const RANKED_CUT_MS = 15_000;
/** A player who has not polled for this long is inactive. */
export const INACTIVE_AFTER_MS = 30_000;
/** A queue entry not polled for this long has lapsed. */
export const QUEUE_LAPSE_MS = 10_000;
/**
 * A guess sent as the timer reaches zero arrives a moment after it. The
 * round stays open this long past `roundEndsAt` so that guess still counts.
 */
export const GUESS_GRACE_MS = 1_000;

export const MIN_PARTY_PLAYERS = 2;
/** A school class fits. */
export const MAX_PARTY_PLAYERS = 40;

/** What every matchmade match of a kind is played with. Only a party's host chooses. */
export const QUEUE_SETTINGS: Record<QueueKind, Settings> = {
  unranked: { map: 'world', mode: 'move', timeLimit: 45, rounds: 5, communication: 'reactions', teams: 'none', guests: true },
  // A ranked duel is played on health: five rounds at most, fewer when someone runs out.
  ranked: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'reactions', teams: 'none', guests: true },
  // 2v2: each team shares its health, and a team's round is its best member's.
  team: { map: 'world', mode: 'move', timeLimit: 60, rounds: 5, communication: 'chat', teams: 'best', guests: true },
};

/** A ranked duel is two players, a team match four. An unranked game gathers its players instead. */
export const QUEUE_SIZE: Record<Exclude<QueueKind, 'unranked'>, number> = { ranked: 2, team: 4 };

/** An unranked game is public: it starts this long after its second player arrives, with whoever has joined by then. */
export const GATHER_MS = 10_000;
export const MIN_PUBLIC_PLAYERS = 2;
export const MAX_PUBLIC_PLAYERS = 10;
/** A public game under way takes a new player only while this many of its rounds have yet to start. */
export const MIN_ROUNDS_TO_JOIN = 3;
/** ...and, when a round is being played, only while it has more than this long to run. */
export const JOIN_NEEDS_LEFT_MS = 15_000;

export interface Outcome {
  /** Usernames; empty for a draw or a cancelled match. */
  winners: string[];
  /** Ranked only. */
  ratingChanges: Array<{ username: string; before: number; after: number }>;
  /** Ranked only: the player who left before the first guess, which cancelled the match. */
  dodgedBy: string | null;
}

/** A match as stored. Times are epoch milliseconds. */
export interface MatchRecord {
  id: string;
  /** Parties only. */
  code: string | null;
  kind: MatchKind;
  phase: Phase;
  settings: Settings;
  /** Parties: closed to new players. */
  locked: boolean;
  seed: string;
  /** The player who picks the places. In a party that is the host. */
  resolverId: string;
  /** Co-op: the player whose guess is everyone's. Null until one is named, which leaves it to the host. */
  pickerId: string | null;
  /** 0-based; the round being played or revealed. */
  round: number;
  prepareEndsAt: number | null;
  roundStartsAt: number | null;
  /** Null while a round with no timer is played. */
  roundEndsAt: number | null;
  revealEndsAt: number | null;
  places: Place[] | null;
  scaleKm: number | null;
  outcome: Outcome | null;
  finishedAt: number | null;
  /** The latest few chat lines and reactions. */
  chat: ChatEntry[];
  /** Set on a two-player lobby whose players went into a queue together. */
  movedToQueue: 'team' | null;
}

export interface PlayerRecord {
  userId: string;
  username: string;
  country: string | null;
  guest: boolean;
  rating: number;
  /** Rated duels played before this match, which sets how fast the rating moves. */
  ratedGames: number;
  /** Order of joining. */
  seat: number;
  team: Team;
  lastSeenAt: number;
  leftAt: number | null;
  /** The first round the player may guess in: 0 unless they joined a game under way. */
  joinedRound: number;
  /** The ids of the players whose chat this one has muted. */
  muted: string[];
  /** Where the player's pin is, and in which round, for their teammates. */
  pin: { round: number; lng: number; lat: number } | null;
  /** Banned from online play by a moderator, perhaps since they sat down. */
  banned: boolean;
}

export interface GuessRecord {
  userId: string;
  round: number;
  lng: number;
  lat: number;
  distanceKm: number;
  score: number;
}

/** A match with everyone in it and every guess made, as read under the match's lock. */
export interface Snapshot {
  match: MatchRecord;
  players: PlayerRecord[];
  guesses: GuessRecord[];
  /** The ids of players the host removed, who may not come back. */
  barred: string[];
}

/** What one player is told about a match. Times are ISO 8601. */
export interface MatchState {
  id: string;
  code: string | null;
  kind: MatchKind;
  phase: Phase;
  settings: Settings;
  locked: boolean;
  seed: string;
  serverNow: string;
  round: number;
  roundStartsAt: string | null;
  roundEndsAt: string | null;
  revealEndsAt: string | null;
  you: { username: string; isHost: boolean; isResolver: boolean; team: Team; guest: boolean; muted: string[] };
  players: Array<{
    username: string;
    country: string | null;
    guest: boolean;
    team: Team;
    total: number;
    guessed: boolean;
    active: boolean;
    /** Ranked only. */
    rating: number | null;
    /** Ranked only: what is left of 5000 after the rounds revealed so far. */
    health: number | null;
  }>;
  /** 2v2 and party team modes: each team's standing over the rounds revealed so far. */
  teams: Array<{ team: 0 | 1; health: number | null; total: number }> | null;
  /** Co-op: the username of the player whose guess is everyone's. Null in every other match. */
  picker: string | null;
  /** The pins of the asker's teammates, or in co-op of everyone else, in the round being played. */
  mates: Array<{ username: string; lng: number; lat: number; guessed: boolean }>;
  places: Place[] | null;
  results: Array<{
    round: number;
    guesses: Array<{ username: string; lng: number | null; lat: number | null; distanceKm: number | null; score: number }>;
  }>;
  outcome: Outcome | null;
  chat: Array<{ id: number; username: string; text: string | null; emote: string | null; at: string; scope: 'all' | 'team' }>;
  movedToQueue: 'team' | null;
}

export interface QueueState {
  queued: boolean;
  kind: QueueKind | null;
  /** Players in this queue, the asker included. */
  waiting: number;
  /** Set once the player is in a match. */
  matchId: string | null;
  /** When the public game being gathered starts, while its countdown is running. ISO 8601. */
  startsAt: string | null;
  /** When the player joined this queue. */
  since: string | null;
  serverNow: string;
  /** Ranked: how far from the player's own rating an opponent may be right now. */
  window: number | null;
  /** How long players usually waited in this queue before a match was found, over the last day, in seconds. Null with no queue or no recent matches. */
  typicalWaitSeconds: number | null;
  /** Ranked: when a lock for leaving matches early ends, while one is running. */
  lockedUntil: string | null;
}

/** What a match action answers: the data, or a refusal with its HTTP status. */
export type Reply<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export const accept = <T>(data: T): Reply<T> => ({ ok: true, data });
export const refuse = (status: number, error: string): Reply<never> => ({ ok: false, status, error });
