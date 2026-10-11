import type { Queryable } from './client.js';
import { COUNTED_GAMES } from './games.js';
import { fromTs, toTs } from './time.js';

export const BOARDS = ['rating', 'xp', 'streak'] as const;
export type Board = (typeof BOARDS)[number];
export const PERIODS = ['all', 'day'] as const;
export type Period = (typeof PERIODS)[number];

const DAY_MS = 24 * 60 * 60_000;
/** An account nobody has seen for this long is left off the all-time boards. */
export const BOARD_INACTIVE_MS = 14 * DAY_MS;
/** A player counts as online for this long after their browser last said it was there. */
export const ONLINE_MS = 2 * 60_000;

/** True when a player last seen at `lastSeenAt` counts as online at `now`. */
export const isOnline = (lastSeenAt: number | null, now: number): boolean => lastSeenAt !== null && now - lastSeenAt < ONLINE_MS;

/**
 * What each leaderboard ranks by, and who is on it: a player appears once
 * they have something to rank, so the boards are not padded with accounts
 * that never played, and a banned account is on none. These are the only column names ever put into the
 * query, and each pair matches one of the indexes in schema.ts.
 */
const BOARD_COLUMNS: Record<Board, { value: string; played: string }> = {
  rating: { value: 'rating', played: 'rated_games' },
  xp: { value: 'xp', played: 'xp' },
  streak: { value: 'best_streak', played: 'best_streak' },
};

export interface BoardRow {
  /** True for the one row that is the asker's own standing; false for a row of the top of the board. */
  you: boolean;
  username: string;
  country: string | null;
  value: number;
  xp: number;
  rating: number;
  rank: number;
}

/** Whose rows are players anyone may be shown: not a guest's, a banned account's or a deleted one's. */
const shown = (alias: string): string => `NOT ${alias}.banned AND NOT ${alias}.guest AND ${alias}.deleted_at IS NULL`;

/**
 * Who is on an all-time board: an account that may be shown, has something to
 * rank, and was seen after the moment the parameter `since` holds. One never
 * seen goes by when it was made.
 */
const onBoard = (alias: string, played: string, since: string): string =>
  `${alias}.${played} > 0 AND ${shown(alias)} AND coalesce(${alias}.last_seen_at, ${alias}.created_at) > ${since}::timestamptz`;

/**
 * The query for where the account `$1` stands on an all-time board, which is
 * no row when it is not on it. Equal values rank by who made their account
 * first, and the rank is a count of the players ahead, along the board's index.
 */
function ownStanding(board: Board, since: string): string {
  const { value, played } = BOARD_COLUMNS[board];
  return `SELECT m.username, m.country, m.${value} AS value, m.xp, m.rating,
                 (SELECT count(*) FROM users o
                   WHERE ${onBoard('o', played, since)}
                     AND (o.${value} > m.${value} OR (o.${value} = m.${value} AND (o.created_at, o.id) < (m.created_at, m.id))))::int + 1 AS rank
            FROM users m WHERE m.id = $1::uuid AND ${onBoard('m', played, since)}`;
}

/** The top of an all-time board, read straight off its index, and the asker's own standing. `$3` is the last moment that is too long ago to have been seen. */
function allTimeBoard(board: Board): string {
  const { value, played } = BOARD_COLUMNS[board];
  return `WITH top AS (
       SELECT u.username, u.country, u.${value} AS value, u.xp, u.rating,
              (row_number() OVER (ORDER BY u.${value} DESC, u.created_at ASC, u.id ASC))::int AS rank
         FROM users u WHERE ${onBoard('u', played, '$3')}
        ORDER BY u.${value} DESC, u.created_at ASC, u.id ASC LIMIT $2
     ), mine AS (${ownStanding(board, '$3')})`;
}

/**
 * What each account gained since the start of the day, `$3`. XP is the day's
 * running sum, kept beside where the account stands. Rating is the sum of what each of the day's ranked duels moved it
 * by, which the history of matches records and nothing else does: a duel
 * that was called off moved nothing. Streak is the best run made today.
 */
