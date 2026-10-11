import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './schema.js';

export type Row = Record<string, unknown>;
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` while holding the lock `key` across every session of the
   * database: a second caller with the same key, in this process or any
   * other, waits until the first has finished. `fn` uses the database as
   * usual. Absent on a database that only ever has one session, where there
   * is nobody to keep out.
   */
  exclusively?<T>(key: number, fn: () => Promise<T>): Promise<T>;
  /** Closes the connections. Absent where there are none to close. */
  close?(): Promise<void>;
}

const PGLITE_SCHEME = 'pglite://';

/** Postgres in-process. Used by tests and by local development. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  // PGlite creates the data folder itself, but not the folders above it.
  if (dataDir) {
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      pg.transaction((tx) => fn({ query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows })),
  };
}

/**
 * `pg` already checks the server's certificate in full for `sslmode=require`
 * and `prefer`, but warns on every cold start that a future version will
 * not. Asking for `verify-full` by name keeps today's behaviour and the
 * stronger guarantee.
 */
export function explicitSslMode(url: string): string {
  return url.replace(/([?&]sslmode=)(?:require|prefer|verify-ca)(?=&|$)/, '$1verify-full');
}

/**
 * A real Postgres server (production). `schema` confines every query to one
 * schema, which lets test files share a server without colliding.
 */
export async function createPostgresDb(url: string, schema?: string): Promise<Db> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: explicitSslMode(url),
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  // A hosted database drops idle connections. Without a listener that is an
  // uncaught exception, which would take down the instance and any request
  // running in it. The pool replaces the connection on the next query.
  pool.on('error', (error) => console.error('[plonk] idle database connection lost:', error.message));
  // On Vercel, lets the platform close idle connections before it suspends
  // an instance. It does nothing anywhere else.
  const { attachDatabasePool } = await import('@vercel/functions');
  attachDatabasePool(pool);
  const transaction = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async <R>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[],
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    transaction,
    // An advisory lock that lasts as long as its transaction, which does
    // nothing else: one connection sits holding the lock while `fn` works
    // through the pool's others. Being tied to the transaction, it is let go
    // if this instance dies, and it works through a connection pooler, where a
    // lock tied to the session would not.
    exclusively: <T>(key: number, fn: () => Promise<T>) =>
      transaction(async (holder) => {
        await holder.query('SELECT pg_advisory_xact_lock($1)', [key]);
        return fn();
      }),
    close: () => pool.end(),
  };
}

async function open(url: string): Promise<Db> {
  const db = url.startsWith(PGLITE_SCHEME)
    ? await createPgliteDb(url === `${PGLITE_SCHEME}memory` ? undefined : url.slice(PGLITE_SCHEME.length))
    : await createPostgresDb(url);
  await migrate(db);
  return db;
}

// Kept on globalThis so every route in one instance, and every dev-server reload, shares the one connection.
const holder = globalThis as typeof globalThis & { __plonkDb?: Promise<Db> };

/** The process-wide database, migrated on first use. */
export function getDb(url: string): Promise<Db> {
  holder.__plonkDb ??= open(url).catch((error: unknown) => {
    holder.__plonkDb = undefined;
    throw error;
  });
  return holder.__plonkDb;
}
