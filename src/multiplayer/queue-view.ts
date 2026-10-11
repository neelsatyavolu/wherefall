import { t, tn } from '../i18n/index.ts';
import { QUEUE_KINDS, type QueueKind } from './client.ts';
import { msUntil, secondsLeft } from './state.ts';

/** Pure reading of the queue: how long a player has waited, how long one usually waits, how long a lock has left, and how a match hands a player back to it. */

const MINUTE_SECONDS = 60;

/**
 * Why a player arrives at a queue pane already on their way in: `again` asks for the same kind of
 * match once more, `dodged` is a ranked player whose opponent left before the match began, and whom
 * the server has already queued, and `pair` is one of the two players of a party whose host queued
 * them for 2v2 together: the server has queued both.
 */
export const QUEUE_REASONS = ['again', 'dodged', 'pair'] as const;

/** The reasons a player arrives already in the queue: the pane then watches it without asking to join. */
export const isQueuedAlready = (reason: QueueReason | null): boolean => reason === 'dodged' || reason === 'pair';
export type QueueReason = (typeof QUEUE_REASONS)[number];

export interface QueueEntry {
  kind: QueueKind;
  reason: QueueReason;
}

/** What goes in the history entry of the pane the player is sent to. */
export const queueEntryState = (entry: QueueEntry) => ({ queue: entry });

const isOneOf = <T extends string>(all: readonly T[], value: unknown): value is T => all.includes(value as T);

/** Reads `queueEntryState` back for the pane of one kind. Null for anything else a history entry may hold. */
export function readQueueEntry(historyState: unknown, kind: QueueKind): QueueReason | null {
  const entry = typeof historyState === 'object' && historyState !== null ? (historyState as { queue?: unknown }).queue : null;
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { kind: queued, reason } = entry as { kind?: unknown; reason?: unknown };
  return isOneOf(QUEUE_KINDS, queued) && queued === kind && isOneOf(QUEUE_REASONS, reason) ? reason : null;
}

/** Whole seconds since the player joined the queue, on the server's clock. */
export function waitedSeconds(since: string | null, serverNowMs: number): number {
  const joined = since === null ? Number.NaN : Date.parse(since);
  return Number.isNaN(joined) ? 0 : Math.max(0, Math.floor((serverNowMs - joined) / 1000));
}

/** Seconds until a ranked lock ends, a started one counting whole. Zero with no lock. */
export const lockSeconds = (lockedUntil: string | null, serverNowMs: number): number => secondsLeft(msUntil(lockedUntil, serverNowMs));

/**
 * How long players usually wait in a queue, in words, from the median the server gives in seconds:
 * "usually under a minute" below a minute, "about 3 minutes" from there on, to the nearest minute,
 * and "no recent games" when no match was found in that queue in the last 24 hours (null).
 */
export function typicalWait(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) {
    return t('queue.typical.none');
  }
  return seconds < MINUTE_SECONDS ? t('queue.typical.underMinute') : tn('queue.typical.minutes', Math.round(seconds / MINUTE_SECONDS));
}
