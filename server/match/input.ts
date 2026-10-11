import { z } from 'zod';
import { savedGameSchema } from '../account/input.js';
import { EMOTES, MAX_CHAT_LENGTH, onOneLine } from './chat.js';

export const QUEUE_KINDS = ['unranked', 'ranked', 'team'] as const;
// prettier-ignore
export const MATCH_ACTIONS = [
  'create', 'configure', 'join', 'start', 'places', 'guess', 'pin', 'leave', 'queue', 'leaveQueue',
  'chat', 'emote', 'mute', 'team', 'shuffle', 'kick', 'host', 'lock', 'endRound', 'lobby',
] as const;

const MAX_PLACE_ID_LENGTH = 200;
export const MAX_ROUNDS = 20;
const MAX_NAME_LENGTH = 40;

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const matchId = z.uuid();
/** No timer, or 10 to 300 seconds in steps of 10. */
const timeLimit = z
  .number()
  .int()
  .refine((seconds) => seconds === 0 || (seconds >= 10 && seconds <= 300 && seconds % 10 === 0));
/** A player in the match, by the name the match shows: an account's username or a guest's "Guest #1234". */
const playerName = z.string().min(1).max(MAX_NAME_LENGTH);

export const settingsSchema = z.object({
  map: savedGameSchema.shape.map,
  mode: savedGameSchema.shape.mode,
  /** Seconds per round, or 0 for a round that ends when everyone has guessed or the host ends it. */
  timeLimit,
  rounds: z.number().int().min(1).max(MAX_ROUNDS),
  /** What players may say to each other. */
  communication: z.enum(['chat', 'reactions', 'off']).default('chat'),
  /** Two teams, scored by their best guess or by the average of their guesses; or everyone for themselves. */
  teams: z.enum(['none', 'best', 'average']).default('none'),
  /** Whether players with no account may join. */
  guests: z.boolean().default(true),
});

/** The same shape as a dataset location. */
const placeSchema = z.object({
  id: z.string().min(1).max(MAX_PLACE_ID_LENGTH),
  lng,
  lat,
  country: z.string().regex(/^[A-Z]{2}$/),
});

// Codes are shown in capitals; typing one in lowercase, or with a space after it, still works.
export const partyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9]{6}$/));

const on = <A extends string, S extends z.ZodRawShape>(action: A, shape: S) => z.object({ action: z.literal(action), ...shape });

/** Every body `POST /api/match` accepts. */
export const matchActionSchema = z.discriminatedUnion('action', [
  on('create', { settings: settingsSchema }),
  on('configure', { matchId, settings: settingsSchema }),
  on('join', { code: partyCodeSchema }),
  on('start', { matchId }),
  // The scale the places are scored on is the server's own: one a browser sends is not read.
  on('places', { matchId, places: z.array(placeSchema).min(1).max(MAX_ROUNDS) }),
  on('guess', { matchId, round: z.number().int().min(0).max(MAX_ROUNDS - 1), lng, lat }),
  on('pin', { matchId, round: z.number().int().min(0).max(MAX_ROUNDS - 1), lng, lat }),
  on('leave', { matchId }),
  // `matchId` names the two-player lobby whose players queue for 2v2 together.
  on('queue', { kind: z.enum(QUEUE_KINDS), matchId: matchId.optional() }),
  on('leaveQueue', {}),
  on('chat', { matchId, text: z.string().transform(onOneLine).pipe(z.string().min(1).max(MAX_CHAT_LENGTH)), scope: z.enum(['all', 'team']).default('all') }),
  on('emote', { matchId, emote: z.enum(EMOTES) }),
  on('mute', { matchId, username: playerName, muted: z.boolean() }),
  on('team', { matchId, team: z.literal([0, 1]) }),
  on('shuffle', { matchId }),
  on('kick', { matchId, username: playerName }),
  on('host', { matchId, username: playerName }),
  on('lock', { matchId, locked: z.boolean() }),
  on('endRound', { matchId }),
  on('lobby', { matchId }),
]);

/** Enough of a body to tell which action was meant, so a malformed one gets a message about that action. */
export const actionNameSchema = z.looseObject({ action: z.enum(MATCH_ACTIONS) });

export const matchIdSchema = matchId;

export type MatchAction = z.infer<typeof matchActionSchema>;
export type MatchActionName = (typeof MATCH_ACTIONS)[number];
export type Settings = z.infer<typeof settingsSchema>;
export type Place = z.infer<typeof placeSchema>;
export type QueueKind = (typeof QUEUE_KINDS)[number];