const DAY_GAINS: Record<Board, string> = {
  xp: `SELECT t.user_id, t.xp_gained AS value FROM progress_days t WHERE t.day = to_char($3::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
  rating: `SELECT g.user_id, sum(g.rating_after - g.rating_before)::int AS value
             FROM online_games g WHERE g.played_at >= $3::timestamptz GROUP BY g.user_id`,
  streak: `SELECT r.user_id, max(r.streak) AS value
             FROM streak_runs r WHERE r.kind = 'streak' AND r.played_at >= $3::timestamptz GROUP BY r.user_id`,
};

/** The day's board: everyone who may be shown and came out ahead today, ranked like any board. Being seen is not asked of them, since they played today. */
function dayBoard(board: Board): string {
  return `WITH standing AS (
       SELECT u.id, u.username, u.country, d.value, u.xp, u.rating, u.created_at
         FROM (${DAY_GAINS[board]}) d JOIN users u ON u.id = d.user_id
        WHERE d.value > 0 AND ${shown('u')}
     ), top AS (
       SELECT s.username, s.country, s.value, s.xp, s.rating,
              (row_number() OVER (ORDER BY s.value DESC, s.created_at ASC, s.id ASC))::int AS rank
         FROM standing s ORDER BY s.value DESC, s.created_at ASC, s.id ASC LIMIT $2
     ), mine AS (
       SELECT m.username, m.country, m.value, m.xp, m.rating,
              (SELECT count(*) FROM standing o
                WHERE o.value > m.value OR (o.value = m.value AND (o.created_at, o.id) < (m.created_at, m.id)))::int + 1 AS rank
         FROM standing m WHERE m.id = $1::uuid
     )`;
}

/** What is asked of a leaderboard: which, over when, for whom, and how much of it. */
export interface BoardAsk {
  board: Board;
  period: Period;
  /** The asker's account, whose own standing is wanted with the top, or null. */
  viewerId: string | null;
  limit: number;
  /** True to rank the accounts nobody has seen for a fortnight too. Only an all-time board ever leaves them out. */
  inactive: boolean;
}

/**
 * The top of a leaderboard and, when `viewerId` is on the board, their own
 * standing, in one query. Equal values rank by who made their account first.
 * With the inactive wanted, an all-time board takes everyone seen since the
 * beginning of time, which is everyone.
 */
export async function leaderboardRows(q: Queryable, { board, period, viewerId, limit, inactive }: BoardAsk, now: number): Promise<BoardRow[]> {
  const [standings, since] = period === 'day' ? [dayBoard(board), now - (now % DAY_MS)] : [allTimeBoard(board), inactive ? 0 : now - BOARD_INACTIVE_MS];
  return q.query<BoardRow>(
    `${standings}
     SELECT false AS you, username, country, value, xp, rating, rank FROM top
     UNION ALL
     SELECT true, username, country, value, xp, rating, rank FROM mine
     ORDER BY you, rank`,
    [viewerId, limit, toTs(since)],
  );
}

/** An account's place on the all-time rating board, or null when it is not on it. */
export async function ratingRankOf(q: Queryable, userId: string, now: number): Promise<number | null> {
  const [row] = await q.query<{ rank: number }>(`SELECT rank FROM (${ownStanding('rating', '$2')}) mine`, [userId, toTs(now - BOARD_INACTIVE_MS)]);
  return row?.rank ?? null;
}

/** How many players, accounts and guests, are online. */
export async function onlineCount(q: Queryable, now: number): Promise<number> {
  const [row] = await q.query<{ online: number }>('SELECT count(*)::int AS online FROM users WHERE last_seen_at > $1::timestamptz AND deleted_at IS NULL', [
    toTs(now - ONLINE_MS),
  ]);
  return row?.online ?? 0;
}

export interface ProfileRow {
  id: string;
  username: string;
  country: string | null;
  joinedAt: number;
  xp: number;
  rating: number;
  ratedGames: number;
  bestStreak: number;
  bestCountry: number;
  bestContinent: number;
  duelWins: number;
  duelLosses: number;
  duelTies: number;
  teamWins: number;
  teamLosses: number;
  teamTies: number;
  /** How many viewers have looked at this, each counted once a day, and never the player themself. */
  views: number;
  lastSeenAt: number | null;
  /** True when nobody else is to be told when the player was last seen. */
  hideLastSeen: boolean;
  gamesPlayed: number;
}

/**
 * What anyone may see of a player. Null when nobody has that username, which
 * is also what a deleted account's answers. Looking counts nothing by itself:
 * see `countProfileView`.
 */
export async function profileOf(q: Queryable, username: string): Promise<ProfileRow | null> {
  const [row] = await q.query(
    `SELECT u.id, u.username, u.country, u.created_at, u.xp, u.rating, u.rated_games, u.best_streak, u.best_country, u.best_continent,
            u.duel_wins, u.duel_losses, u.duel_ties, u.team_wins, u.team_losses, u.team_ties, u.last_seen_at, u.hide_last_seen,
            u.profile_views AS views,
            (SELECT count(*) FROM games g WHERE g.user_id = u.id AND g.${COUNTED_GAMES})::int AS games_played
       FROM users u WHERE u.username = $1 AND u.deleted_at IS NULL AND NOT u.guest`,
    [username],
  );
  if (!row) {
    return null;
  }
  return {
    id: row.id as string,
    username: row.username as string,
    country: row.country as string | null,
    joinedAt: fromTs(row.created_at),
    xp: row.xp as number,
    rating: row.rating as number,
    ratedGames: row.rated_games as number,
    bestStreak: row.best_streak as number,
    bestCountry: row.best_country as number,
    bestContinent: row.best_continent as number,
    duelWins: row.duel_wins as number,
    duelLosses: row.duel_losses as number,
    duelTies: row.duel_ties as number,
    teamWins: row.team_wins as number,
    teamLosses: row.team_losses as number,
    teamTies: row.team_ties as number,
    views: row.views as number,
    lastSeenAt: row.last_seen_at === null ? null : fromTs(row.last_seen_at),
    hideLastSeen: row.hide_last_seen as boolean,
    gamesPlayed: row.games_played as number,
  };
}

/**
 * Counts one more view of an account's profile, and answers with the count
 * with that view in it. One statement, so views by two viewers at the same
 * moment are both counted. Null when the account is gone.
 */
export async function countProfileView(q: Queryable, userId: string): Promise<number | null> {
  const [row] = await q.query<{ profile_views: number }>(
    'UPDATE users SET profile_views = profile_views + 1 WHERE id = $1 AND deleted_at IS NULL AND NOT guest RETURNING profile_views',
    [userId],
  );
  return row?.profile_views ?? null;
}

export interface HistoryPoint {
  /** UTC, YYYY-MM-DD. */
  day: string;
  xp: number;
  rating: number;
  /** The account's place on each board at the end of that day. Null for a day recorded before places were kept, and for a rating with no rated game behind it. */
  xpRank: number | null;
  ratingRank: number | null;
}

/**
 * Where the account stood at the end of each day it changed on, oldest
 * first: the days from `since` on, or with null every day, and never more
 * than the latest `limit` of them.
 */
export async function historyOf(q: Queryable, userId: string, since: string | null, limit: number): Promise<HistoryPoint[]> {
  return q.query<HistoryPoint>(
    `SELECT day, xp, rating, xp_rank AS "xpRank", rating_rank AS "ratingRank"
       FROM (SELECT * FROM progress_days WHERE user_id = $1 AND ($2::text IS NULL OR day >= $2) ORDER BY day DESC LIMIT $3) latest
      ORDER BY day`,
    [userId, since, limit],
  );
}

/** The id of the account with that name. Null when there is none, and for an account that has been deleted. */
export async function userIdFor(q: Queryable, username: string): Promise<string | null> {
  const [row] = await q.query<{ id: string }>('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [username]);
  return row?.id ?? null;
}

/**
 * Holds both accounts' rows, always in the same order, so everything that
 * changes what two players are to each other takes turns. False when either
 * account is gone or deleted.
 */
export async function lockPair(tx: Queryable, a: string, b: string): Promise<boolean> {
  const rows = await tx.query('SELECT id FROM users WHERE id IN ($1, $2) AND deleted_at IS NULL ORDER BY id FOR NO KEY UPDATE', [a, b]);
  return rows.length === 2;
}

/** What stands between two players: nothing, a request one of them made, or a friendship. */
export type Tie = { requesterId: string; accepted: boolean } | null;

export async function tieBetween(tx: Queryable, a: string, b: string): Promise<Tie> {
  const [row] = await tx.query<{ requester_id: string; accepted: boolean }>(
    `SELECT requester_id, accepted FROM friendships
      WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [a, b],
  );
  return row ? { requesterId: row.requester_id, accepted: row.accepted } : null;
}

