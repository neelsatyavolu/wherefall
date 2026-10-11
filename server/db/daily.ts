import type { Queryable } from './client.js';
import { fromTs, toTs } from './time.js';

// Whose results make up a day's board: guests, banned and deleted accounts are on none.
const ON_BOARD = 'NOT u.banned AND NOT u.guest AND u.deleted_at IS NULL';

export interface BoardRow {
  username: string;
  country: string | null;
  score: number;
}

/** One stretch of a day's board, best first; among equal scores, whoever got there first. */
export async function dailyLeaderboard(q: Queryable, date: string, limit: number, offset: number): Promise<BoardRow[]> {
  return q.query<BoardRow>(
    `SELECT u.username, u.country, g.score FROM games g JOIN users u ON u.id = g.user_id
      WHERE g.daily = $1 AND ${ON_BOARD} ORDER BY g.score DESC, g.played_at ASC, g.id ASC LIMIT $2 OFFSET $3`,
    [date, limit, offset],
  );
}

/** How many of a day's results fall in each of `bands` bands `width` points wide. The last band also takes whatever is above it. */
export async function dailyDistribution(q: Queryable, date: string, width: number, bands: number): Promise<number[]> {
  const rows = await q.query<{ band: number; players: number }>(
    `SELECT least(g.score / $2::integer, $3::integer - 1) AS band, count(*)::int AS players
       FROM games g JOIN users u ON u.id = g.user_id
      WHERE g.daily = $1 AND ${ON_BOARD} GROUP BY 1`,
    [date, width, bands],
  );
  return Array.from({ length: bands }, (_unused, band) => rows.find((row) => row.band === band)?.players ?? 0);
}

export interface DailyResult {
  /** The UTC day, YYYY-MM-DD. */
  date: string;
  score: number;
  maxScore: number;
}

/** Every daily result an account has, oldest first, and whether it has begun the challenge of `today`. One query. */
export async function dailiesOf(q: Queryable, userId: string, today: string): Promise<{ results: DailyResult[]; begun: boolean }> {
  const [row] = await q.query<{ results: DailyResult[]; begun: boolean }>(
    `SELECT (SELECT coalesce(jsonb_agg(jsonb_build_object('date', daily, 'score', score, 'maxScore', max_score) ORDER BY daily), '[]'::jsonb)
               FROM games WHERE user_id = $1 AND daily IS NOT NULL) AS results,
            EXISTS (SELECT 1 FROM daily_attempts WHERE user_id = $1 AND day = $2) AS begun`,
    [userId, today],
  );
  return row ?? { results: [], begun: false };
}

export interface Standing {
  score: number;
  maxScore: number;
  /** The score of each round, in order. */
  rounds: number[];
  /** The account's place on the day's board, or the place it would have were it on it. */
  rank: number;
  /** How many others are on the day's board, and how many of them scored lower. */
  others: number;
  lower: number;
  /** The day's mean score for each round, rounded, over `finished` results: the board's, and the account's own. */
  averages: number[];
  finished: number;
  /** True when the account has an earlier daily and this total is higher than every one of them. */
  personalBest: boolean;
}

// The results a day's averages are taken over: everyone's on the board, and the asker's own whether or not it is.
// Only results out of the same maximum: the daily was once five rounds, and those do not compare.
const AVERAGED = `o.daily = g.daily AND o.max_score = g.max_score AND (o.user_id = g.user_id OR (${ON_BOARD}))`;
// The account's dailies of earlier days, by the day they were the challenge of, whenever they were saved.
const EARLIER = 'e.user_id = g.user_id AND e.daily < g.daily AND e.max_score = g.max_score';

