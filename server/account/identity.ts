import { randomInt, randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { toTs } from '../db/time.js';
import { fail, isLocalRequest } from '../http.js';
import type { Context } from '../serve.js';
import { accountCookieName, accountSessionOf, clearedCookie, createAccountSession, createGuestSession, guestOf, readCookie, sessionCookie, GUEST_TTL_MS } from './session.js';

/** What an account-only action answers a guest, with a 403. A visitor with no session gets a 401 instead. */
export const GUESTS_CANNOT = 'Guests cannot do that. Make an account first.';
export const SIGN_IN_FIRST = 'Sign in first.';

/** Who a request is from: an account or a guest, as their row has them now. */
export interface Player {
  userId: string;
  guest: boolean;
  username: string;
  banned: boolean;
}

const secure = (request: Request): boolean => !isLocalRequest(request);
const tokenIn = (request: Request): string | undefined => readCookie(request, accountCookieName(secure(request)));

/** What the request's session cookie claims, by its signature alone: who, and at which session version. Null for a visitor. */
function claimIn(request: Request, context: Context): { userId: string; guest: boolean; version: number } | null {
  const token = tokenIn(request);
  const account = accountSessionOf(token, context.now, context.secret);
  if (account) {
    return { ...account, guest: false };
  }
  const guestId = guestOf(token, context.now, context.secret);
  return guestId ? { userId: guestId, guest: true, version: 0 } : null;
}

/**
 * The player a request is from, or null for a visitor. A session is a signed
 * token and would outlive what it was for, so it is checked against the row:
 * it is nobody's once the account is deleted or gone, or has ended its
 * sessions (a new password, a recovery code, a ban, "sign out everywhere")
 * since this one was made. One read, by primary key.
 */
export async function playerIn(request: Request, context: Context): Promise<Player | null> {
  const claim = claimIn(request, context);
  if (!claim) {
    return null;
  }
  const [row] = await context.db.query<{ username: string; guest: boolean; banned: boolean; session_version: number }>(
    'SELECT username, guest, banned, session_version FROM users WHERE id = $1 AND deleted_at IS NULL',
    [claim.userId],
  );
  const live = row !== undefined && row.guest === claim.guest && row.session_version === claim.version;
  return live ? { userId: claim.userId, guest: row.guest, username: row.username, banned: row.banned } : null;
}

/** The account a request is from, or null for a visitor or a guest. */
export async function accountIn(request: Request, context: Context): Promise<Player | null> {
  const player = await playerIn(request, context);
  return player && !player.guest ? player : null;
}

/** True when the request carries a session cookie at all, live or not: what tells a browser to drop one that has ended. */
export const hasSession = (request: Request, context: Context): boolean => claimIn(request, context) !== null;

/**
 * The refusal for a request that needs an account and has none: a guest is
 * told guests cannot, a visitor is told to sign in.
 */
export const noAccount = (player: Player | null): Response => (player?.guest ? fail(GUESTS_CANNOT, 403) : fail(SIGN_IN_FIRST, 401));

/** The header that signs this browser in to an account, at the account's session version. */
export function accountSession(userId: string, version: number, request: Request, context: Context): Record<string, string> {
  return { 'Set-Cookie': sessionCookie(createAccountSession(userId, context.now, context.secret, version), secure(request)) };
}

/** The header that signs this browser out. */
export const noSession = (request: Request): Record<string, string> => ({ 'Set-Cookie': clearedCookie(secure(request)) });

const NAME_ATTEMPTS = 8;

/** "Guest #4821". The space and the # are what keep it from ever being an account's name. Six digits once four keep being taken. */
const guestName = (attempt: number): string => `Guest #${attempt < NAME_ATTEMPTS / 2 ? randomInt(1000, 10_000) : randomInt(100_000, 1_000_000)}`;

/**
 * Makes a guest: a player row with no password that anyone could match, a
 * name of its own, and the flag that keeps it out of everything an account
 * earns. Returns its id and name.
 */
export async function createGuest(db: Db, now: number): Promise<{ userId: string; username: string }> {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
    const userId = randomUUID();
    const username = guestName(attempt);
    const made = await db.query(
      `INSERT INTO users (id, username, password_hash, created_at, guest, last_seen_at) VALUES ($1, $2, '', $3::timestamptz, true, $3::timestamptz)
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [userId, username, toTs(now)],
    );
    if (made.length === 1) {
      return { userId, username };
    }
  }
  throw new Error('Could not find a free guest name');
}

/** The header that gives a browser a guest's session. */
export function guestSession(userId: string, request: Request, context: Context): Record<string, string> {
  return { 'Set-Cookie': sessionCookie(createGuestSession(userId, context.now, context.secret), secure(request)) };
}

/**
 * Deletes guests nobody has heard from for a day, and with them their seats
 * in old matches. One who still holds a seat in a match that is not over is
 * left until it is: taking a player's guesses out from under a game being
 * played would change it for everyone else in it.
 */
export async function deleteOldGuests(db: Db, now: number): Promise<void> {
  await db.query(
    `DELETE FROM users u WHERE u.guest AND coalesce(u.last_seen_at, u.created_at) < $1::timestamptz
        AND NOT EXISTS (SELECT 1 FROM match_players p WHERE p.user_id = u.id AND p.open)`,
    [toTs(now - GUEST_TTL_MS)],
  );
}

/** Marks a player as there just now. This is what "online", "last seen" and the clearing out of old guests go by. */
export async function markSeen(db: Db, userId: string, now: number): Promise<void> {
  await db.query('UPDATE users SET last_seen_at = $2::timestamptz WHERE id = $1', [userId, toTs(now)]);
}
