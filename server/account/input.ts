import { z } from 'zod';
import { maskWords } from '../match/chat.js';
import { CONTINENTS } from '../places/continents.js';
import { RECOVERY_ALPHABET, RECOVERY_CODE_LENGTH, normaliseRecoveryCode } from './recovery.js';

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export const MAX_ROUND_SCORE = 5000;
const MAX_ROUNDS = 10;
const MAX_TIME_LIMIT_SECONDS = 600;

// Stored lowercase, so "Neel" and "neel" are one account.
const username = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(new RegExp(`^[a-z0-9_]{${MIN_USERNAME_LENGTH},${MAX_USERNAME_LENGTH}}$`)));

// In a name an underscore stands where a space would, so the mask reads it as one:
// on its own it takes "_" for a letter and would let "holy_shit" through.
const isClean = (name: string): boolean => {
  const spaced = name.replaceAll('_', ' ');
  return maskWords(spaced) === spaced;
};

/**
 * A name that may be given to an account, new or renamed: also no underscore
 * at either end, no two together, and none of the masked words.
 */
export const newUsernameSchema = username.pipe(
  z
    .string()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
    .refine(isClean),
);

/** A password being chosen. */
export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);
/** A password being checked against the one stored: anything that could have been one. */
export const givenPasswordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** A country by its two-letter code, as flags are looked up. */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/);

export const registerSchema = z.object({
  username: newUsernameSchema,
  password: newPasswordSchema,
  // The browser's guess from its locale, not something the player typed: one that is no code is dropped, not refused.
  country: countrySchema.nullable().optional().catch(null),
});

export const loginSchema = z.object({
  username,
  password: givenPasswordSchema,
  /** Asks for a deleted account to be brought back. */
  restore: z.boolean().optional(),
});

/** More than a code is ever typed as, with its hyphens and a few stray spaces. */
const MAX_TYPED_RECOVERY_CODE = 64;

/** A recovery code as it is typed back, read as it is compared: capitals, spaces and hyphens do not matter. One that could not be a code is nobody's. */
export const recoveryCodeSchema = z
  .string()
  .max(MAX_TYPED_RECOVERY_CODE)
  .transform(normaliseRecoveryCode)
  .pipe(z.string().regex(new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`)));

/** Who is asking to be let back in, and with which code. The new password is looked at apart, so what is wrong with it can be said. */
export const recoveryClaimSchema = z.looseObject({
  username,
  recoveryCode: recoveryCodeSchema,
  /** Asks for a deleted account to be brought back. */
  restore: z.boolean().optional(),
});

/** A name an account may already have: the rule every name ever made meets, so older ones can still be signed in to and looked up. */
export const usernameSchema = username;

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

/** No place has a longer id: not in the two lists, and not on a map a player made. */
const MAX_PLACE_ID_LENGTH = 64;
const placeId = z.string().min(1).max(MAX_PLACE_ID_LENGTH);

/**
 * One round of a game, as the browser reports it: which place it was, and
 * where the guess went. The country, the distance and the score a browser
 * may still send are not read: the server has the place in its own lists and
 * works all three out; see games/check.ts.
 */
export const roundSchema = z
  .object({
    id: placeId,
    /** Where the browser was told the place is. It has to be where the place's list has it. */
    lng,
    lat,
    /** Where the player guessed. Both null, or both left out, when they did not. */
    guessLng: lng.nullable().optional(),
    guessLat: lat.nullable().optional(),
    /** True when the round was played with a hint, which halves its score. */
    hinted: z.boolean().optional(),
  })
  // Half a guess is a mistake, not a round with no guess.
  .refine((round) => typeof round.guessLng === typeof round.guessLat);

const COMMUNITY_PREFIX = 'community:';
const MAX_SLUG_LENGTH = 48;

/** What a community map is known by: small letters and numbers in groups joined by single hyphens. */
export const slugSchema = z
  .string()
  .max(MAX_SLUG_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** The slug of the community map a map id names, or null when the id names an official map. */
export const communitySlugOf = (mapId: string): string | null => (mapId.startsWith(COMMUNITY_PREFIX) ? mapId.slice(COMMUNITY_PREFIX.length) : null);

/** The world, a region of it, one country or territory by its two-letter code, or a map a player made. */
export const mapIdSchema = z.union([
  z.enum(['world', 'europe', 'americas', 'asia-oceania', 'africa']),
  z.string().regex(/^country:[A-Z]{2}$/),
  z.string().refine((id) => slugSchema.safeParse(communitySlugOf(id)).success),
]);

const seed = z.string().regex(/^[a-z0-9]{1,32}$/);

export const MAX_STREAK = 500;
/** Country Guesser and Continent Guesser are both ten questions long. */
export const GUESSER_ROUNDS = 10;

export const RUN_KINDS = ['streak', 'country', 'continent'] as const;

/** Asks for a run of a country streak, Country Guesser or Continent Guesser to be begun. */
export const runStartSchema = z.object({ action: z.literal('start'), kind: z.enum(RUN_KINDS) });

/** What a run's start answered with, sent back when the run is finished. */
const runToken = z.string().min(1).max(300);

/** One round of a run: the place shown and what the player chose, null when they chose nothing. */
const answered = <A extends z.ZodType>(answer: A) => z.object({ id: placeId, answer: answer.nullable() });
const countryAnswer = answered(countrySchema);

/**
 * One finished country-streak run: every round played, the losing one last.
 * The server counts the streak itself.
 */
export const streakRunSchema = z.object({
  kind: z.literal('streak'),
  run: runToken,
  // A streak ends at its limit, or on the round after the last country got right.
  rounds: z.array(countryAnswer).min(1).max(MAX_STREAK + 1),
  /** True for the streak counted behind ordinary world games, which earns no XP of its own. */
  inPlay: z.boolean().optional(),
});

/** One finished run of Country Guesser. The server counts the right answers itself. */
export const countryRunSchema = z.object({
  kind: z.literal('country'),
  run: runToken,
  rounds: z.array(countryAnswer).min(1).max(GUESSER_ROUNDS),
});

/** One finished run of Continent Guesser. The server counts the right answers itself. */
export const continentRunSchema = z.object({
  kind: z.literal('continent'),
  run: runToken,
  rounds: z.array(answered(z.enum(CONTINENTS))).min(1).max(GUESSER_ROUNDS),
});

/** A finished run of any kind. */
export const runFinishSchema = z.discriminatedUnion('kind', [streakRunSchema, countryRunSchema, continentRunSchema]);

/**
 * One finished game, as the browser reports it. Totals are not accepted: the
 * server adds the rounds up itself. Nor is a scale: a map's scores fall off
 * on the scale the server works out for it, and a `scaleKm` sent is not read.
 */
export const savedGameSchema = z.object({
  map: mapIdSchema,
  mode: z.enum(['move', 'no-move', 'nmpz']),
  /** Seconds per round, 0 for no limit. */
  timeLimit: z.number().int().min(0).max(MAX_TIME_LIMIT_SECONDS),
  seed,
  rounds: z.array(roundSchema).min(1).max(MAX_ROUNDS),
  /** The UTC day (YYYY-MM-DD) this game was the daily challenge of. Left out for every other game. */
  daily: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SavedGame = z.infer<typeof savedGameSchema>;
export type RunStart = z.infer<typeof runStartSchema>;
export type RunFinish = z.infer<typeof runFinishSchema>;
