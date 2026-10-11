import { z } from 'zod';
import type { Language } from '../i18n/index.ts';
import { call, post, type Result } from './client.ts';

/** Forgot password, by email: `POST /api/account/reset`. Neither call needs a session. */

const RESET = '/api/account/reset';

const requestedSchema = z.object({ requested: z.literal(true) });
const usernameSchema = z.object({ username: z.string() });

/**
 * Asks for a reset link to be sent to the account that has this email, written in `lang`. The
 * answer is the same whether or not any account has it, so it says nothing about who has an account.
 * Refused with 400 for what is not an address, 429 after five requests in 15 minutes, and 502 "The
 * email could not be sent. Try again later.".
 */
export function requestPasswordReset(email: string, lang: Language, fetchFn: typeof fetch = fetch): Promise<Result<{ requested: true }>> {
  return call(fetchFn, RESET, requestedSchema, post({ action: 'request', email, lang }));
}

/**
 * Uses a reset link: sets the new password (8 to 200 characters) and signs this browser in; every
 * other browser is signed out. A link works once, for an hour: one that is used, old or unknown is
 * 400 "This reset link is not valid or has expired. Ask for a new one.". The password is looked at
 * first, so one that will not do leaves the link good.
 */
export function completePasswordReset(token: string, password: string, fetchFn: typeof fetch = fetch): Promise<Result<{ username: string }>> {
  return call(fetchFn, RESET, usernameSchema, post({ action: 'complete', token, password }));
}
