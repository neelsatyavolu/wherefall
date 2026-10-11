import { randomUUID } from 'node:crypto';
import type { Db, Queryable } from '../db/client.js';
import { openMatchOf } from '../db/matches.js';
import {
  findUserByUsername,
  insertUser,
  markDeleted,
  purgeDeletedBefore,
  replacePasswordHash,
  replaceRecoveryHash,
  spendRecoveryCode,
  type User,
} from '../db/users.js';
import { leaveMatch } from '../match/play.js';
import { leaveQueue } from '../match/queue.js';
import { hashPassword, verifyPassword } from './password.js';
import { hashRecoveryCode, newRecoveryCode, verifyRecoveryCode } from './recovery.js';

interface Credentials {
  username: string;
  password: string;
}

/** How long a deleted account keeps its username and can be restored. */
export const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60_000;

const normalise = (username: string): string => username.trim().toLowerCase();

/**
 * Creates an account, and with it the recovery code that is the only way
 * back in without the password. The code is answered once, here, and kept
 * only as a hash. Null when the username, or the email, is taken.
 */
export async function register(
  q: Queryable,
  input: Credentials & { email?: string | null; country?: string | null; now: number },
): Promise<{ id: string; recoveryCode: string } | null> {
  const id = randomUUID();
  const recoveryCode = newRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([hashPassword(input.password), hashRecoveryCode(recoveryCode)]);
  const { email, country, now: createdAt } = input;
  const created = await insertUser(q, { id, username: normalise(input.username), passwordHash, createdAt, country, recoveryHash, email });
  return created ? { id, recoveryCode } : null;
}

// A hash no password matches. It is checked when the username is unknown, so
// a sign-in takes as long whether or not the account exists.
let decoy: Promise<string> | undefined;
const decoyHash = (): Promise<string> => (decoy ??= hashPassword(randomUUID()));

/** The account when the password is right. It may be one that was deleted: `deletedAt` says so. */
export async function signIn(q: Queryable, input: Credentials): Promise<User | null> {
  const user = await findUserByUsername(q, normalise(input.username));
  const matches = await verifyPassword(input.password, user?.passwordHash ?? (await decoyHash()));
  return user && matches ? user : null;
}

/**
 * Changes the account's password when `current` is the one it has, and ends
 * every session made under the old one: the answer is the session version a
 * new session must carry. Null when `current` is wrong, which includes having
 * been changed by another request while this one was checking it: of two
 * changes made at once, one wins and the other is told its current password
 * is no longer right.
 */
export async function changePassword(q: Queryable, user: User, current: string, next: string): Promise<number | null> {
  if (!(await verifyPassword(current, user.passwordHash))) {
    return null;
  }
  return replacePasswordHash(q, user.id, user.passwordHash, await hashPassword(next));
}

/**
 * Gives the account a new recovery code in place of any it had, when
 * `password` is the one it has. The answer is the code, shown this once.
 * Null when the password is wrong, which includes its having been changed,
 * or a recovery code used, while this was checking it.
 */
export async function issueRecoveryCode(q: Queryable, user: User, password: string): Promise<string | null> {
  if (!(await verifyPassword(password, user.passwordHash))) {
    return null;
  }
  const recoveryCode = newRecoveryCode();
  return (await replaceRecoveryHash(q, user.id, user.passwordHash, await hashRecoveryCode(recoveryCode))) ? recoveryCode : null;
}

export interface Recovery {
  username: string;
  recoveryCode: string;
  newPassword: string;
  /** Asks for a deleted account to be brought back. */
  restore?: boolean | undefined;
}

/** What came of a try at recovering an account: the account signed in to, or why not. */
export type RecoveryOutcome = { recovered: true; userId: string; sessionVersion: number; recoveryCode: string } | { recovered: false; reason: 'wrong' | 'deleted' };

const WRONG_CODE: RecoveryOutcome = { recovered: false, reason: 'wrong' };

/**
 * Lets whoever holds an account's recovery code back in: sets the new
 * password, ends every session made before, and gives a new code for the
 * one used, which is spent. An unknown name and an account with no code are
 * checked against a hash nothing matches, so they take as long to refuse as
 * a wrong code. Only someone with the code is told the account was deleted,
 * and it is brought back only when they ask.
 */
export async function recover(q: Queryable, input: Recovery): Promise<RecoveryOutcome> {
  const user = await findUserByUsername(q, normalise(input.username));
  const stored = user?.recoveryHash ?? null;
  const matches = await verifyRecoveryCode(input.recoveryCode, stored ?? (await decoyHash()));
  if (!user || stored === null || !matches) {
    return WRONG_CODE;
  }
  const restore = input.restore === true;
  if (user.deletedAt !== null && !restore) {
    return { recovered: false, reason: 'deleted' };
  }
  const recoveryCode = newRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([hashPassword(input.newPassword), hashRecoveryCode(recoveryCode)]);
  const sessionVersion = await spendRecoveryCode(q, user.id, stored, { passwordHash, recoveryHash, restore });
  // Not stored: another request spent the code first, and this one is told what any wrong code is.
  return sessionVersion === null ? WRONG_CODE : { recovered: true, userId: user.id, sessionVersion, recoveryCode };
}

/**
 * Deletes an account: it is hidden from everyone from now, out of the queue
 * and the match it was in, and its row goes once the restore window has
 * passed. False when it was already deleted.
 *
 * Marked first, and on its own: from then on nothing lets the account into a
 * queue or a match, so what it leaves here it cannot be put back into. Leaving
 * goes the way it does for any player, under the match's own lock, so a party
 * passes to its next player and a duel is settled.
 */
export async function deleteAccount(db: Db, userId: string, now: number): Promise<boolean> {
  if (!(await markDeleted(db, userId, now))) {
    return false;
  }
  await leaveQueue(db, userId, now);
  const matchId = await openMatchOf(db, userId);
  if (matchId) {
    await leaveMatch(db, userId, matchId, now);
  }
  return true;
}

/** Clears away the accounts whose restore window has passed, which frees their usernames. */
export async function purgeDeleted(q: Queryable, now: number): Promise<void> {
  await purgeDeletedBefore(q, now - RESTORE_WINDOW_MS);
}
