import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountCookieName, createAccountSession } from '../account/session.js';
import { account } from '../routes/account.js';
import { TEST_SECRET, apiRequest } from '../testing.js';
import { createPostgresDb, type Db } from './client.js';
import { BEFORE_MULTIPLAYER, FIRST_WAVE } from './earlier-schemas.js';
import { migrate } from './schema.js';
import { insertUser } from './users.js';

// Two instances starting cold at the same moment both set the schema up. That
// needs a server with more than one session, so these run only against a real
// Postgres (TEST_DATABASE_URL), and each round is a race that either order of
// events must survive: hence the many rounds.
const url = process.env.TEST_DATABASE_URL;
const ROUNDS = Number(process.env.SETUP_RACE_ROUNDS ?? 6);
const INSTANCES = 8;
const NOW = 1_800_000_000_000;
const WHEN = '2026-10-01T12:00:00.000Z';
const ROUND_TIMEOUT_MS = 120_000;

interface Shape {
  columns: unknown[];
  indexes: unknown[];
  constraints: unknown[];
}

describe.skipIf(!url)('schema setup, when several instances start cold at once', () => {
  let admin: Db;
  let expected: Shape;
  const address = url ?? '';

  /** A new, empty schema with nothing in it, named from hex digits and never from input. */
  async function emptySchema(): Promise<string> {
    const schema = `t_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    return schema;
  }

  /** Every table's columns, indexes and constraints, with the schema's own name taken out so two schemas can be compared. */
  async function shapeOf(schema: string): Promise<Shape> {
    const plain = (rows: unknown[]): unknown[] => JSON.parse(JSON.stringify(rows).replaceAll(schema, 'SCHEMA')) as unknown[];
    return {
      columns: plain(
        await admin.query(
          `SELECT table_name, column_name, data_type, is_nullable, column_default
             FROM information_schema.columns WHERE table_schema = $1 AND table_name <> 'schema_version' ORDER BY 1, 2`,
          [schema],
        ),
      ),
      indexes: plain(await admin.query('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename <> $2 ORDER BY 1', [schema, 'schema_version'])),
      constraints: plain(
        await admin.query(
          `SELECT c.conrelid::regclass::text AS on_table, c.conname, pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c WHERE c.connamespace = $1::regnamespace AND c.conrelid::regclass::text NOT LIKE '%schema_version' ORDER BY 1, 2`,
          [schema],
        ),
      ),
    };
  }

  /** What one instance does with its first request: sets the schema up, then serves a signed-in player their account. */
  async function firstRequest(db: Db): Promise<number> {
    await migrate(db);
    const id = randomUUID();
    await insertUser(db, { id, username: `u${id.slice(0, 8)}${id.slice(9, 13)}`, passwordHash: 'not-a-real-hash', createdAt: NOW });
    const cookie = `${accountCookieName(true)}=${createAccountSession(id, NOW, TEST_SECRET)}`;
    const response = await account(apiRequest('GET', '/api/account', { cookie }), { db, now: NOW, secret: TEST_SECRET });
    const body = await response.json();
    return body.data.account?.rating === 500 && body.data.account.level === 1 ? response.status : 500;
  }

  /** Starts `INSTANCES` instances at once on one schema, each with its own pool, and reports how each first request went. */
  async function coldStartsOn(schema: string): Promise<Array<string | number>> {
    const instances = await Promise.all(Array.from({ length: INSTANCES }, () => createPostgresDb(address, schema)));
    try {
      const settled = await Promise.allSettled(instances.map(firstRequest));
      return settled.map((result) => (result.status === 'fulfilled' ? result.value : String(result.reason)));
    } finally {
      await Promise.all(instances.map((instance) => instance.close?.()));
    }
  }

  beforeAll(async () => {
    admin = await createPostgresDb(address);
    // What one instance alone makes of an empty database is what every race must end in.
    const schema = await emptySchema();
    const alone = await createPostgresDb(address, schema);
    await migrate(alone);
    await alone.close?.();
    expected = await shapeOf(schema);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  });

  afterAll(async () => {
    await admin.close?.();
  });

  it(
    'sets up an empty database once, with no request failing, however many instances try',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const schema = await emptySchema();
        expect(await coldStartsOn(schema)).toEqual(Array.from({ length: INSTANCES }, () => 200));
        expect(await shapeOf(schema)).toEqual(expected);
        expect(await admin.query(`SELECT count(*)::int AS made FROM ${schema}.users`)).toEqual([{ made: INSTANCES }]);
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    },
    ROUND_TIMEOUT_MS,
  );

  it(
    'upgrades the database the first wave left, with its rows, once, with no request failing',
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const schema = await emptySchema();
        const before = await createPostgresDb(address, schema);
        for (const statement of [...BEFORE_MULTIPLAYER, ...FIRST_WAVE]) {
          await before.query(statement);
        }
        const [player, match] = [randomUUID(), randomUUID()];
        await before.query(`INSERT INTO users (id, username, password_hash, created_at, rating, rated_games) VALUES ($1, 'neel', 'hash', $2, 1016, 1)`, [player, WHEN]);
        await before.query(
          `INSERT INTO matches (id, kind, phase, map, mode, time_limit, rounds, seed, resolver_id, created_at)
           VALUES ($1, 'party', 'lobby', 'world', 'move', 60, 5, 'seed', $2, $3)`,
          [match, player, WHEN],
        );
        await before.query('INSERT INTO match_players (match_id, user_id, seat, last_seen_at) VALUES ($1, $2, 0, $3)', [match, player, WHEN]);
        await before.close?.();

        expect(await coldStartsOn(schema)).toEqual(Array.from({ length: INSTANCES }, () => 200));
        expect(await shapeOf(schema)).toEqual(expected);
        expect(await admin.query(`SELECT username, rating, rated_games, xp, best_streak FROM ${schema}.users WHERE id = $1`, [player])).toEqual([
          { username: 'neel', rating: 1016, rated_games: 1, xp: 0, best_streak: 0 },
        ]);
        expect(await admin.query(`SELECT phase, chat FROM ${schema}.matches`)).toEqual([{ phase: 'lobby', chat: [] }]);
        expect(await admin.query(`SELECT open FROM ${schema}.match_players`)).toEqual([{ open: true }]);
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    },
    ROUND_TIMEOUT_MS,
  );

  it(
    'serves instances that start on a database already set up, and leaves it as it was',
    async () => {
      const schema = await emptySchema();
      expect(await coldStartsOn(schema)).toEqual(Array.from({ length: INSTANCES }, () => 200));
      const shape = await shapeOf(schema);
      for (let round = 0; round < ROUNDS; round += 1) {
        expect(await coldStartsOn(schema)).toEqual(Array.from({ length: INSTANCES }, () => 200));
      }
      expect(await shapeOf(schema)).toEqual(shape);
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    },
    ROUND_TIMEOUT_MS,
  );
});
