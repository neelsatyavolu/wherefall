import { sign, verify } from '../account/session.js';
import { dailyDate } from './daily.js';

/**
 * A visitor has no account for the server to mark the daily as begun on, so
 * a visitor's start is answered with a signed note of when it was. The
 * browser keeps it with the result it stores, and sends it when an account
 * made later claims that result.
 */

// Its own prefix, so this token is never taken for a session or for a run's, nor either of those for it.
const PREFIX = 'daily.';

/** The token a visitor's start of the daily is answered with. */
export const visitorStartToken = (now: number, secret: Buffer): string => sign(`${PREFIX}${now}`, secret);

/** The UTC day (YYYY-MM-DD) a visitor's start was on, or null when the token is not one this server made for a start. */
export function visitorStartDay(token: string, secret: Buffer): string | null {
  const value = verify(token, secret);
  if (!value?.startsWith(PREFIX)) {
    return null;
  }
  const startedAt = Number(value.slice(PREFIX.length));
  return Number.isSafeInteger(startedAt) ? dailyDate(startedAt) : null;
}
