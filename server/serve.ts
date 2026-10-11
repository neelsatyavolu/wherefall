import { getDb, type Db } from './db/client.js';
import { parseEnv } from './env.js';
import { fail } from './http.js';

/** What a route works with, handed in so tests can supply their own database, clock and key. */
export interface Context {
  db: Db;
  /** Epoch milliseconds. */
  now: number;
  /** Signs sessions and keys the hashes of network addresses. */
  secret: Buffer;
  /** The usernames, in lower case, of the accounts that may moderate. Left out, nobody may. */
  moderators?: readonly string[];
  /** How many Google viewers may be handed out in a UTC day. Left out, the default is used. */
  viewersPerDay?: number;
}

export type Route = (request: Request, context: Context) => Promise<Response>;

/**
 * Runs a route against the real database, clock and settings. The settings
 * are checked on every call, so a missing one is named in the log on the
 * first request. Whatever goes wrong, the visitor gets a plain 500 and the
 * detail stays in the server log.
 */
export async function serve(request: Request, route: Route): Promise<Response> {
  try {
    const env = parseEnv(process.env);
    const db = await getDb(env.DATABASE_URL);
    return await route(request, {
      db,
      now: Date.now(),
      secret: Buffer.from(env.SESSION_SECRET, 'base64'),
      moderators: env.MODERATORS,
      viewersPerDay: env.GOOGLE_VIEWERS_PER_DAY,
    });
  } catch (error) {
    console.error('[plonk] request failed:', error);
    return fail('Something went wrong on our side. Try again in a moment.', 500);
  }
}
