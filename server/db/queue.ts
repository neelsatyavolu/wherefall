import type { QueueKind } from '../match/input.js';
import { QUEUE_LAPSE_MS } from '../match/types.js';
import type { Queryable } from './client.js';
import { fromTs, toTs } from './time.js';

/** An entry polled at or before this moment has lapsed. */
const lapsedAt = (now: number): string => toTs(now - QUEUE_LAPSE_MS);

/**
 * Puts the player in a queue, or moves them to another. Their place in line
 * is kept only when they were already waiting in that same queue. `groupId`
 * ties two players who queue for 2v2 as a pair.
 */
export async function enqueue(q: Queryable, userId: string, kind: QueueKind, now: number, groupId: string | null = null): Promise<void> {
  await q.query(
    `INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at, group_id) VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       joined_at = CASE WHEN match_queue.kind = EXCLUDED.kind AND match_queue.last_seen_at > $4::timestamptz
                        THEN match_queue.joined_at ELSE EXCLUDED.joined_at END,
       kind = EXCLUDED.kind,
       last_seen_at = EXCLUDED.last_seen_at,
       group_id = EXCLUDED.group_id`,
    [userId, kind, toTs(now), lapsedAt(now), groupId],
  );
}

/** Counts a poll as the player's queue heartbeat. Null when they are not waiting, or their entry has lapsed. */
export async function touchQueueEntry(q: Queryable, userId: string, now: number): Promise<{ kind: QueueKind; joinedAt: number } | null> {
  const [row] = await q.query<{ kind: QueueKind; joined_at: unknown }>(
    'UPDATE match_queue SET last_seen_at = $2::timestamptz WHERE user_id = $1 AND last_seen_at > $3::timestamptz RETURNING kind, joined_at',
    [userId, toTs(now), lapsedAt(now)],
  );
  return row ? { kind: row.kind, joinedAt: fromTs(row.joined_at) } : null;
}

/** Takes the player out of whatever queue they are in, and says which it was. */
export async function removeFromQueue(q: Queryable, userId: string): Promise<QueueKind | null> {
  const [row] = await q.query<{ kind: QueueKind }>('DELETE FROM match_queue WHERE user_id = $1 RETURNING kind', [userId]);
  return row?.kind ?? null;
}

export async function removeAllFromQueue(tx: Queryable, userIds: string[]): Promise<void> {
  await tx.query('DELETE FROM match_queue WHERE user_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))', [JSON.stringify(userIds)]);
}

export async function deleteLapsedEntries(q: Queryable, now: number): Promise<void> {
  await q.query('DELETE FROM match_queue WHERE last_seen_at <= $1::timestamptz', [lapsedAt(now)]);
}

/**
 * Holds the row that stands for a queue, making it on first use, and says
 * when its countdown ends if one is running. Whoever holds it is the only
 * one deciding who is in that queue's next match, so every queue's matches
 * are made one request at a time.
 */
export async function lockGathering(tx: Queryable, kind: QueueKind): Promise<number | null> {
  const [row] = await tx.query<{ starts_at: unknown }>(
    'INSERT INTO queue_gathering (kind) VALUES ($1) ON CONFLICT (kind) DO UPDATE SET kind = EXCLUDED.kind RETURNING starts_at',
    [kind],
  );
  return row?.starts_at ? fromTs(row.starts_at) : null;
}

/** Starts, moves or (with null) cancels a queue's countdown. The caller holds the queue's gathering row. */
export async function setGathering(tx: Queryable, kind: QueueKind, startsAt: number | null): Promise<void> {
  await tx.query('UPDATE queue_gathering SET starts_at = $2::timestamptz WHERE kind = $1', [kind, startsAt === null ? null : toTs(startsAt)]);
}

/** One player waiting in a queue, with what matchmaking goes by. */
export interface Waiting {
  userId: string;
  joinedAt: number;
  rating: number;
  /** The other player of a pair queueing for 2v2 together carries the same group. */
  groupId: string | null;
  /** Who their last ranked duel was against, and when it was made. */
  lastOpponent: string | null;
  lastRankedAt: number | null;
}

/**
 * Everyone waiting in a queue, longest first, with their entries held. The
 * caller holds the queue's gathering row, so nobody else is choosing players
 * from it, and this waits for any entry another request is in the middle of
 * writing rather than passing it over.
 *
 * Nobody waiting should be in an unfinished match, and every path into the
 * queue sees to that. Should one be all the same, they are left out here
 * rather than left to fail every match they would be put in.
 */
