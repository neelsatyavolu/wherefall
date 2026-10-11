import { z } from 'zod';
import { call, countrySchema, post, type Result } from '../account/client.ts';
import type { LngLat } from '../game/geo.ts';
import { mapIdSchema } from '../game/locations.ts';
import { MODES } from '../game/settings.ts';

/**
 * `/api/match`: the shapes the server answers with, the reads that are polled, and what every
 * player in a match can send. What only a party and its host can send is in `party.ts`.
 */

export const MATCH_KINDS = ['party', 'unranked', 'ranked', 'team'] as const;
export const QUEUE_KINDS = ['unranked', 'ranked', 'team'] as const;
/** What a party's players may say to each other: anything, the reactions only, or nothing. */
export const COMMUNICATIONS = ['chat', 'reactions', 'off'] as const;
/** A party's team mode: no teams, or two teams scored by their best guess or by their average. */
export const TEAM_MODES = ['none', 'best', 'average'] as const;
export const CHAT_SCOPES = ['all', 'team'] as const;
/** What a host may choose: a time of 0 is no timer, any other is `minTime` to `maxTime` in steps of `timeStep`. */
export const PARTY_LIMITS = { minPlayers: 2, maxPlayers: 40, minRounds: 1, maxRounds: 20, minTime: 10, maxTime: 300, timeStep: 10 } as const;
/** The times and round counts the party form offers. Each is one the server accepts. */
export const MATCH_TIME_LIMITS = [30, 60, 120] as const;
export const MATCH_ROUND_COUNTS = [3, 5, 10] as const;
/** The twenty reactions a player can send in a match. */
export const EMOTES = ['gg', 'gl', 'hi', 'bye', 'nice', 'wow', 'oof', 'close', 'hm', 'lol', 'ty', 'sorry', 'rip', 'yes', 'no', 'think', 'clap', 'fire', 'sad', 'heart'] as const;
export const MAX_CHAT_LENGTH = 200;
/** A pin's position is sent to teammates at most this often. */
export const PIN_INTERVAL_MS = 1000;

/** What the server answers about a match that does not exist and about one the asker is not in: the same words for both, polls included. */
export const NO_SUCH_MATCH = 'That match does not exist, or you are not in it.';

/**
 * What the server says of posted places it will not take: one is not on the match's map (or is
 * there twice, or not where its list has it), a public world game's are on fewer than three
 * continents, or there is not one for each round.
 */
export const PLACES_REFUSALS = {
  notOnMap: "Those places are not on this match's map.",
  tooFewContinents: 'A world game needs places on at least three continents.',
} as const;
const WRONG_PLACE_COUNT = /^This match needs exactly \d+ places\.$/;

/** True when a failed `places` post was refused for the places themselves: another set may be taken, the same one never will be. */
export const placesRefused = (error: string): boolean =>
  error === PLACES_REFUSALS.notOnMap || error === PLACES_REFUSALS.tooFewContinents || WRONG_PLACE_COUNT.test(error);

const MATCH = '/api/match';

const teamSchema = z.union([z.literal(0), z.literal(1)]);
const seatSchema = teamSchema.nullable();

/** The same shape as a dataset location. */
const placeSchema = z.object({ id: z.string(), lng: z.number(), lat: z.number(), country: z.string() });

const settingsSchema = z.object({
  map: mapIdSchema,
  mode: z.enum(MODES),
  /** seconds a round; 0 is no timer (parties only) */
  timeLimit: z.number().int().min(0).max(PARTY_LIMITS.maxTime),
  rounds: z.number().int().min(PARTY_LIMITS.minRounds).max(PARTY_LIMITS.maxRounds),
  communication: z.enum(COMMUNICATIONS),
  /** a party's team mode; 2v2 is always `best` */
  teams: z.enum(TEAM_MODES),
  /** a party: whether a visitor without an account may join it. Always true in a queue's game */
  guests: z.boolean(),
});

