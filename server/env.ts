import { z } from 'zod';

const SESSION_SECRET_BYTES = 32;

/** About 4,650 a month, inside the 5,000 Google gives free. */
export const DEFAULT_GOOGLE_VIEWERS_PER_DAY = 150;

/** A setting left empty counts as one left out. */
const optional = <S extends z.ZodType>(schema: S) => z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const schema = z.object({
  DATABASE_URL: z.string('is not set').min(1, 'is empty'),
  SESSION_SECRET: z
    .string('is not set')
    .refine((value) => Buffer.from(value, 'base64').length === SESSION_SECRET_BYTES, 'must be 32 random bytes, base64 encoded'),
  /** The usernames of the accounts that may moderate, separated by commas. Left out, nobody may. */
  MODERATORS: optional(z.string()).transform((value) =>
    (value ?? '')
      .split(',')
      .map((username) => username.trim().toLowerCase())
      .filter((username) => username !== ''),
  ),
  /** How many Google Street View viewers the site hands out in a UTC day before it falls back to open imagery. */
  GOOGLE_VIEWERS_PER_DAY: optional(z.string().regex(/^\d{1,9}$/, 'must be a whole number, 0 or more')).transform((value) =>
    value === undefined ? DEFAULT_GOOGLE_VIEWERS_PER_DAY : Number(value),
  ),
});

export type Env = z.infer<typeof schema>;

/** The settings the server needs. Throws, naming each problem but repeating no value, when one is missing or malformed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment. ${problems.join('; ')}`);
}