// The player on the other side of a friendship from `$1`.
const OTHER_SIDE = 'CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END';

/**
 * A player's friends plus the requests they have sent and not had answered: what the limit on friends counts.
 * A deleted account's are not counted: nobody can see them to remove them.
 */
export async function friendsAndRequestsOf(tx: Queryable, userId: string): Promise<number> {
  const rows = await tx.query(
    `SELECT 1 FROM friendships f JOIN users u ON u.id = ${OTHER_SIDE} AND u.deleted_at IS NULL
      WHERE f.requester_id = $1 OR (f.addressee_id = $1 AND f.accepted)`,
    [userId],
  );
  return rows.length;
}

/** False for a player who has turned friend requests off. */
export async function allowsRequests(tx: Queryable, userId: string): Promise<boolean> {
  const rows = await tx.query<{ allow_requests: boolean }>('SELECT allow_requests FROM users WHERE id = $1', [userId]);
  return rows.some((row) => row.allow_requests);
}

export async function insertRequest(tx: Queryable, requesterId: string, addresseeId: string, now: number): Promise<void> {
  await tx.query('INSERT INTO friendships (requester_id, addressee_id, created_at) VALUES ($1, $2, $3::timestamptz)', [requesterId, addresseeId, toTs(now)]);
}

export async function acceptRequest(tx: Queryable, requesterId: string, addresseeId: string): Promise<void> {
  await tx.query('UPDATE friendships SET accepted = true WHERE requester_id = $1 AND addressee_id = $2', [requesterId, addresseeId]);
}

