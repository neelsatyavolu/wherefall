import type { Queryable } from './client.js';

/** The UTC day of a moment, as YYYY-MM-DD. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

// Every change to an account's XP or rating is one statement that also writes
// where the account now stands into that day's row, so the two cannot drift.
// The row records the account's place on each board as well: how many
// accounts on the board are ahead of it, plus one. Guests, banned and deleted
// accounts are on no board; an account with no rated game has no rating rank.
const ON_BOARD = 'NOT o.guest AND NOT o.banned AND o.deleted_at IS NULL AND o.id <> c.id';
// `gained` is the XP this change added, kept as the day's running sum.
const RECORD_DAY = `INSERT INTO progress_days (user_id, day, xp, rating, xp_gained, xp_rank, rating_rank)
   SELECT c.id, $3::text, c.xp, c.rating, c.gained,
          (SELECT count(*) FROM users o WHERE o.xp > c.xp AND ${ON_BOARD})::int + 1,
          CASE WHEN c.rated_games > 0
               THEN (SELECT count(*) FROM users o WHERE o.rated_games > 0 AND o.rating > c.rating AND ${ON_BOARD})::int + 1 END
     FROM changed c
   ON CONFLICT (user_id, day) DO UPDATE
     SET xp = EXCLUDED.xp, rating = EXCLUDED.rating, xp_gained = progress_days.xp_gained + EXCLUDED.xp_gained,
         xp_rank = EXCLUDED.xp_rank, rating_rank = EXCLUDED.rating_rank`;

/** Adds to an account's XP. A guest earns none. */
export async function addXp(tx: Queryable, userId: string, xp: number, now: number): Promise<void> {
  await tx.query(`WITH changed AS (UPDATE users SET xp = xp + $2 WHERE id = $1 AND NOT guest RETURNING id, xp, rating, rated_games, $2::int AS gained) ${RECORD_DAY}`, [userId, xp, utcDay(now)]);
}

/** The most XP an account can earn from solo play (games, the daily, runs) on one UTC day. */
export const SOLO_XP_PER_DAY = 20_000;

/**
 * Adds XP earned from solo play, as far as the day's cap allows, and answers
 * with how much was added: all of it, what was left under the cap, or 0. A
 * guest earns none. The day's count is on the account's own row and the row
 * is held while it is read and written, so two games saved at the same
 * moment cannot both be counted against the same room under the cap.
 */
export async function addSoloXp(tx: Queryable, userId: string, xp: number, now: number): Promise<number> {
  const [row] = await tx.query<{ gained: number }>(
    `WITH held AS (
       SELECT id, CASE WHEN solo_xp_day = $3 THEN solo_xp ELSE 0 END AS used FROM users WHERE id = $1 AND NOT guest FOR NO KEY UPDATE
     ), given AS (
       SELECT id, used, least($2::int, greatest(0, $4::int - used)) AS gained FROM held
     ), changed AS (
       UPDATE users u SET xp = u.xp + g.gained, solo_xp = g.used + g.gained, solo_xp_day = $3
         FROM given g WHERE u.id = g.id RETURNING u.id, u.xp, u.rating, u.rated_games, g.gained
     ), recorded AS (${RECORD_DAY})
     SELECT gained FROM changed`,
    [userId, xp, utcDay(now), SOLO_XP_PER_DAY],
  );
  return row?.gained ?? 0;
}

/** Sets a player's rating after a ranked duel, and counts the duel and how it went. */
export async function applyDuel(tx: Queryable, userId: string, rating: number, went: 'win' | 'loss' | 'tie', now: number): Promise<void> {
  const [won, lost, tied] = [went === 'win' ? 1 : 0, went === 'loss' ? 1 : 0, went === 'tie' ? 1 : 0];
  await tx.query(
    `WITH changed AS (
       UPDATE users SET rating = $2, rated_games = rated_games + 1,
              duel_wins = duel_wins + $4, duel_losses = duel_losses + $5, duel_ties = duel_ties + $6
        WHERE id = $1 RETURNING id, xp, rating, rated_games, 0 AS gained
     ) ${RECORD_DAY}`,
    [userId, rating, utcDay(now), won, lost, tied],
  );
}

/** Counts a finished 2v2 match on an account's record. */
export async function countTeamMatch(tx: Queryable, userId: string, went: 'win' | 'loss' | 'tie'): Promise<void> {
  const [won, lost, tied] = [went === 'win' ? 1 : 0, went === 'loss' ? 1 : 0, went === 'tie' ? 1 : 0];
  await tx.query('UPDATE users SET team_wins = team_wins + $2, team_losses = team_losses + $3, team_ties = team_ties + $4 WHERE id = $1', [userId, won, lost, tied]);
}

export interface ProgressDay {
  /** UTC, YYYY-MM-DD. */
  day: string;
  xp: number;
  rating: number;
}

/** Where the account stood at the end of each day it changed on, from `since` on, oldest first. */
export async function historyFor(q: Queryable, userId: string, since: string): Promise<ProgressDay[]> {
  return q.query<ProgressDay>('SELECT day, xp, rating FROM progress_days WHERE user_id = $1 AND day >= $2 ORDER BY day', [userId, since]);
}
