import type { Queryable } from './client.js';
import { toTs } from './time.js';

/** How long a reset link works for. */
export const RESET_TTL_MS = 60 * 60_000;

/**
 * Keeps a new reset token for an account, by its hash, in place of any the
 * account had: only the latest link sent works. The tokens of anyone whose
 * hour is over are cleared away with them, so the table holds only links
 * that could still be used.
 */
export async function storeResetToken(q: Queryable, userId: string, tokenHash: string, now: number): Promise<void> {
  await q.query('DELETE FROM password_resets WHERE user_id = $1 OR expires_at <= $2::timestamptz', [userId, toTs(now)]);
  await q.query('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3::timestamptz, $4::timestamptz)', [
    tokenHash,
    userId,
    toTs(now + RESET_TTL_MS),
    toTs(now),
  ]);
}

/**
 * Uses a reset token up: the account it was for, or null when there is no
 * such token or its hour is over. One statement, so of two requests with one
 * token at the same moment the database lets exactly one through.
 */
export async function takeResetToken(q: Queryable, tokenHash: string, now: number): Promise<string | null> {
  const [row] = await q.query<{ user_id: string }>('DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > $2::timestamptz RETURNING user_id', [
    tokenHash,
    toTs(now),
  ]);
  return row?.user_id ?? null;
}

/** Ends every reset link an account has out. */
export async function deleteResetTokensOf(q: Queryable, userId: string): Promise<void> {
  await q.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
}