export async function everyoneWaiting(tx: Queryable, kind: QueueKind, now: number): Promise<Waiting[]> {
  const rows = await tx.query(
    `SELECT q.user_id, q.joined_at, q.group_id, u.rating, u.last_ranked_opponent, u.last_ranked_at
       FROM match_queue q JOIN users u ON u.id = q.user_id
      WHERE q.kind = $1 AND q.last_seen_at > $2::timestamptz AND NOT u.banned
        AND NOT EXISTS (SELECT 1 FROM match_players p WHERE p.user_id = q.user_id AND p.open)
      ORDER BY q.joined_at, q.user_id FOR UPDATE OF q`,
    [kind, lapsedAt(now)],
  );
  return rows.map((row) => ({
    userId: row.user_id as string,
    joinedAt: fromTs(row.joined_at),
    rating: row.rating as number,
    groupId: row.group_id as string | null,
    lastOpponent: row.last_ranked_opponent as string | null,
    lastRankedAt: row.last_ranked_at === null ? null : fromTs(row.last_ranked_at),
  }));
}

/** Notes on both accounts that they have just been paired for a ranked duel. */
export async function notePairing(tx: Queryable, a: string, b: string, now: number): Promise<void> {
  await tx.query(
    `UPDATE users SET last_ranked_at = $3::timestamptz, last_ranked_opponent = CASE WHEN id = $1 THEN $2::uuid ELSE $1::uuid END
      WHERE id IN ($1, $2)`,
    [a, b, toTs(now)],
  );
}

/** What a player asking about the queue needs when they are not in it: the match they are in, and any lock on ranked play. */
export async function standingOf(q: Queryable, userId: string): Promise<{ matchId: string | null; lockedUntil: number | null }> {
  const [row] = await q.query<{ match_id: string | null; ranked_locked_until: unknown }>(
    `SELECT (SELECT p.match_id FROM match_players p WHERE p.user_id = u.id AND p.open) AS match_id, u.ranked_locked_until
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  return { matchId: row?.match_id ?? null, lockedUntil: row?.ranked_locked_until ? fromTs(row.ranked_locked_until) : null };
}

/**
 * Records that a player left a ranked duel before its first guess. A second
 * time within `withinMs` locks them out of the ranked queue for `lockMs`.
 */
export async function recordDodge(tx: Queryable, userId: string, now: number, withinMs: number, lockMs: number): Promise<void> {
  await tx.query(
    `UPDATE users SET ranked_locked_until = CASE WHEN last_dodge_at > $3::timestamptz THEN $4::timestamptz ELSE ranked_locked_until END,
            last_dodge_at = $2::timestamptz
      WHERE id = $1`,
    [userId, toTs(now), toTs(now - withinMs), toTs(now + lockMs)],
  );
}

/** Over how long the waits that make up a queue's typical wait are looked back on. */
export const WAITS_KEPT_MS = 24 * 60 * 60_000;

/** Notes how long each of these players waited in the queue before the match just found for them. Run before their entries are deleted. */
export async function noteWaits(tx: Queryable, userIds: string[], now: number): Promise<void> {
  await tx.query(
    `INSERT INTO queue_waits (kind, found_at, waited_ms)
     SELECT q.kind, $2::timestamptz, greatest(0, round(extract(epoch FROM ($2::timestamptz - q.joined_at)) * 1000))::int
       FROM match_queue q WHERE q.user_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(userIds), toTs(now)],
  );
}

/** Notes a player who was put straight into a game under way: they did not wait at all. */
export async function noteNoWait(tx: Queryable, kind: QueueKind, now: number): Promise<void> {
  await tx.query('INSERT INTO queue_waits (kind, found_at, waited_ms) VALUES ($1, $2::timestamptz, 0)', [kind, toTs(now)]);
}

/** The median wait, in whole seconds, of the players a match was found for in this queue in the last day. Null when there were none. */
export async function typicalWait(q: Queryable, kind: QueueKind, now: number): Promise<number | null> {
  const [row] = await q.query<{ median: number | null }>(
    'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY waited_ms) AS median FROM queue_waits WHERE kind = $1 AND found_at > $2::timestamptz',
    [kind, toTs(now - WAITS_KEPT_MS)],
  );
  return row?.median === null || row?.median === undefined ? null : Math.round(Number(row.median) / 1000);
}

/** Deletes the waits too old to count. */
export async function deleteOldWaits(q: Queryable, now: number): Promise<void> {
  await q.query('DELETE FROM queue_waits WHERE found_at <= $1::timestamptz', [toTs(now - WAITS_KEPT_MS)]);
}
