import { z } from 'zod';

const SESSION_SECRET_BYTES = 32;

/** About 4,650 a month, inside the 5,000 Google gives free. */
export const DEFAULT_GOOGLE_VIEWERS_PER_DAY = 150;

/** Where `vercel dev` serves the site on a developer's own machine: what reset links point at when nothing else is said. */
export const LOCAL_APP_URL = 'http://localhost:3000';

const emptyAsLeftOut = (value: unknown): unknown => (value === '' ? undefined : value);

/** A setting left empty counts as one left out. */
const optional = <S extends z.ZodType>(schema: S) => z.preprocess(emptyAsLeftOut, schema.optional());

/** A setting that has to be there, and is not when it is left empty. */
const required = <S extends z.ZodType>(schema: S) => z.preprocess(emptyAsLeftOut, schema);

/** The origin a value names when it is a web address with nothing after the host, else null. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
    return bare && (url.protocol === 'https:' || url.protocol === 'http:') ? url.origin : null;
  } catch {
    return null;
  }
}

const appUrl = z
  .string('is not set')
  .refine((value) => originOf(value) !== null, 'must be the origin of the site, as https://wherefall.n3el.dev')
  .transform((value) => originOf(value) ?? value);

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
  /** The Resend API key password-reset emails are sent with. Left out, none is sent and the link is written to the log. */
  RESEND_API_KEY: optional(z.string()),
  /** The public origin of the site, which reset links are built on: never taken from a request. */
  APP_URL: optional(appUrl).transform((value) => value ?? LOCAL_APP_URL),
});

/** On the live site email has to work: both of its settings must be there. */
const productionSchema = schema.extend({
  RESEND_API_KEY: required(z.string('is not set')),
  APP_URL: required(appUrl),
});

/** True on the live site. Vercel names the environment a deployment is in; anywhere else NODE_ENV does. */
const isProduction = (source: Record<string, string | undefined>): boolean => (source.VERCEL_ENV || source.NODE_ENV) === 'production';

export type Env = z.infer<typeof schema>;

/** The settings the server needs. Throws, naming each problem but repeating no value, when one is missing or malformed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = (isProduction(source) ? productionSchema : schema).safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment. ${problems.join('; ')}`);
}
