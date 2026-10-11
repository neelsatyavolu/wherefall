import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb, createPostgresDb, explicitSslMode, getDb } from './client.js';

/** Stands in for the `pg` driver: records what a pool and its clients were asked to do. */
const fake = vi.hoisted(() => {
  const state = {
    options: [] as Array<Record<string, unknown>>,
    statements: [] as string[],
    released: 0,
    attached: 0,
    ended: 0,
    listeners: {} as Record<string, (error: Error) => void>,
    failOn: null as string | null,
  };
  const run = async (sql: string, params?: unknown[]) => {
    state.statements.push(sql);
    if (state.failOn !== null && sql.includes(state.failOn)) {
      throw new Error('statement failed');
    }
    return { rows: [{ sql, params: params ?? null }] };
  };
  class Pool {
    constructor(options: Record<string, unknown>) {
      state.options.push(options);
    }
    query = run;
    on(event: string, listener: (error: Error) => void) {
      state.listeners[event] = listener;
    }
    async end() {
      state.ended += 1;
    }
    async connect() {
      return {
        query: run,
        release: () => {
          state.released += 1;
        },
      };
    }
  }
  return { state, Pool };
});

vi.mock('pg', () => ({ Pool: fake.Pool }));
vi.mock('@vercel/functions', () => ({
  attachDatabasePool: () => {
    fake.state.attached += 1;
  },
}));

