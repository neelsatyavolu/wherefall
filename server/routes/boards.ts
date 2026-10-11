import { z } from 'zod';
import { accountIn } from '../account/identity.js';
import { leagueFor, levelFor } from '../account/progress.js';
import { BOARDS, PERIODS, leaderboardRows } from '../db/social.js';
import { fail, ok } from '../http.js';
import type { Context } from '../serve.js';

const BOARD_SIZE = 100;
/** The one value of `inactive` that asks for the accounts nobody has seen lately as well. */
const SHOW_INACTIVE = '1';

/**
 * `?leaderboard=<board>&period=<all|day>&inactive=1`: the top of a board and
 * the asker's own place on it. The reply says whether inactive accounts were
 * ranked, which is never so for the day's board: everyone on that played today.
 */
export async function leaderboard(params: URLSearchParams, request: Request, context: Context): Promise<Response> {
  const board = z.enum(BOARDS).safeParse(params.get('leaderboard'));
  if (!board.success) {
    return fail('There is a leaderboard for rating, for xp and for streak.', 400);
  }
  const period = z.enum(PERIODS).safeParse(params.get('period') ?? 'all');
  if (!period.success) {
    return fail('Ask for a period of all or day.', 400);
  }
  const inactive = period.data === 'all' && params.get('inactive') === SHOW_INACTIVE;
  const viewerId = (await accountIn(request, context))?.userId ?? null;
  const rows = await leaderboardRows(context.db, { board: board.data, period: period.data, viewerId, limit: BOARD_SIZE, inactive }, context.now);
  const mine = rows.find((row) => row.you);
  return ok({
    board: board.data,
    period: period.data,
    inactive,
    entries: rows
      .filter((row) => !row.you)
      .map((row) => ({ rank: row.rank, username: row.username, country: row.country, value: row.value, level: levelFor(row.xp), league: leagueFor(row.rating) })),
    you: mine ? { rank: mine.rank, value: mine.value } : null,
  });
}
