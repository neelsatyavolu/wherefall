import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from '../db/client.js';
import { deleteResetTokensOf, storeResetToken, takeResetToken } from '../db/password-resets.js';
import { getUser, replacePasswordHash } from '../db/users.js';
import { hashPassword } from './password.js';

const TOKEN_BYTES = 32;

/** A reset token as a link carries it: 32 random bytes in the letters a web address takes as they are. */
export const resetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A new reset token. It goes into one email and is kept nowhere: the database has only its hash. */
export const newResetToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** What a reset token is stored and looked up by. The token is 256 random bits, so a plain hash is enough. */
export const hashResetToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** An email as a rate limit is counted against it: a keyed hash, so no address is stored among the limits. */
export const hashEmail = (email: string, secret: Buffer): string => createHmac('sha256', secret).update(`email:${email}`).digest('hex');

/** Makes the token of a reset link for an account, in place of any link it had out. */
export async function beginReset(q: Queryable, userId: string, now: number): Promise<string> {
  const token = newResetToken();
  await storeResetToken(q, userId, hashResetToken(token), now);
  return token;
}

/** The account a reset signed in to, at the session version a new session must carry. */
export interface ResetDone {
  userId: string;
  username: string;
  sessionVersion: number;
}

/**
 * Finishes a reset: uses the token up, sets the new password, ends every
 * session made before and every other reset link the account had out. The
 * recovery code is left as it was. Null when the token is not one that can be
 * used: unknown, used already, over its hour, or for an account that has
 * since been deleted.
 */
export async function finishReset(q: Queryable, token: string, newPassword: string, now: number): Promise<ResetDone | null> {
  const userId = await takeResetToken(q, hashResetToken(token), now);
  const user = userId === null ? null : await getUser(q, userId);
  if (!user || user.guest) {
    return null;
  }
  const sessionVersion = await replacePasswordHash(q, user.id, user.passwordHash, await hashPassword(newPassword));
  if (sessionVersion === null) {
    return null;
  }
  await deleteResetTokensOf(q, user.id);
  return { userId: user.id, username: user.username, sessionVersion };
}