beforeEach(() => {
  Object.assign(fake.state, { options: [], statements: [], released: 0, attached: 0, ended: 0, listeners: {}, failOn: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createPgliteDb', () => {
  it('has no lock across sessions and nothing to close: it is one session in one process', async () => {
    const db = await createPgliteDb();
    expect(db.exclusively).toBeUndefined();
    expect(db.close).toBeUndefined();
  });

  it('runs parameterized queries and returns their rows', async () => {
    const db = await createPgliteDb();
    expect(await db.query('SELECT $1::int + 1 AS n', [41])).toEqual([{ n: 42 }]);
    expect(await db.query("SELECT 'no params' AS s")).toEqual([{ s: 'no params' }]);
  });

  it('keeps what a transaction wrote when it finishes', async () => {
    const db = await createPgliteDb();
    await db.query('CREATE TABLE notes (body text)');
    const result = await db.transaction(async (tx) => {
      await tx.query('INSERT INTO notes VALUES ($1)', ['kept']);
      return (await tx.query<{ body: string }>('SELECT body FROM notes'))[0]?.body;
    });
    expect(result).toBe('kept');
    expect(await db.query('SELECT body FROM notes')).toEqual([{ body: 'kept' }]);
  });

  it('undoes a transaction that throws', async () => {
    const db = await createPgliteDb();
    await db.query('CREATE TABLE notes (body text)');
    const attempt = db.transaction(async (tx) => {
      await tx.query("INSERT INTO notes VALUES ('lost')");
      throw new Error('stop');
    });
    await expect(attempt).rejects.toThrow('stop');
    expect(await db.query('SELECT body FROM notes')).toEqual([]);
  });

  it('stores its data in a folder when given one, creating the folders above it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plonk-db-'));
    try {
      const db = await createPgliteDb(join(root, 'nested', 'data'));
      expect(await db.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
      expect(existsSync(join(root, 'nested', 'data'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('explicitSslMode', () => {
  it('asks for full certificate checks by name', () => {
    expect(explicitSslMode('postgres://u:p@host/db?sslmode=require')).toBe('postgres://u:p@host/db?sslmode=verify-full');
    expect(explicitSslMode('postgres://host/db?a=1&sslmode=prefer&b=2')).toBe('postgres://host/db?a=1&sslmode=verify-full&b=2');
    expect(explicitSslMode('postgres://host/db?sslmode=verify-ca')).toBe('postgres://host/db?sslmode=verify-full');
  });

  it('leaves every other address alone', () => {
    expect(explicitSslMode('postgres://host/db')).toBe('postgres://host/db');
    expect(explicitSslMode('postgres://host/db?sslmode=disable')).toBe('postgres://host/db?sslmode=disable');
    expect(explicitSslMode('postgres://host/db?sslmode=verify-full')).toBe('postgres://host/db?sslmode=verify-full');
  });
});

describe('createPostgresDb', () => {
  it('opens a small pool on the given address and hands it to the platform', async () => {
    await createPostgresDb('postgres://host/db?sslmode=require');
    expect(fake.state.options).toEqual([expect.objectContaining({ connectionString: 'postgres://host/db?sslmode=verify-full', max: 5 })]);
    expect(fake.state.options[0]).not.toHaveProperty('options');
    expect(fake.state.attached).toBe(1);
  });

  it('confines its queries to one schema when asked', async () => {
    await createPostgresDb('postgres://host/db', 't_abc');
    expect(fake.state.options[0]).toMatchObject({ options: '-c search_path=t_abc' });
  });

  it('returns the rows of a query', async () => {
    const db = await createPostgresDb('postgres://host/db');
    expect(await db.query('SELECT $1', ['x'])).toEqual([{ sql: 'SELECT $1', params: ['x'] }]);
    expect(await db.query('SELECT 1')).toEqual([{ sql: 'SELECT 1', params: [] }]);
  });

  it('commits a transaction on one connection and gives the connection back', async () => {
    const db = await createPostgresDb('postgres://host/db');
    const result = await db.transaction(async (tx) => {
      await tx.query('INSERT 1');
      return (await tx.query('SELECT $1', ['x']))[0];
    });
    expect(result).toEqual({ sql: 'SELECT $1', params: ['x'] });
    expect(fake.state.statements).toEqual(['BEGIN', 'INSERT 1', 'SELECT $1', 'COMMIT']);
    expect(fake.state.released).toBe(1);
  });

  it('rolls back and gives the connection back when a statement fails', async () => {
    const db = await createPostgresDb('postgres://host/db');
    fake.state.failOn = 'INSERT';
    await expect(db.transaction((tx) => tx.query('INSERT 1'))).rejects.toThrow('statement failed');
    expect(fake.state.statements).toEqual(['BEGIN', 'INSERT 1', 'ROLLBACK']);
    expect(fake.state.released).toBe(1);
  });

  it('holds a lock across sessions for as long as the work takes, on one connection, while the work uses the others', async () => {
    const db = await createPostgresDb('postgres://host/db');
    const result = await db.exclusively?.(42, async () => {
      await db.query('CREATE TABLE x ()');
      return 'done';
    });
    expect(result).toBe('done');
    expect(fake.state.statements).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock($1)', 'CREATE TABLE x ()', 'COMMIT']);
    expect(fake.state.released).toBe(1);
  });

  it('lets the lock go, and passes the failure on, when the work fails', async () => {
    const db = await createPostgresDb('postgres://host/db');
    await expect(db.exclusively?.(42, () => Promise.reject(new Error('setup failed')))).rejects.toThrow('setup failed');
    expect(fake.state.statements).toEqual(['BEGIN', 'SELECT pg_advisory_xact_lock($1)', 'ROLLBACK']);
    expect(fake.state.released).toBe(1);
  });

  it('closes its connections when asked', async () => {
    const db = await createPostgresDb('postgres://host/db');
    await db.close?.();
    expect(fake.state.ended).toBe(1);
  });

  it('logs a dropped idle connection without throwing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createPostgresDb('postgres://host/db');
    fake.state.listeners.error?.(new Error('terminated'));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('idle database connection lost'), 'terminated');
  });
});

describe('getDb', () => {
  const holder = globalThis as typeof globalThis & { __plonkDb?: unknown };

  beforeEach(() => {
    holder.__plonkDb = undefined;
  });

  it('opens an in-memory database, creates the tables, and reuses it', async () => {
    const first = getDb('pglite://memory');
    expect(getDb('pglite://memory')).toBe(first);
    expect(await (await first).query('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 0 }]);
  });

  it('opens a database stored on disk for a pglite:// path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plonk-db-'));
    try {
      const db = await getDb(`pglite://${join(root, 'data')}`);
      expect(await db.query('SELECT count(*)::int AS n FROM games')).toEqual([{ n: 0 }]);
      expect(existsSync(join(root, 'data'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses a Postgres pool for any other address, and creates the tables there', async () => {
    await getDb('postgres://host/db');
    expect(fake.state.options).toHaveLength(1);
    expect(fake.state.statements.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS users'))).toBe(true);
  });

  it('tries again on the next call after a failed start', async () => {
    fake.state.failOn = 'CREATE TABLE';
    await expect(getDb('postgres://host/db')).rejects.toThrow('statement failed');
    fake.state.failOn = null;
    await expect(getDb('postgres://host/db')).resolves.toBeDefined();
    expect(fake.state.options).toHaveLength(2);
  });
});