/** Removes whatever stands between two players, request or friendship. */
export async function deleteTie(tx: Queryable, a: string, b: string): Promise<void> {
  await tx.query('DELETE FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)', [a, b]);
}

export interface TieRow {
  username: string;
  country: string | null;
  /** When the other player's browser last said it was there. */
  lastSeenAt: number | null;
  /** True when the other player lets nobody be told when that was, only whether they are online. */
  hideLastSeen: boolean;
  xp: number;
  rating: number;
  accepted: boolean;
  /** True when the asker made the request. */
  mine: boolean;
  /** The code of the party lobby the other player is in, for a friend who is in one. */
  party: string | null;
}

/** Everyone the player is friends with or has a request to or from, by name. A deleted account is nobody's friend until it is restored. */
export async function tiesOf(q: Queryable, userId: string): Promise<TieRow[]> {
  const rows = await q.query<Omit<TieRow, 'lastSeenAt'> & { last_seen_at: unknown }>(
    `SELECT u.username, u.country, u.last_seen_at, u.hide_last_seen AS "hideLastSeen", u.xp, u.rating, f.accepted, (f.requester_id = $1) AS mine, m.code AS party
       FROM friendships f
       JOIN users u ON u.id = ${OTHER_SIDE} AND u.deleted_at IS NULL
       LEFT JOIN match_players p ON f.accepted AND p.user_id = u.id AND p.open
       LEFT JOIN matches m ON m.id = p.match_id AND m.phase = 'lobby'
      WHERE f.requester_id = $1 OR f.addressee_id = $1
      ORDER BY u.username`,
    [userId],
  );
  return rows.map(({ last_seen_at: seen, ...row }) => ({ ...row, lastSeenAt: seen === null ? null : fromTs(seen) }));
}

