import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { RESET_TTL_MS, deleteResetTokensOf, storeResetToken, takeResetToken } from './password-resets.js';
import { insertUser } from './users.js';
import { resetDb, testDb } from '../testing.js';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

let db: Db;
let neel: string;
let friend: string;

async function addUser(username: string): Promise<string> {
  const id = randomUUID();
  await insertUser(db, { id, username, passwordHash: 'not-a-real-hash', createdAt: NOW });
  return id;
}

const stored = () => db.query<{ token_hash: string }>('SELECT token_hash FROM password_resets ORDER BY token_hash');

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = await addUser('neel');
  friend = await addUser('friend');
});

describe('a reset token', () => {
  it('lasts an hour', () => {
    expect(RESET_TTL_MS).toBe(60 * MINUTE);
  });

  it('is stored with when it was made and when it stops working', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    const [row] = await db.query<{ user_id: string; expires_at: Date; created_at: Date }>('SELECT user_id, expires_at, created_at FROM password_resets');
    expect(row?.user_id).toBe(neel);
    expect(new Date(row?.created_at ?? 0).getTime()).toBe(NOW);
    expect(new Date(row?.expires_at ?? 0).getTime()).toBe(NOW + RESET_TTL_MS);
  });

  it('names its account the once it is taken, and nobody after', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    expect(await takeResetToken(db, 'hash-1', NOW + MINUTE)).toBe(neel);
    expect(await takeResetToken(db, 'hash-1', NOW + MINUTE)).toBeNull();
    expect(await stored()).toEqual([]);
  });

  it('lets one of two requests through when both take it at the same moment', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    const taken = await Promise.all([takeResetToken(db, 'hash-1', NOW), takeResetToken(db, 'hash-1', NOW)]);
    expect(taken.filter((userId) => userId === neel)).toHaveLength(1);
    expect(taken.filter((userId) => userId === null)).toHaveLength(1);
  });

  it('names nobody when it was never stored', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    expect(await takeResetToken(db, 'hash-2', NOW)).toBeNull();
    expect(await stored()).toEqual([{ token_hash: 'hash-1' }]);
  });

  it('works up to the end of its hour and not from then on', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    expect(await takeResetToken(db, 'hash-1', NOW + RESET_TTL_MS)).toBeNull();
    expect(await takeResetToken(db, 'hash-1', NOW + RESET_TTL_MS + MINUTE)).toBeNull();
    expect(await takeResetToken(db, 'hash-1', NOW + RESET_TTL_MS - 1)).toBe(neel);
  });

  it('is replaced by a newer one for the same account, and leaves another account’s alone', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    await storeResetToken(db, friend, 'hash-f', NOW);
    await storeResetToken(db, neel, 'hash-2', NOW + MINUTE);
    expect(await stored()).toEqual([{ token_hash: 'hash-2' }, { token_hash: 'hash-f' }]);
    expect(await takeResetToken(db, 'hash-1', NOW + MINUTE)).toBeNull();
    expect(await takeResetToken(db, 'hash-2', NOW + MINUTE)).toBe(neel);
    expect(await takeResetToken(db, 'hash-f', NOW + MINUTE)).toBe(friend);
  });

  it('is cleared away, once its hour is over, the next time anyone is given one', async () => {
    await storeResetToken(db, friend, 'hash-f', NOW);
    await storeResetToken(db, neel, 'hash-1', NOW + RESET_TTL_MS - 1);
    expect(await stored()).toEqual([{ token_hash: 'hash-1' }, { token_hash: 'hash-f' }]);
    await storeResetToken(db, neel, 'hash-2', NOW + RESET_TTL_MS);
    expect(await stored()).toEqual([{ token_hash: 'hash-2' }]);
  });

  it('goes with every other of its account’s when they are deleted', async () => {
    await storeResetToken(db, neel, 'hash-1', NOW);
    await storeResetToken(db, friend, 'hash-f', NOW);
    await deleteResetTokensOf(db, neel);
    expect(await stored()).toEqual([{ token_hash: 'hash-f' }]);
  });
});
