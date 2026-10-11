import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { endSessions, insertUser } from '../db/users.js';
import type { Context } from '../serve.js';
import { TEST_SECRET, apiRequest, resetDb, testDb } from '../testing.js';
import { accountIn, accountSession, createGuest, guestSession, hasSession, noAccount, playerIn } from './identity.js';
import { accountCookieName, createAccountSession, sign } from './session.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

let db: Db;
let neel: string;

const at = (now = NOW): Context => ({ db, now, secret: TEST_SECRET });
const asking = (cookie?: string) => apiRequest('GET', '/api/account', { cookie });
const cookieOf = (token: string) => `${accountCookieName(true)}=${token}`;
/** The cookie a Set-Cookie header would leave in the browser. */
const kept = (headers: Record<string, string>) => (headers['Set-Cookie'] ?? '').split(';')[0] ?? '';

beforeAll(async () => {
  db = await testDb();
});

beforeEach(async () => {
  await resetDb(db);
  neel = randomUUID();
  await insertUser(db, { id: neel, username: 'neel', passwordHash: 'not-a-real-hash', createdAt: NOW });
});

describe('playerIn', () => {
  it('is nobody for a visitor, and for a cookie nobody signed', async () => {
    expect(await playerIn(asking(), at())).toBeNull();
    expect(await playerIn(asking(cookieOf('account.made-up')), at())).toBeNull();
    expect(hasSession(asking(), at())).toBe(false);
  });

  it('is the account a session names, as its row has it now', async () => {
    const cookie = kept(accountSession(neel, 0, asking(), at()));
    expect(await playerIn(asking(cookie), at())).toEqual({ userId: neel, guest: false, username: 'neel', banned: false });
    await db.query('UPDATE users SET banned = true WHERE id = $1', [neel]);
    expect(await accountIn(asking(cookie), at())).toMatchObject({ username: 'neel', banned: true });
  });

  it('still knows a session made before versions were written into sessions', async () => {
    const old = cookieOf(sign(`account.${neel}.${NOW + DAY}`, TEST_SECRET));
    expect(await playerIn(asking(old), at())).toMatchObject({ userId: neel });
  });

  it('is nobody once the account has ended its sessions, until a session is made at the new version', async () => {
    const before = cookieOf(createAccountSession(neel, NOW, TEST_SECRET));
    const version = (await endSessions(db, neel)) ?? -1;
    expect(version).toBe(1);
    expect(await playerIn(asking(before), at())).toBeNull();
    // The browser still holds the cookie, which is how it is told to drop it.
    expect(hasSession(asking(before), at())).toBe(true);
    expect(await playerIn(asking(kept(accountSession(neel, version, asking(), at()))), at())).toMatchObject({ userId: neel });
    // A session cannot be made at a version the account has not reached.
    expect(await playerIn(asking(kept(accountSession(neel, version + 1, asking(), at()))), at())).toBeNull();
  });

  it('is nobody for a deleted account, an account that is gone, and an expired session', async () => {
    const cookie = cookieOf(createAccountSession(neel, NOW, TEST_SECRET));
    expect(await playerIn(asking(cookie), at(NOW + 30 * DAY))).toBeNull();
    await db.query('UPDATE users SET deleted_at = $2 WHERE id = $1', [neel, new Date(NOW)]);
    expect(await playerIn(asking(cookie), at())).toBeNull();
    await db.query('DELETE FROM users WHERE id = $1', [neel]);
    expect(await playerIn(asking(cookie), at())).toBeNull();
  });

  it('is a guest for a guest session, and never an account', async () => {
    const guest = await createGuest(db, NOW);
    const cookie = kept(guestSession(guest.userId, asking(), at()));
    expect(await playerIn(asking(cookie), at())).toEqual({ userId: guest.userId, guest: true, username: guest.username, banned: false });
    expect(await accountIn(asking(cookie), at())).toBeNull();
  });

  it('does not take an account session for a guest row, or a guest session for an account', async () => {
    const guest = await createGuest(db, NOW);
    expect(await playerIn(asking(cookieOf(createAccountSession(guest.userId, NOW, TEST_SECRET))), at())).toBeNull();
    expect(await playerIn(asking(kept(guestSession(neel, asking(), at()))), at())).toBeNull();
  });
});

describe('noAccount', () => {
  it('tells a visitor to sign in and a guest to make an account', async () => {
    const guest = await createGuest(db, NOW);
    const refusal = async (response: Response) => [response.status, (await response.json()).error];
    expect(await refusal(noAccount(null))).toEqual([401, 'Sign in first.']);
    expect(await refusal(noAccount({ userId: guest.userId, guest: true, username: guest.username, banned: false }))).toEqual([403, 'Guests cannot do that. Make an account first.']);
  });
});