const matchStateSchema = z.object({
  id: z.string(),
  /** parties only */
  code: z.string().nullable(),
  kind: z.enum(MATCH_KINDS),
  phase: z.enum(['lobby', 'preparing', 'playing', 'reveal', 'finished']),
  settings: settingsSchema,
  /** parties: closed to new players */
  locked: z.boolean(),
  seed: z.string(),
  /** ISO; compare with the local clock */
  serverNow: z.string(),
  /** 0-based; the round being played or revealed */
  round: z.number(),
  roundStartsAt: z.string().nullable(),
  /** null when the round has no timer. The server may move it earlier while the round is played */
  roundEndsAt: z.string().nullable(),
  revealEndsAt: z.string().nullable(),
  you: z.object({
    username: z.string(),
    isHost: z.boolean(),
    isResolver: z.boolean(),
    team: seatSchema,
    guest: z.boolean(),
    /** usernames whose lines and reactions the server leaves out of this player's chat */
    muted: z.array(z.string()),
  }),
  players: z.array(
    z.object({
      username: z.string(),
      country: countrySchema,
      guest: z.boolean(),
      team: seatSchema,
      total: z.number(),
      guessed: z.boolean(),
      active: z.boolean(),
      /** ranked only */
      rating: z.number().nullable(),
      /** ranked only: starts at 5000, and the match ends when one player's reaches 0 */
      health: z.number().nullable(),
    }),
  ),
  /** 2v2 and party team modes, else null. `health` is for 2v2. Both count revealed rounds only */
  teams: z.array(z.object({ team: teamSchema, health: z.number().nullable(), total: z.number() })).nullable(),
  /** while a round is played: teammates' pins as last sent, or their guess once made. Empty otherwise */
  mates: z.array(z.object({ username: z.string(), lng: z.number(), lat: z.number(), guessed: z.boolean() })),
  /** null until posted */
  places: z.array(placeSchema).nullable(),
  /** finished rounds only; the current round appears when it is revealed */
  results: z.array(
    z.object({
      round: z.number(),
      guesses: z.array(
        z.object({
          username: z.string(),
          lng: z.number().nullable(),
          lat: z.number().nullable(),
          distanceKm: z.number().nullable(),
          score: z.number(),
        }),
      ),
    }),
  ),
  outcome: z
    .object({
      /** usernames; empty for a draw or a cancelled match */
      winners: z.array(z.string()),
      /** ranked only */
      ratingChanges: z.array(z.object({ username: z.string(), before: z.number(), after: z.number() })),
      /** ranked: who left before the first guess, which cancels the match */
      dodgedBy: z.string().nullable(),
    })
    .nullable(),
  /** the last 30 messages and reactions this player may see */
  chat: z.array(
    z.object({
      id: z.number(),
      username: z.string(),
      /** null for a reaction */
      text: z.string().nullable(),
      /** null for a message */
      emote: z.string().nullable(),
      /** ISO 8601 */
      at: z.string(),
      /** `team`: only the sender's team was sent it */
      scope: z.enum(CHAT_SCOPES),
    }),
  ),
  /** `team`: this party's lobby closed because its host queued the pair for 2v2; poll the queue instead */
  movedToQueue: z.literal('team').nullable(),
});

const queueStateSchema = z.object({
  queued: z.boolean(),
  kind: z.enum(QUEUE_KINDS).nullable(),
  /** players in this queue, you included */
  waiting: z.number(),
  /** set once the player has been matched */
  matchId: z.string().nullable(),
  /** when the public game being gathered starts, while its countdown is running; ISO 8601 */
  startsAt: z.string().nullable(),
  /** when the player joined this queue; the time waited is `serverNow` less this */
  since: z.string().nullable(),
  serverNow: z.string(),
  /** ranked: how far from the player's rating an opponent may be right now, either way */
  window: z.number().nullable(),
  /** ranked: when a lock for leaving matches before they began ends, while one is running */
  lockedUntil: z.string().nullable(),
  /**
   * The median time, in whole seconds, players waited in this queue before a match was found, over
   * the last 24 hours. Null with no queue named, and when none was found in that time.
   */
  typicalWaitSeconds: z.number().nullable(),
});

const leftSchema = z.object({ left: z.literal(true) });
const notQueuedSchema = z.object({ queued: z.literal(false) });

export type MatchKind = (typeof MATCH_KINDS)[number];
export type QueueKind = (typeof QUEUE_KINDS)[number];
export type Communication = (typeof COMMUNICATIONS)[number];
export type TeamMode = (typeof TEAM_MODES)[number];
export type ChatScope = (typeof CHAT_SCOPES)[number];
export type Team = z.infer<typeof teamSchema>;
export type Place = z.infer<typeof placeSchema>;
export type MatchSettings = z.infer<typeof settingsSchema>;
/** What a host sends to open or change a party: left out, chat is on, teams are off and guests may join. */
export type PartySettings = Omit<MatchSettings, 'communication' | 'teams' | 'guests'> & Partial<Pick<MatchSettings, 'communication' | 'teams' | 'guests'>>;
export type MatchState = z.infer<typeof matchStateSchema>;
export type MatchPhase = MatchState['phase'];
export type MatchPlayer = MatchState['players'][number];
export type TeamState = NonNullable<MatchState['teams']>[number];
export type Mate = MatchState['mates'][number];
export type MatchOutcome = NonNullable<MatchState['outcome']>;
export type QueueState = z.infer<typeof queueStateSchema>;
export type Emote = (typeof EMOTES)[number];
export type ChatEntry = MatchState['chat'][number];

