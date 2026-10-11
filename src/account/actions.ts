import { z } from 'zod';
import { call, countrySchema, post, type Result } from './client.ts';

/** What a signed-in player can change about their own account: `POST /api/account`. Guests are refused. */

const ACCOUNT = '/api/account';

export const PASSWORD_LIMITS = { min: 8, max: 200 } as const;
/** the longest email address the server takes */
export const EMAIL_LIMITS = { max: 254 } as const;

const changedSchema = z.object({ changed: z.literal(true) });
const deletedSchema = z.object({ deleted: z.literal(true), /** ISO 8601: the account can be restored until then */ restoreUntil: z.string() });
const countryReplySchema = z.object({ country: countrySchema });
const settingsSchema = z.object({ allowFriendRequests: z.boolean(), hideChat: z.boolean(), hideLastSeen: z.boolean() });
const recoveryCodeSchema = z.object({ recoveryCode: z.string() });
const signedOutSchema = z.object({ signedOut: z.literal(true) });
const emailReplySchema = z.object({ email: z.string() });

export type AccountSettings = z.infer<typeof settingsSchema>;
export type DeletedAccount = z.infer<typeof deletedSchema>;

type Reply<T> = Promise<Result<T>>;

/**
 * Changes the password: `next` is 8 to 200 characters. This browser stays signed in (the reply sets
 * it a new session); every other browser is signed out. Ten tries an hour, shared with
 * `deleteAccount` and `issueRecoveryCode`.
 */
export function changePassword(current: string, next: string, fetchFn: typeof fetch = fetch): Reply<{ changed: true }> {
  return call(fetchFn, ACCOUNT, changedSchema, post({ action: 'password', current, next }));
}

/**
 * Deletes the account and signs this browser out. It leaves its queue and its match, and can be
 * restored by signing in until `restoreUntil`, 30 days on.
 */
export function deleteAccount(password: string, fetchFn: typeof fetch = fetch): Reply<DeletedAccount> {
  return call(fetchFn, ACCOUNT, deletedSchema, post({ action: 'delete', password }));
}

/** Sets the country shown as a flag beside the player's name: a two-letter code, or null for none. */
export function setCountry(country: string | null, fetchFn: typeof fetch = fetch): Reply<{ country: string | null }> {
  return call(fetchFn, ACCOUNT, countryReplySchema, post({ action: 'country', country }));
}

/**
 * Turns friend requests, hidden chat or a hidden "last seen" on or off. Answers with all three
 * switches as they now are. 120 changes an hour, then `REFUSALS.slowDown`; so too for `setCountry`.
 */
export function saveAccountSettings(settings: Partial<AccountSettings>, fetchFn: typeof fetch = fetch): Reply<AccountSettings> {
  return call(fetchFn, ACCOUNT, settingsSchema, post({ action: 'settings', ...settings }));
}

/**
 * Makes a new recovery code (`K7QM-2XHD-9RWP`), which replaces any earlier one. It is sent this
 * once: show it now. A wrong password is 403 "That is not your current password.".
 */
export function issueRecoveryCode(password: string, fetchFn: typeof fetch = fetch): Reply<{ recoveryCode: string }> {
  return call(fetchFn, ACCOUNT, recoveryCodeSchema, post({ action: 'recoveryCode', password }));
}

/** Signs the account out of every browser, this one too. `logout` in `client.ts` signs out this browser only. */
export function signOutEverywhere(fetchFn: typeof fetch = fetch): Reply<{ signedOut: true }> {
  return call(fetchFn, ACCOUNT, signedOutSchema, post({ action: 'signOutEverywhere' }));
}

/**
 * Sets the email reset links are sent to; the answer is the address as stored, trimmed and in lower
 * case. An account that has none needs no password for it. One that has an email gives its current
 * password, out of the same ten tries an hour as `changePassword`: 403 "That is not your current
 * password." without it. 409 when another account has the address.
 */
export function setEmail(email: string, password?: string, fetchFn: typeof fetch = fetch): Reply<{ email: string }> {
  return call(fetchFn, ACCOUNT, emailReplySchema, post({ action: 'email', email, ...(password === undefined ? {} : { password }) }));
}