/** Where an account's result stands among everyone else's on a day. Null when it has not played that day. One query. */
export async function dailyStanding(q: Queryable, userId: string, date: string): Promise<Standing | null> {
  // "Ahead" is by the board's own order, so the rank is the row the account has, or would have, on the board.
  const [row] = await q.query<Standing>(
    `SELECT g.score, g.max_score AS "maxScore",
            (SELECT coalesce(jsonb_agg(r.score ORDER BY r.round), '[]'::jsonb) FROM game_rounds r WHERE r.game_id = g.id) AS rounds,
            s.ahead + 1 AS rank, s.others, s.lower,
            (SELECT coalesce(jsonb_agg(a.mean ORDER BY a.round), '[]'::jsonb)
               FROM (SELECT r.round, round(avg(r.score))::int AS mean
                       FROM games o JOIN users u ON u.id = o.user_id JOIN game_rounds r ON r.game_id = o.id
                      WHERE ${AVERAGED} GROUP BY r.round) a) AS averages,
            (SELECT count(*)::int FROM games o JOIN users u ON u.id = o.user_id WHERE ${AVERAGED}) AS finished,
            (EXISTS (SELECT 1 FROM games e WHERE ${EARLIER})
             AND NOT EXISTS (SELECT 1 FROM games e WHERE ${EARLIER} AND e.score >= g.score)) AS "personalBest"
       FROM games g,
            LATERAL (SELECT (count(*) FILTER (WHERE o.score > g.score OR (o.score = g.score AND (o.played_at, o.id) < (g.played_at, g.id))))::int AS ahead,
                            (count(*) FILTER (WHERE o.score < g.score))::int AS lower,
                            count(*)::int AS others
                       FROM games o JOIN users u ON u.id = o.user_id
                      WHERE o.daily = g.daily AND o.user_id <> g.user_id AND ${ON_BOARD}) s
      WHERE g.user_id = $1 AND g.daily = $2`,
    [userId, date],
  );
  return row ?? null;
}

/**
 * Marks an account's one attempt at a day's challenge as begun, and says
 * whether it already has a result for that day. Beginning twice changes
 * nothing. One statement, so two requests at once leave one attempt. Null
 * when there is no such account.
 */
export async function beginDaily(q: Queryable, userId: string, day: string, now: number): Promise<{ done: boolean } | null> {
  const [row] = await q.query<{ done: boolean }>(
    `WITH begun AS (
       INSERT INTO daily_attempts (user_id, day, started_at)
       SELECT id, $2::text, $3::timestamptz FROM users WHERE id = $1 AND NOT guest
       ON CONFLICT (user_id, day) DO NOTHING)
     SELECT EXISTS (SELECT 1 FROM games g WHERE g.user_id = u.id AND g.daily = $2::text) AS done
       FROM users u WHERE u.id = $1 AND NOT u.guest`,
    [userId, day, toTs(now)],
  );
  return row ?? null;
}

/** When an account began a day's challenge, in epoch milliseconds. Null when it has not. */
export async function dailyBegunAt(q: Queryable, userId: string, day: string): Promise<number | null> {
  const [row] = await q.query<{ started_at: unknown }>('SELECT started_at FROM daily_attempts WHERE user_id = $1 AND day = $2', [userId, day]);
  return row ? fromTs(row.started_at) : null;
}

/**
 * Holds an account's row for the rest of the transaction, so that whatever
 * is saved for it takes turns, and says when the account was made, in epoch
 * milliseconds. Null when there is no such account.
 */
export async function lockAccount(tx: Queryable, userId: string): Promise<number | null> {
  const [row] = await tx.query<{ created_at: unknown }>('SELECT created_at FROM users WHERE id = $1 AND NOT guest FOR UPDATE', [userId]);
  return row ? fromTs(row.created_at) : null;
}

/** Which of these days the account already has a daily result for. */
export async function dailiesPlayed(q: Queryable, userId: string, days: readonly string[]): Promise<Set<string>> {
  const rows = await q.query<{ daily: string }>('SELECT daily FROM games WHERE user_id = $1 AND daily = ANY($2::text[])', [userId, [...days]]);
  return new Set(rows.map((row) => row.daily));
}
