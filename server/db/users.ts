import type { Queryable, Row } from './client.js';
import { utcDay } from './progress.js';
import { fromTs, toTs } from './time.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
  /** Elo, moved by ranked duels only. */
  rating: number;
  /** Ranked duels that counted towards the rating. */
  ratedGames: number;
  xp: number;
  /** The longest country streak. */
  bestStreak: number;
  /** Banned from everything online by a moderator. */
  banned: boolean;
  /** A guest: a player with a name and a session, and no account. */
  guest: boolean;
  /** Two-letter code, or null for none. */
  country: string | null;
  /** When the player deleted the account, or null for one that is there. */
  deletedAt: number | null;
  /** Days in a row, UTC, the account has been looked at by its owner. */
  loginStreak: number;
  duelWins: number;
  duelLosses: number;
  duelTies: number;
  /** Best scores in Country Guesser and Continent Guesser, in points. */
  bestCountry: number;
  bestContinent: number;
  /** False once the player has turned friend requests off. */
  allowRequests: boolean;
  hideChat: boolean;
  /** True when friends are told only whether the player is online, not when they last were. */
  hideLastSeen: boolean;
  /** What a session must have been made at to still be good. */
  sessionVersion: number;
  /** The recovery code, hashed like a password, or null for an account that has none. */
  recoveryHash: string | null;
  teamWins: number;
  teamLosses: number;
  teamTies: number;
}

/** A new account starts with the database's defaults for everything it has not played for yet. */
export type NewUser = Pick<User, 'id' | 'username' | 'passwordHash' | 'createdAt'> & { country?: string | null; recoveryHash?: string | null };

function rowToUser(row: Row): User {
  return {
    id: row.id as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    createdAt: fromTs(row.created_at),
    rating: row.rating as number,
    ratedGames: row.rated_games as number,
    xp: row.xp as number,
    bestStreak: row.best_streak as number,
    banned: row.banned as boolean,
    guest: row.guest as boolean,
    country: row.country as string | null,
    deletedAt: row.deleted_at === null ? null : fromTs(row.deleted_at),
    loginStreak: row.login_streak as number,
    duelWins: row.duel_wins as number,
    duelLosses: row.duel_losses as number,
    duelTies: row.duel_ties as number,
    bestCountry: row.best_country as number,
    bestContinent: row.best_continent as number,
    allowRequests: row.allow_requests as boolean,
    hideChat: row.hide_chat as boolean,
    hideLastSeen: row.hide_last_seen as boolean,
    sessionVersion: row.session_version as number,
    recoveryHash: row.recovery_hash as string | null,
    teamWins: row.team_wins as number,
    teamLosses: row.team_losses as number,
    teamTies: row.team_ties as number,
  };
}

