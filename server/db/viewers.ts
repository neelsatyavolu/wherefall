import type { Queryable } from './client.js';

/**
 * Gives out one more Google viewer on a UTC day (YYYY-MM-DD) unless `ceiling`
 * of them are gone already. Answers with how many that makes, or null when
 * the request got none. The ceiling is the asker's own: the whole day's
 * allowance for an account, less for anyone else. A request that gets none
 * is not counted, so those who may only have part of the allowance cannot
 * eat into the rest by asking.
 *
 * One statement, and the day's row is held while it is read and raised, so
 * of any number of requests arriving together exactly as many get a viewer
 * as there were left under their ceiling.
 */
export async function countViewer(q: Queryable, day: string, ceiling: number): Promise<number | null> {
  const [row] = await q.query<{ used: number }>(
    `INSERT INTO viewer_days (day, used) SELECT $1::text, 1 WHERE $2::int > 0
     ON CONFLICT (day) DO UPDATE SET used = viewer_days.used + 1 WHERE viewer_days.used < $2::int
     RETURNING used`,
    [day, ceiling],
  );
  return row?.used ?? null;
}

/** How many of a day's viewers have been given out. */
export async function viewersUsed(q: Queryable, day: string): Promise<number> {
  const [row] = await q.query<{ used: number }>('SELECT used FROM viewer_days WHERE day = $1', [day]);
  return row?.used ?? 0;
}