export type Reply<T> = Promise<Result<T>>;

/**
 * Sends one action and reads the match back. An action sent in a phase it does not apply to is
 * answered with the match as it is, unchanged, and so is a second guess for one round.
 */
export const matchAction = (fetchFn: typeof fetch, body: { action: string } & Record<string, unknown>): Reply<MatchState> =>
  call(fetchFn, MATCH, matchStateSchema, post(body));

const queueAction = (fetchFn: typeof fetch, body: { action: 'queue' } & Record<string, unknown>): Reply<QueueState> =>
  call(fetchFn, MATCH, queueStateSchema, post(body));

/** Opens a party. The caller becomes its host and is in its lobby. Accounts only. */
export function createParty(settings: PartySettings, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'create', settings });
}

/** Joins a party by its code: in its lobby, or under way, to play from the next round to start. */
export function joinParty(code: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'join', code });
}

/** Host only, and only with at least two players; with teams, each team needs one. */
export function startMatch(matchId: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'start', matchId });
}

/**
 * Resolver only, guest or not: the places everyone will play, one per round, each where its list
 * has it. The server knows every place and works out the scoring scale from the map. A set it does
 * not take (`placesRefused`) changes nothing, and another may be posted until the 45 seconds run out.
 */
export function postPlaces(matchId: string, places: readonly Place[], fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'places', matchId, places });
}

/** One guess per player per round; the server ignores later ones. */
export function sendGuess(matchId: string, round: number, guess: LngLat, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'guess', matchId, round, lng: guess.lng, lat: guess.lat });
}

/** Where the player's pin is now, for teammates to see. At most one a second. */
export function sendPin(matchId: string, round: number, pin: LngLat, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'pin', matchId, round, lng: pin.lng, lat: pin.lat });
}

/**
 * A chat message: 1 to 200 characters. Only in a party whose host allows chat and in 2v2, and not
 * for a guest. `team` sends it to the player's own team alone, where the match has teams.
 */
export function sendChat(matchId: string, text: string, scope: ChatScope = 'all', fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'chat', matchId, text, scope });
}

/** One of the twenty reactions. Refused only in a party whose host has turned them off. */
export function sendEmote(matchId: string, emote: Emote, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'emote', matchId, emote });
}

/** Leaves a player's lines and reactions out of this player's chat for the rest of the match, or lets them back in. */
export function mutePlayer(matchId: string, username: string, muted: boolean, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'mute', matchId, username, muted });
}

export function leaveMatch(matchId: string, fetchFn: typeof fetch = fetch): Reply<{ left: true }> {
  return call(fetchFn, MATCH, leftSchema, post({ action: 'leave', matchId }));
}

/** Joins a queue alone. A player locked out of ranked is told for how long. */
export function joinQueue(kind: QueueKind, fetchFn: typeof fetch = fetch): Reply<QueueState> {
  return queueAction(fetchFn, { action: 'queue', kind });
}

/**
 * Host of a party lobby of exactly two accounts: queues both for 2v2 as teammates. The lobby
 * closes, and the other player learns of it from `movedToQueue` on their next poll.
 */
export function queueAsPair(matchId: string, fetchFn: typeof fetch = fetch): Reply<QueueState> {
  return queueAction(fetchFn, { action: 'queue', kind: 'team', matchId });
}

export function leaveQueue(fetchFn: typeof fetch = fetch): Reply<{ queued: false }> {
  return call(fetchFn, MATCH, notQueuedSchema, post({ action: 'leaveQueue' }));
}

/**
 * The match as this player sees it. Each call also tells the server the player is still there, in
 * a finished match too: that is what keeps a player in a party whose host sends it back to its lobby.
 */
export function getMatch(id: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return call(fetchFn, `${MATCH}?id=${encodeURIComponent(id)}`, matchStateSchema);
}

/**
 * Where the player is in the queue. Each call also keeps the queue entry alive. For a player who
 * is not queued, `matchId` is the unfinished match they are in, if any: that is how a reload finds it.
 */
export function getQueue(fetchFn: typeof fetch = fetch): Reply<QueueState> {
  return call(fetchFn, `${MATCH}?queue=1`, queueStateSchema);
}
