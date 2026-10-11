import { randomUUID } from 'node:crypto';
import { createPgliteDb, createPostgresDb, type Db } from './db/client.js';
import { migrate } from './db/schema.js';
import { roundOn } from './games/testing.js';
import { placesOf, type KnownPlace } from './places/lists.js';

/**
 * A fresh, migrated database for one test file. In-process by default; set
 * TEST_DATABASE_URL to run the same tests against a real Postgres server,
 * where each file gets its own schema.
 */
export async function testDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  const db = url ? await isolatedSchema(url) : await createPgliteDb();
  await migrate(db);
  return db;
}

async function isolatedSchema(url: string): Promise<Db> {
  // The name is generated here from hex digits, never from input.
  const schema = `t_${randomUUID().replaceAll('-', '')}`;
  await (await createPostgresDb(url)).query(`CREATE SCHEMA ${schema}`);
  return createPostgresDb(url, schema);
}

const TABLES = [
  ...['password_resets', 'queue_waits', 'daily_attempts', 'online_games', 'viewer_days', 'player_reports'],
  ...['queue_gathering', 'progress_days', 'map_reports', 'map_likes', 'community_maps', 'party_invites', 'friendships', 'streak_runs'],
  ...['match_guesses', 'match_players', 'match_queue', 'matches', 'game_rounds', 'games', 'rate_limits', 'users'],
];

export async function resetDb(db: Db): Promise<void> {
  await db.query(`TRUNCATE ${TABLES.join(', ')}`);
}

/**
 * The same database, but pausing after any query inside a transaction that
 * matches `pattern`. Holding a transaction open between its read and its
 * write is what makes a missing lock show up as a failed test on a real
 * server, where two fast transactions would otherwise rarely overlap.
 */
export function pausingAfter(db: Db, pattern: RegExp, ms = 40): Db {
  return {
    query: db.query,
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async <T>(sql: string, params?: unknown[]) => {
            const rows = await tx.query<T>(sql, params);
            if (pattern.test(sql)) {
              await new Promise((resolve) => setTimeout(resolve, ms));
            }
            return rows;
          },
        }),
      ),
  };
}

export const TEST_SECRET = Buffer.alloc(32, 7);
export const TEST_ORIGIN = 'https://plonk.example';

interface RequestOptions {
  body?: unknown;
  cookie?: string;
  /** The network address the request appears to come from. */
  ip?: string;
  headers?: Record<string, string>;
}

/** A request as the site's own pages send it: same origin, JSON body. */
export function apiRequest(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Request {
  const headers = {
    host: new URL(TEST_ORIGIN).host,
    ...(method === 'POST' ? { origin: TEST_ORIGIN } : {}),
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.ip ? { 'x-forwarded-for': options.ip } : {}),
    ...options.headers,
  };
  return new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/** The `name=value` pair a response set, ready to send back as a Cookie header. */
export function cookieFrom(response: Response): string {
  const [first = ''] = response.headers.getSetCookie();
  return first.split(';')[0] ?? '';
}

// How many places the rounds below go through before coming back to the first: more than any game has rounds.
const PLACES_IN_TURN = 60;
let turn = 0;

/** A place of the world map, a different one each time for as many times as any one game has rounds. */
function nextPlace(): KnownPlace {
  const place = placesOf(0)[turn % PLACES_IN_TURN];
  turn += 1;
  if (!place) {
    throw new Error('The place lists are empty');
  }
  return place;
}

/**
 * A round as the browser sends it, which the server will score at exactly
 * `score` on the world map: on a real place of the lists, named by its id
 * and put where its list has it, with the guess as far from it as that score
 * takes. Each call is on another place, since a game cannot have a place
 * twice. A score of 0 is a round with no guess. Scores of 4998 and 4999 do
 * not exist: the game gives those as 5000.
 */
export function scoredRound(score: number, change: Record<string, unknown> = {}): Record<string, unknown> {
  return roundOn(nextPlace(), score, undefined, change);
}