/** False when the username already belongs to an account. */
export async function insertUser(q: Queryable, user: NewUser): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO users (id, username, password_hash, created_at, country, recovery_hash) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (username) DO NOTHING RETURNING id`,
    [user.id, user.username, user.passwordHash, toTs(user.createdAt), user.country ?? null, user.recoveryHash ?? null],
  );
  return rows.length === 1;
}

/** Whoever has the name, a deleted account included: signing in is how one is restored. */
export async function findUserByUsername(q: Queryable, username: string): Promise<User | null> {
  const rows = await q.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** The player with that id, account or guest. Null when there is none, and for an account that has been deleted. */
export async function getUser(q: Queryable, id: string): Promise<User | null> {
  const rows = await q.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  return rows[0] ? rowToUser(rows[0]) : null;
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * Counts today towards an account's login streak, and answers with the
 * account as it then is: one more than yesterday's streak, or 1 after a day
 * missed. Null, having written nothing, when today is already counted (or
 * the account is gone, deleted or a guest). One statement, so of two calls
 * arriving together on a new day only one finds the day uncounted.
 *
 * The account's owner asking for it is also a sighting of them, which is what
 * puts a player back on the leaderboards after a fortnight away.
 */
export async function countLogin(q: Queryable, id: string, now: number): Promise<User | null> {
  const rows = await q.query(
    `UPDATE users
        SET login_streak = CASE WHEN login_day = $3 THEN login_streak + 1 ELSE 1 END, login_day = $2, last_seen_at = $4::timestamptz
      WHERE id = $1 AND deleted_at IS NULL AND NOT guest AND (login_day IS NULL OR login_day < $2)
      RETURNING *`,
    [id, utcDay(now), utcDay(now - DAY_MS), toTs(now)],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

/**
 * Stores a new password hash in place of `from`, the one the player's current
 * password was checked against. False when that is no longer the hash stored:
 * another change got there first, and the password that was checked is not
 * the account's any more. A new password ends every session made under the
 * old one: the answer is the session version a new session must carry.
 */
export async function replacePasswordHash(q: Queryable, id: string, from: string, to: string): Promise<number | null> {
  const [row] = await q.query<{ session_version: number }>(
    `UPDATE users SET password_hash = $3, session_version = session_version + 1
      WHERE id = $1 AND password_hash = $2 AND deleted_at IS NULL RETURNING session_version`,
    [id, from, to],
  );
  return row?.session_version ?? null;
}

/**
 * Stores a new recovery code's hash in place of whatever the account had.
 * False when `passwordHash`, the one the player's password was checked
 * against, is no longer the hash stored: the password was changed, or a
 * recovery code used, while this request was checking it, and the code that
 * was given out then is the one that stands.
 */
export async function replaceRecoveryHash(q: Queryable, id: string, passwordHash: string, to: string): Promise<boolean> {
  const rows = await q.query('UPDATE users SET recovery_hash = $3 WHERE id = $1 AND password_hash = $2 AND deleted_at IS NULL RETURNING id', [id, passwordHash, to]);
  return rows.length === 1;
}

/** What using a recovery code leaves the account with. */
export interface Recovered {
  passwordHash: string;
  /** The hash of the code given out for the one that was used. */
  recoveryHash: string;
  /** True to bring a deleted account back with it. Without it a deleted account is left alone. */
  restore: boolean;
}

/**
 * Spends a recovery code: sets the new password and the next code in place
 * of `from`, the hash the code was checked against, and ends every session
 * made before. The answer is the session version a new session must carry.
 * Null when `from` is no longer the hash stored: of two requests using one
 * code at the same moment the database lets exactly one through, and the
 * other finds the code spent. One statement, so the account never has the
 * new password with the old code still good.
 */
export async function spendRecoveryCode(q: Queryable, id: string, from: string, to: Recovered): Promise<number | null> {
  const [row] = await q.query<{ session_version: number }>(
    `UPDATE users
        SET password_hash = $3, recovery_hash = $4, session_version = session_version + 1,
            deleted_at = CASE WHEN $5::boolean THEN NULL ELSE deleted_at END
      WHERE id = $1 AND recovery_hash = $2 AND NOT guest AND ($5::boolean OR deleted_at IS NULL)
      RETURNING session_version`,
    [id, from, to.passwordHash, to.recoveryHash, to.restore],
  );
  return row?.session_version ?? null;
}

/** Ends every session of an account, in every browser. The answer is the version a new session must carry; null when the account is gone. */
export async function endSessions(q: Queryable, id: string): Promise<number | null> {
  const [row] = await q.query<{ session_version: number }>('UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version', [id]);
  return row?.session_version ?? null;
}

export async function setCountry(q: Queryable, id: string, country: string | null): Promise<boolean> {
  const rows = await q.query('UPDATE users SET country = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id, country]);
  return rows.length === 1;
}

export interface Settings {
  allowRequests: boolean;
  hideChat: boolean;
  hideLastSeen: boolean;
}

/** Changes the settings that are given and leaves the rest, answering with all of them. Null when the account is gone. */
export async function changeSettings(q: Queryable, id: string, change: Partial<Settings>): Promise<Settings | null> {
  const [row] = await q.query<{ allow_requests: boolean; hide_chat: boolean; hide_last_seen: boolean }>(
    `UPDATE users SET allow_requests = coalesce($2::boolean, allow_requests), hide_chat = coalesce($3::boolean, hide_chat),
            hide_last_seen = coalesce($4::boolean, hide_last_seen)
      WHERE id = $1 AND deleted_at IS NULL RETURNING allow_requests, hide_chat, hide_last_seen`,
    [id, change.allowRequests ?? null, change.hideChat ?? null, change.hideLastSeen ?? null],
  );
  return row ? { allowRequests: row.allow_requests, hideChat: row.hide_chat, hideLastSeen: row.hide_last_seen } : null;
}

/** Marks an account deleted, which ends its sessions. False when it already is, or is not an account. */
export async function markDeleted(q: Queryable, id: string, now: number): Promise<boolean> {
  const rows = await q.query(
    'UPDATE users SET deleted_at = $2::timestamptz, session_version = session_version + 1 WHERE id = $1 AND deleted_at IS NULL AND NOT guest RETURNING id',
    [id, toTs(now)],
  );
  return rows.length === 1;
}

/** Brings a deleted account back. False when its row has gone for good. */
export async function restoreUser(q: Queryable, id: string): Promise<boolean> {
  const rows = await q.query('UPDATE users SET deleted_at = NULL WHERE id = $1 RETURNING id', [id]);
  return rows.length === 1;
}

/** Removes for good every account deleted at or before `before`, and with each everything that was its own. */
export async function purgeDeletedBefore(q: Queryable, before: number): Promise<void> {
  // Their likes first, so that each map they liked counts one fewer. Taking the
  // likes and lowering the counts is one statement: stopped after it, the
  // next clearing-out finds no likes left to take and deletes the accounts.
  await q.query(
    `WITH taken AS (
       DELETE FROM map_likes l USING users u WHERE u.id = l.user_id AND u.deleted_at <= $1::timestamptz RETURNING l.slug
     ), fewer AS (SELECT slug, count(*)::int AS likes FROM taken GROUP BY slug)
     UPDATE community_maps m SET likes = m.likes - fewer.likes FROM fewer WHERE fewer.slug = m.slug`,
    [toTs(before)],
  );
  await q.query('DELETE FROM users WHERE deleted_at <= $1::timestamptz', [toTs(before)]);
}