/** True when the player is in the lobby of the party with that code. */
export async function isInLobby(q: Queryable, userId: string, code: string): Promise<boolean> {
  const rows = await q.query(
    `SELECT 1 FROM match_players p JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = $1 AND p.open AND m.code = $2 AND m.phase = 'lobby'`,
    [userId, code],
  );
  return rows.length > 0;
}

/**
 * Records an invitation to a friend, replacing any earlier one from the same
 * player. False, storing nothing, when the two are not friends.
 */
export async function upsertInvite(q: Queryable, fromId: string, toId: string, code: string, now: number): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO party_invites (from_id, to_id, code, sent_at)
     SELECT $1, $2, $3, $4::timestamptz
      WHERE EXISTS (SELECT 1 FROM friendships f WHERE f.accepted
                     AND ((f.requester_id = $1 AND f.addressee_id = $2) OR (f.requester_id = $2 AND f.addressee_id = $1)))
     ON CONFLICT (from_id, to_id) DO UPDATE SET code = EXCLUDED.code, sent_at = EXCLUDED.sent_at
     RETURNING code`,
    [fromId, toId, code, toTs(now)],
  );
  return rows.length === 1;
}

/**
 * The invitations a player can still act on: sent since `since`, by someone
 * who is still their friend, to a party that is still in its lobby.
 */
export async function invitesFor(q: Queryable, userId: string, since: number): Promise<Array<{ from: string; code: string }>> {
  return q.query<{ from: string; code: string }>(
    `SELECT u.username AS "from", i.code
       FROM party_invites i
       JOIN users u ON u.id = i.from_id AND u.deleted_at IS NULL
       JOIN matches m ON m.code = i.code AND m.phase = 'lobby'
      WHERE i.to_id = $1 AND i.sent_at > $2::timestamptz
        AND EXISTS (SELECT 1 FROM friendships f WHERE f.accepted
                     AND ((f.requester_id = i.from_id AND f.addressee_id = $1) OR (f.requester_id = $1 AND f.addressee_id = i.from_id)))
      ORDER BY i.sent_at DESC, u.username`,
    [userId, toTs(since)],
  );
}

export async function deleteInvitesBefore(q: Queryable, before: number): Promise<void> {
  await q.query('DELETE FROM party_invites WHERE sent_at <= $1::timestamptz', [toTs(before)]);
}

export type Renamed = 'renamed' | 'taken' | 'refused';

const UNIQUE_VIOLATION = '23505';

/**
 * Changes a username, unless it was changed after `notSince`. One statement,
 * so of two players taking the same name at the same moment the database lets
 * exactly one through, and the other is told it is taken. 'refused' when the
 * account is gone, already has that name, or changed its name too recently.
 */
export async function rename(q: Queryable, userId: string, username: string, now: number, notSince: number): Promise<Renamed> {
  try {
    const rows = await q.query(
      `UPDATE users SET username = $2, renamed_at = $3::timestamptz
        WHERE id = $1 AND username <> $2 AND (renamed_at IS NULL OR renamed_at <= $4::timestamptz)
        RETURNING id`,
      [userId, username, toTs(now), toTs(notSince)],
    );
    return rows.length === 1 ? 'renamed' : 'refused';
  } catch (error) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
      return 'taken';
    }
    throw error;
  }
}
