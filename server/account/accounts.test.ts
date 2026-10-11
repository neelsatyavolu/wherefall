import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { getUser } from '../db/users.js';
import { resetDb, testDb } from '../testing.js';
import { RESTORE_WINDOW_MS, changePassword, deleteAccount, issueRecoveryCode, purgeDeleted, recover, register as createAccount, signIn } from './accounts.js';
import { verifyPassword } from './password.js';

// The real hashing, wrapped so a test can see how often a password was checked.
vi.mock('./password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./password.js')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const NOW = 1_800_000_000_000;
const PASSWORD = 'correct horse battery';

let db: Db;

/** Makes an account and answers with its id, which is all most of these tests want of it. Null when the name is taken. */
const register = async (q: Db, input: Parameters<typeof createAccount>[1]): Promise<string | null> => (await createAccount(q, input))?.id ?? null;

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
});

describe('a recovery code', () => {
  const NEXT = 'a brand new password';

  it('is made with the account, answered once and stored as a hash', async () => {
    const made = await createAccount(db, { username: 'neel', password: PASSWORD, now: NOW });
    expect(made?.recoveryCode).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const user = await getUser(db, made?.id ?? '');
    expect(user?.recoveryHash?.startsWith('scrypt$')).toBe(true);
    expect(user?.recoveryHash).not.toContain(made?.recoveryCode ?? '');
  });

  it('lets its holder in with a new password, at a new session version, and is replaced', async () => {
    const made = await createAccount(db, { username: 'neel', password: PASSWORD, now: NOW });
    const outcome = await recover(db, { username: ' Neel ', recoveryCode: made?.recoveryCode ?? '', newPassword: NEXT });
    expect(outcome).toEqual({ recovered: true, userId: made?.id, sessionVersion: 1, recoveryCode: expect.stringMatching(/^[A-HJKMNP-Z2-9-]{14}$/) });
    expect(await signIn(db, { username: 'neel', password: NEXT })).toMatchObject({ id: made?.id, sessionVersion: 1 });
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toBeNull();
    expect(await recover(db, { username: 'neel', recoveryCode: made?.recoveryCode ?? '', newPassword: PASSWORD })).toEqual({ recovered: false, reason: 'wrong' });
  });

  it('does the same slow check for an unknown name and for an account with no code, so their answers are no quicker', async () => {
    const id = (await register(db, { username: 'neel', password: PASSWORD, now: NOW })) ?? '';
    const stored = (await getUser(db, id))?.recoveryHash ?? '';
    await register(db, { username: 'codeless', password: PASSWORD, now: NOW });
    await db.query("UPDATE users SET recovery_hash = NULL WHERE username = 'codeless'");
    const costOf = (hash: string) => hash.split('$').slice(0, 4).join('$');

    vi.mocked(verifyPassword).mockClear();
    for (const username of ['nobody', 'codeless', 'neel']) {
      expect(await recover(db, { username, recoveryCode: 'AAAA-AAAA-AAAA', newPassword: NEXT })).toEqual({ recovered: false, reason: 'wrong' });
    }
    const checked = vi.mocked(verifyPassword).mock.calls.map(([, hash]) => hash);
    expect(checked).toHaveLength(3);
    expect(checked.map(costOf)).toEqual([costOf(stored), costOf(stored), costOf(stored)]);
    expect(checked[2]).toBe(stored);
  });

  it('is replaced by a new one for whoever has the password, unless the password changed meanwhile', async () => {
    const made = await createAccount(db, { username: 'neel', password: PASSWORD, now: NOW });
    const before = await getUser(db, made?.id ?? '');
    if (!before) {
      throw new Error('no account');
    }
    expect(await issueRecoveryCode(db, before, 'not my password')).toBeNull();
    expect((await getUser(db, before.id))?.recoveryHash).toBe(before.recoveryHash);

    const issued = await issueRecoveryCode(db, before, PASSWORD);
    expect(issued).toMatch(/^[A-HJKMNP-Z2-9-]{14}$/);
    expect(issued).not.toBe(made?.recoveryCode);
    expect((await getUser(db, before.id))?.recoveryHash).not.toBe(before.recoveryHash);

    expect(await changePassword(db, before, PASSWORD, NEXT)).toBe(1);
    // `before` still holds the old password's hash, as a request that read the account a moment earlier would.
    const kept = (await getUser(db, before.id))?.recoveryHash;
    expect(await issueRecoveryCode(db, before, PASSWORD)).toBeNull();
    expect((await getUser(db, before.id))?.recoveryHash).toBe(kept);
  });
});

