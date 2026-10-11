import { z } from 'zod';
import { RESTORE_WINDOW_MS, changePassword, deleteAccount, issueRecoveryCode } from '../account/accounts.js';
import { SIGN_IN_FIRST, accountSession, noAccount, noSession, playerIn } from '../account/identity.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, countrySchema, givenPasswordSchema, newPasswordSchema } from '../account/input.js';
import { verifyPassword } from '../account/password.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { changeSettings, endSessions, getUser, setCountry, type User } from '../db/users.js';
import { fail, ok, readBody, sameOrigin } from '../http.js';
import type { Context } from '../serve.js';
import { isModerator } from '../social/moderation.js';

const HOUR_MS = 60 * 60_000;
// Everything that checks the account's password from inside a session shares these tries, so a session
// in the wrong hands cannot guess at the password through one action after running out on another.
const PASSWORD_TRIES_PER_HOUR = 10;
const TOO_MANY_TRIES = 'Too many tries at your password in the last hour. Try again later.';
const NOT_YOUR_PASSWORD = 'That is not your current password.';
// What needs no password is still not to be sent without end: more than anyone changing their mind would send.
const CHANGES_PER_HOUR = 120;
const SLOW_DOWN = 'Too many requests. Slow down a little.';

const ACTIONS = ['password', 'delete', 'country', 'settings', 'recoveryCode', 'signOutEverywhere'] as const;
type Action = (typeof ACTIONS)[number];

const actionNameSchema = z.looseObject({ action: z.enum(ACTIONS) });
const currentPasswordSchema = z.looseObject({ current: givenPasswordSchema });
const nextPasswordSchema = z.looseObject({ next: newPasswordSchema });
const passwordGivenSchema = z.looseObject({ password: givenPasswordSchema });
const countryChangeSchema = z.looseObject({ country: countrySchema.nullable() });
const settingsSchema = z.looseObject({ allowFriendRequests: z.boolean().optional(), hideChat: z.boolean().optional(), hideLastSeen: z.boolean().optional() });

type Handler = (body: unknown, user: User, request: Request, context: Context) => Promise<Response>;

/** False once the account has used up the hour's tries at its own password. */
const mayTryPassword = (user: User, { db, now }: Context): Promise<boolean> =>
  hitRateLimit(db, `account-password:${user.id}`, PASSWORD_TRIES_PER_HOUR, HOUR_MS, now);

/** False once the account has made this change too often in the hour. */
const mayChange = (action: Action, user: User, { db, now }: Context): Promise<boolean> =>
  hitRateLimit(db, `account-${action}:${user.id}`, CHANGES_PER_HOUR, HOUR_MS, now);

const newPassword: Handler = async (body, user, request, context) => {
  if (!(await mayTryPassword(user, context))) {
    return fail(TOO_MANY_TRIES, 429);
  }
  const next = nextPasswordSchema.safeParse(body);
  if (!next.success) {
    return fail(`Choose a new password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`, 400);
  }
  const current = currentPasswordSchema.safeParse(body);
  const version = current.success ? await changePassword(context.db, user, current.data.current, next.data.next) : null;
  // The new password ended every session; this browser is given a new one.
  return version === null ? fail(NOT_YOUR_PASSWORD, 403) : ok({ changed: true }, 200, accountSession(user.id, version, request, context));
};

const removeAccount: Handler = async (body, user, request, context) => {
  // Moderators are known by their usernames. One who deleted their account
  // would leave the name for anyone to take in 30 days, and with it the right to moderate.
  if (isModerator(context.moderators, user.username)) {
    return fail("A moderator's account cannot be deleted.", 409);
  }
  if (!(await mayTryPassword(user, context))) {
    return fail(TOO_MANY_TRIES, 429);
  }
  const given = passwordGivenSchema.safeParse(body);
  if (!given.success || !(await verifyPassword(given.data.password, user.passwordHash))) {
    return fail(NOT_YOUR_PASSWORD, 403);
  }
  const { db, now } = context;
  if (!(await deleteAccount(db, user.id, now))) {
    return fail(SIGN_IN_FIRST, 401);
  }
  return ok({ deleted: true, restoreUntil: new Date(now + RESTORE_WINDOW_MS).toISOString() }, 200, noSession(request));
};

/** A new recovery code in place of the one there was, for whoever has the password. It is answered once and never again. */
const newRecoveryCode: Handler = async (body, user, _request, context) => {
  if (!(await mayTryPassword(user, context))) {
    return fail(TOO_MANY_TRIES, 429);
  }
  const given = passwordGivenSchema.safeParse(body);
  const recoveryCode = given.success ? await issueRecoveryCode(context.db, user, given.data.password) : null;
  return recoveryCode === null ? fail(NOT_YOUR_PASSWORD, 403) : ok({ recoveryCode });
};

/** Ends every session of the account, this browser's with them. */
const signOutEverywhere: Handler = async (_body, user, request, { db }) =>
  (await endSessions(db, user.id)) === null ? fail(SIGN_IN_FIRST, 401) : ok({ signedOut: true }, 200, noSession(request));

const newCountry: Handler = async (body, user, _request, context) => {
  if (!(await mayChange('country', user, context))) {
    return fail(SLOW_DOWN, 429);
  }
  const chosen = countryChangeSchema.safeParse(body);
  if (!chosen.success) {
    return fail('Choose a country by its two-letter code, or none.', 400);
  }
  const { country } = chosen.data;
  return (await setCountry(context.db, user.id, country)) ? ok({ country }) : fail(SIGN_IN_FIRST, 401);
};

const newSettings: Handler = async (body, user, _request, context) => {
  if (!(await mayChange('settings', user, context))) {
    return fail(SLOW_DOWN, 429);
  }
  const chosen = settingsSchema.safeParse(body);
  if (!chosen.success) {
    return fail('A setting is either on or off.', 400);
  }
  const { allowFriendRequests, hideChat, hideLastSeen } = chosen.data;
  const settings = await changeSettings(context.db, user.id, { allowRequests: allowFriendRequests, hideChat, hideLastSeen });
  return settings
    ? ok({ allowFriendRequests: settings.allowRequests, hideChat: settings.hideChat, hideLastSeen: settings.hideLastSeen })
    : fail(SIGN_IN_FIRST, 401);
};

const HANDLERS: Record<Action, Handler> = {
  password: newPassword,
  delete: removeAccount,
  country: newCountry,
  settings: newSettings,
  recoveryCode: newRecoveryCode,
  signOutEverywhere,
};

/** What a player changes about their own account: `{ action, ... }`. */
export async function accountPost(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  const body = await readBody(request, actionNameSchema);
  if (!body) {
    return fail('That is not something that can be asked here.', 400);
  }
  const user = await getUser(context.db, player.userId);
  // A session outlives the account it was for: one that is gone or deleted is nobody's.
  return user && !user.guest ? HANDLERS[body.action](body, user, request, context) : fail(SIGN_IN_FIRST, 401);
}
