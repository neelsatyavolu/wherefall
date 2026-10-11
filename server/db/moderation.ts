import type { Queryable } from './client.js';
import { fromTs, toTs } from './time.js';

/** How many reported maps, and how many reported or banned players, a moderator is shown at once. */
const LISTED = 100;
/** How many of the newest reasons are shown for each. */
const REASONS_SHOWN = 10;

export interface ReportedMap {
  slug: string;
  name: string;
  /** The username of the player who made it. */
  maker: string;
  reports: number;
  /** The newest reasons given, newest first. */
  reasons: string[];
}

/** Where a report of a player stands: waiting for a moderator, or how one decided it. */
export type ReportStatus = 'open' | 'actioned' | 'dismissed';
const OPEN: ReportStatus = 'open';

/** What one report of a player says: what it is about, and the note that came with it, which may be empty. */
export interface ReportReason {
  category: string;
  note: string;
}

export interface ReportedPlayer {
  username: string;
  /** How many reports of the player are open. */
  reports: number;
  /** The newest open reports, newest first. */
  reasons: ReportReason[];
  banned: boolean;
}

/** One of an account's own reports, as it is shown back to whoever made it. */
export interface OwnReport extends ReportReason {
  /** The name the reported player has now. */
  username: string;
  at: number;
  status: ReportStatus;
}

/**
 * Stores a player's report of another, replacing their earlier one and
 * opening it again, whatever a moderator had decided about the earlier one.
 */
export async function reportPlayer(q: Queryable, targetId: string, reporterId: string, reason: ReportReason, now: number): Promise<void> {
  await q.query(
    `INSERT INTO player_reports (target_id, reporter_id, category, reason, created_at, status) VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
     ON CONFLICT (target_id, reporter_id) DO UPDATE
       SET category = EXCLUDED.category, reason = EXCLUDED.reason, created_at = EXCLUDED.created_at, status = EXCLUDED.status`,
    [targetId, reporterId, reason.category, reason.note, toTs(now), OPEN],
  );
}

/**
 * The reports of players an account has made, newest first. One of an account
 * that has since been deleted is left out: there is nobody to show it against.
 */
export async function reportsBy(q: Queryable, reporterId: string, limit: number): Promise<OwnReport[]> {
  const rows = await q.query<{ username: string; category: string; note: string; created_at: unknown; status: ReportStatus }>(
    `SELECT u.username, r.category, r.reason AS note, r.created_at, r.status
       FROM player_reports r JOIN users u ON u.id = r.target_id AND u.deleted_at IS NULL
      WHERE r.reporter_id = $1
      ORDER BY r.created_at DESC, u.username LIMIT $2`,
    [reporterId, limit],
  );
  return rows.map((row) => ({ username: row.username, category: row.category, note: row.note, at: fromTs(row.created_at), status: row.status }));
}

/**
 * Marks the open reports of a player as decided, the way a moderator decided
 * them, and leaves the ones decided before as they were. They are kept: each
 * is still shown, with how it ended, to whoever made it.
 */
export async function settlePlayerReports(q: Queryable, targetId: string, status: Exclude<ReportStatus, 'open'>): Promise<void> {
  await q.query('UPDATE player_reports SET status = $2 WHERE target_id = $1 AND status = $3', [targetId, status, OPEN]);
}

/** Every map that has been reported, most reported first. */
export async function reportedMaps(q: Queryable): Promise<ReportedMap[]> {
  const rows = await q.query<ReportedMap>(
    `SELECT m.slug, m.name, u.username AS maker, count(*)::int AS reports,
            jsonb_agg(r.reason ORDER BY r.created_at DESC, r.reporter_id) AS reasons
       FROM map_reports r
       JOIN community_maps m ON m.slug = r.slug
       JOIN users u ON u.id = m.owner_id
      GROUP BY m.slug, m.name, u.username
      ORDER BY reports DESC, m.slug LIMIT $1`,
    [LISTED],
  );
  return rows.map((row) => ({ ...row, reasons: row.reasons.slice(0, REASONS_SHOWN) }));
}

/**
 * Every player who has an open report or is banned, most reported first. A banned player stays listed so the ban can be lifted.
 * A deleted account is not: it is nobody until it is restored, and then it is listed again.
 * Reports a moderator has already decided are neither counted nor shown.
 */
export async function reportedPlayers(q: Queryable): Promise<ReportedPlayer[]> {
  const rows = await q.query<ReportedPlayer>(
    `SELECT u.username, u.banned, count(r.reporter_id)::int AS reports,
            coalesce(jsonb_agg(jsonb_build_object('category', r.category, 'note', r.reason) ORDER BY r.created_at DESC, r.reporter_id)
                       FILTER (WHERE r.reporter_id IS NOT NULL), '[]'::jsonb) AS reasons
       FROM users u LEFT JOIN player_reports r ON r.target_id = u.id AND r.status = $2
      WHERE (u.banned OR r.target_id IS NOT NULL) AND u.deleted_at IS NULL
      GROUP BY u.id, u.username, u.banned
      ORDER BY reports DESC, u.username LIMIT $1`,
    [LISTED, OPEN],
  );
  return rows.map((row) => ({ username: row.username, reports: row.reports, reasons: row.reasons.slice(0, REASONS_SHOWN), banned: row.banned }));
}

/** Deletes a map whoever made it, with its likes and its reports, as its maker deleting it would. False when there is no such map. */
export async function removeMap(q: Queryable, slug: string): Promise<boolean> {
  return (await q.query('DELETE FROM community_maps WHERE slug = $1 RETURNING slug', [slug])).length === 1;
}

export async function clearMapReports(q: Queryable, slug: string): Promise<void> {
  await q.query('DELETE FROM map_reports WHERE slug = $1', [slug]);
}

/**
 * Bans an account from online play, or lifts the ban. A ban also ends the
 * account's sessions and takes it out of any queue it is waiting in; a match
 * it is already playing it may play out.
 */
export async function setBanned(q: Queryable, userId: string, banned: boolean): Promise<void> {
  await q.query('UPDATE users SET banned = $2, session_version = session_version + CASE WHEN $2 AND NOT banned THEN 1 ELSE 0 END WHERE id = $1', [userId, banned]);
  if (banned) {
    await q.query('DELETE FROM match_queue WHERE user_id = $1', [userId]);
  }
}
