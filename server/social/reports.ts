import type { Db, Queryable } from '../db/client.js';
import { reportPlayer, reportsBy, type ReportStatus } from '../db/moderation.js';
import { userIdFor } from '../db/social.js';
import { accept, refuse, type Reply } from '../match/types.js';

/** What a report of a player can be about. */
export const REPORT_CATEGORIES = ['cheating', 'name', 'chat', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** How many of its own reports an account is shown, newest first. */
const REPORTS_SHOWN = 50;

/** An account's own reports of players, as its account pane lists them. */
export interface ReportsView {
  reports: Array<{
    username: string;
    category: string;
    note: string;
    /** ISO 8601: when the report was made, or last made again. */
    at: string;
    status: ReportStatus;
  }>;
}

/** Records one player's report of another. Made again, it replaces the earlier one and is open again. */
export async function report(db: Db, reporterId: string, username: string, about: { category: ReportCategory; note: string }, now: number): Promise<Reply<{ reported: true }>> {
  const targetId = await userIdFor(db, username);
  if (targetId === null) {
    return refuse(404, 'No player by that name.');
  }
  if (targetId === reporterId) {
    return refuse(400, 'You cannot report yourself.');
  }
  await reportPlayer(db, targetId, reporterId, about, now);
  return accept({ reported: true });
}

/** The reports an account has made, each with where it stands. Nobody else is shown them, and nobody is shown who reported them. */
export async function reportsView(q: Queryable, reporterId: string): Promise<ReportsView> {
  const reports = await reportsBy(q, reporterId, REPORTS_SHOWN);
  return { reports: reports.map((one) => ({ ...one, at: new Date(one.at).toISOString() })) };
}
