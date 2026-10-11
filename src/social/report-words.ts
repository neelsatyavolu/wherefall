import { t, type Key } from '../i18n/index.ts';
import { REPORT_CATEGORIES, type ReportCategory, type ReportStatus } from './client.ts';

/** A report of a player in words: what it is about, and where it stands. */

const CATEGORY_KEYS: Record<ReportCategory, Key> = {
  cheating: 'report.category.cheating',
  name: 'report.category.offensiveName',
  chat: 'report.category.offensiveChat',
  other: 'report.category.other',
};

const STATUS_KEYS: Record<ReportStatus, Key> = {
  open: 'report.status.open',
  actioned: 'report.status.actioned',
  dismissed: 'report.status.dismissed',
};

const isCategory = (category: string): category is ReportCategory => (REPORT_CATEGORIES as readonly string[]).includes(category);

/** What a report is about, by name. The server sends the category as text: one this page does not know is "Other". */
export const reportCategoryName = (category: string): string => t(CATEGORY_KEYS[isCategory(category) ? category : 'other']);

/** The categories a report can be given, in the server's order, each with its name: the choices of a report form. */
export const reportCategoryChoices = (): Array<{ value: ReportCategory; name: string }> => REPORT_CATEGORIES.map((value) => ({ value, name: reportCategoryName(value) }));

/** Where a report stands: open, action taken (the player was banned) or dismissed. */
export const reportStatusName = (status: ReportStatus): string => t(STATUS_KEYS[status]);

/** How a status is marked beside its word: still waiting, acted on, or closed with nothing done. */
export const reportStatusTone = (status: ReportStatus): 'live' | 'ok' | 'idle' => (status === 'open' ? 'live' : status === 'actioned' ? 'ok' : 'idle');
