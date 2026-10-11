import { createHash } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { RESET_TTL_MS } from '../db/password-resets.js';
import { getUser } from '../db/users.js';
import { TEST_SECRET, resetDb, testDb } from '../testing.js';
import { deleteAccount, register, signIn } from './accounts.js';
import { beginReset, finishReset, hashEmail, hashResetToken, newResetToken, resetTokenSchema } from './reset.js';

const NOW = 1_800_000_000_000;
const PASSWORD = 'correct horse battery';
const NEXT = 'a brand new password';

let db: Db;

const tokens = () => db.query<{ token_hash: string; user_id: string }>('SELECT token_hash, user_id FROM password_resets');

async function account(username = 'neel'): Promise<string> {
  const made = await register(db, { username, password: PASSWORD, email: `${username}@example.com`, now: NOW });
  return made?.id ?? '';
}

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('a reset token', () => {
  it('is 32 random bytes as a link carries them, a different one each time', () => {
    const made = Array.from({ length: 50 }, newResetToken);
    expect(new Set(made).size).toBe(50);
    for (const token of made) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(resetTokenSchema.safeParse(token).success).toBe(true);
    }
  });

  it.each(['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, 42, null])('is not %j', (token) => {
    expect(resetTokenSchema.safeParse(token).success).toBe(false);
  });

  it('is looked up by its SHA-256, which is all the database is given', async () => {
    const id = await account();
    const token = await beginReset(db, id, NOW);
    const hash = createHash('sha256').update(token).digest('hex');
    expect(hashResetToken(token)).toBe(hash);
    expect(await tokens()).toEqual([{ token_hash: hash, user_id: id }]);
    expect(JSON.stringify(await db.query('SELECT * FROM password_resets'))).not.toContain(token);
  });
});

describe('hashEmail', () => {
  it('is the same for one address and one key, different for another of either, and does not hold the address', () => {
    const hash = hashEmail('neel@example.com', TEST_SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail('neel@example.com', TEST_SECRET)).toBe(hash);
    expect(hashEmail('friend@example.com', TEST_SECRET)).not.toBe(hash);
    expect(hashEmail('neel@example.com', Buffer.alloc(32, 8))).not.toBe(hash);
    expect(hash).not.toContain('neel');
  });
});

describe('finishReset', () => {
  it('sets the new password, ends every earlier session, and leaves the recovery code as it was', async () => {
    const id = await account();
    const before = await getUser(db, id);
    const token = await beginReset(db, id, NOW);

    expect(await finishReset(db, token, NEXT, NOW + 60_000)).toEqual({ userId: id, username: 'neel', sessionVersion: 1 });
    expect(await signIn(db, { username: 'neel', password: NEXT })).toMatchObject({ id, sessionVersion: 1 });
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toBeNull();
    const after = await getUser(db, id);
    expect(after?.recoveryHash).toBe(before?.recoveryHash);
    expect(after?.email).toBe('neel@example.com');
  });

  it('works once', async () => {
    const id = await account();
    const token = await beginReset(db, id, NOW);
    expect(await finishReset(db, token, NEXT, NOW)).not.toBeNull();
    expect(await finishReset(db, token, 'yet another password', NOW)).toBeNull();
    expect(await signIn(db, { username: 'neel', password: NEXT })).not.toBeNull();
  });

  it('does nothing with a token that was never made, or one whose hour is over', async () => {
    const id = await account();
    const token = await beginReset(db, id, NOW);
    expect(await finishReset(db, newResetToken(), NEXT, NOW)).toBeNull();
    expect(await finishReset(db, token, NEXT, NOW + RESET_TTL_MS)).toBeNull();
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toMatchObject({ id, sessionVersion: 0 });
  });

  it('takes only the newest link of an account, and ends that one too once it is used', async () => {
    const id = await account();
    const other = await account('friend');
    const first = await beginReset(db, id, NOW);
    const second = await beginReset(db, id, NOW + 1000);
    const theirs = await beginReset(db, other, NOW);

    expect(await finishReset(db, first, NEXT, NOW + 2000)).toBeNull();
    expect(await finishReset(db, second, NEXT, NOW + 2000)).toMatchObject({ userId: id });
    expect(await tokens()).toEqual([{ token_hash: hashResetToken(theirs), user_id: other }]);
  });

  it('does nothing for an account deleted since the link was sent, and uses the link up', async () => {
    const id = await account();
    const token = await beginReset(db, id, NOW);
    await deleteAccount(db, id, NOW + 1000);
    expect(await finishReset(db, token, NEXT, NOW + 2000)).toBeNull();
    expect(await tokens()).toEqual([]);
    expect(await signIn(db, { username: 'neel', password: NEXT })).toBeNull();
  });
});