describe('register', () => {
  it('stores the country it is given, and none when it is given none', async () => {
    const withOne = await register(db, { username: 'indian', password: PASSWORD, country: 'IN', now: NOW });
    const without = await register(db, { username: 'nowhere', password: PASSWORD, now: NOW });
    expect((await getUser(db, withOne ?? ''))?.country).toBe('IN');
    expect((await getUser(db, without ?? ''))?.country).toBeNull();
  });

  it('creates an account that can then sign in', async () => {
    const id = await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toMatchObject({ id: id });
  });

  it('stores the username, the time, and a hash in place of the password', async () => {
    const id = await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    const user = await getUser(db, id ?? '');
    expect(user).toMatchObject({ id, username: 'neel', createdAt: NOW });
    expect(user?.passwordHash).not.toContain(PASSWORD);
    expect(user?.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('is null when the username is taken, whatever its capitals, and leaves the first account alone', async () => {
    const first = await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    expect(await register(db, { username: ' NEEL ', password: 'another password', now: NOW + 1 })).toBeNull();
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toMatchObject({ id: first });
    expect(await signIn(db, { username: 'neel', password: 'another password' })).toBeNull();
  });

  it('stores the email it is given, and none for an account made without one', async () => {
    const withOne = await register(db, { username: 'neel', password: PASSWORD, email: 'neel@example.com', now: NOW });
    const without = await register(db, { username: 'older', password: PASSWORD, now: NOW });
    expect((await getUser(db, withOne ?? ''))?.email).toBe('neel@example.com');
    expect((await getUser(db, without ?? ''))?.email).toBeNull();
  });

  it('is null when the email is taken, and leaves the first account alone', async () => {
    const first = await register(db, { username: 'neel', password: PASSWORD, email: 'neel@example.com', now: NOW });
    expect(await register(db, { username: 'another', password: PASSWORD, email: 'neel@example.com', now: NOW + 1 })).toBeNull();
    expect(await db.query('SELECT id FROM users')).toEqual([{ id: first }]);
  });

  it('gives each account its own id', async () => {
    const one = await register(db, { username: 'one', password: PASSWORD, now: NOW });
    const two = await register(db, { username: 'two', password: PASSWORD, now: NOW });
    expect(one).not.toBe(two);
  });
});

describe('signIn', () => {
  it('is null for a wrong password or an unknown username', async () => {
    await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    expect(await signIn(db, { username: 'neel', password: 'wrong password' })).toBeNull();
    expect(await signIn(db, { username: 'nobody', password: PASSWORD })).toBeNull();
  });

  it('does the same slow password check for an unknown username, so its answer is no quicker', async () => {
    const id = await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    const stored = (await getUser(db, id ?? ''))?.passwordHash ?? '';
    const costOf = (hash: string) => hash.split('$').slice(0, 4).join('$');

    vi.mocked(verifyPassword).mockClear();
    expect(await signIn(db, { username: 'nobody', password: PASSWORD })).toBeNull();
    expect(await signIn(db, { username: 'nobody_else', password: PASSWORD })).toBeNull();

    const checked = vi.mocked(verifyPassword).mock.calls.map(([, hash]) => hash);
    expect(checked).toHaveLength(2);
    expect(checked.map(costOf)).toEqual([costOf(stored), costOf(stored)]);
  });

  it('ignores capitals and surrounding spaces in the username, but not in the password', async () => {
    const id = await register(db, { username: 'neel', password: PASSWORD, now: NOW });
    expect(await signIn(db, { username: ' Neel ', password: PASSWORD })).toMatchObject({ id: id });
    expect(await signIn(db, { username: 'neel', password: PASSWORD.toUpperCase() })).toBeNull();
  });
});

describe('getUser', () => {
  it('is null for an id nobody has', async () => {
    expect(await getUser(db, '3f0c2f6e-5b1a-4c8e-9d2a-7e6f5a4b3c2d')).toBeNull();
  });

  it('is null for a deleted account, which signing in still finds and says is deleted', async () => {
    const id = (await register(db, { username: 'neel', password: PASSWORD, now: NOW })) ?? '';
    expect(await deleteAccount(db, id, NOW + 1)).toBe(true);
    expect(await getUser(db, id)).toBeNull();
    expect(await signIn(db, { username: 'neel', password: PASSWORD })).toMatchObject({ id, deletedAt: NOW + 1 });
    expect(await signIn(db, { username: 'neel', password: 'wrong password' })).toBeNull();
    // Deleting twice is deleting once.
    expect(await deleteAccount(db, id, NOW + 2)).toBe(false);
  });
});

describe('changePassword', () => {
  it('is refused when the hash it checked is no longer the one stored', async () => {
    const id = (await register(db, { username: 'neel', password: PASSWORD, now: NOW })) ?? '';
    const before = await getUser(db, id);
    if (!before) {
      throw new Error('no account');
    }
    expect(await changePassword(db, before, PASSWORD, 'the first new password')).toBe(1);
    // `before` still holds the old hash, as a request that read the account a moment earlier would.
    expect(await changePassword(db, before, PASSWORD, 'the second new password')).toBeNull();
    expect(await signIn(db, { username: 'neel', password: 'the first new password' })).toMatchObject({ id });
  });
});

describe('purgeDeleted', () => {
  it('removes accounts deleted 30 days ago or more, and no others', async () => {
    const ids: string[] = [];
    for (const username of ['kept', 'recent', 'old']) {
      ids.push((await register(db, { username, password: PASSWORD, now: NOW })) ?? '');
    }
    await deleteAccount(db, ids[1] ?? '', NOW + 1);
    await deleteAccount(db, ids[2] ?? '', NOW);
    await purgeDeleted(db, NOW + RESTORE_WINDOW_MS);
    expect((await db.query<{ username: string }>('SELECT username FROM users ORDER BY username')).map((row) => row.username)).toEqual(['kept', 'recent']);
  });
});
