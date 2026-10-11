import { z } from 'zod';
import { purgeDeleted, recover, signIn } from '../account/accounts.js';
import { accountSession } from '../account/identity.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, loginSchema, newPasswordSchema, recoveryClaimSchema } from '../account/input.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { restoreUser } from '../db/users.js';
import { clientIp, fail, hashIp, ok, readBody, sameOrigin } from '../http.js';
import type { Context } from '../serve.js';

const LOGIN_WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_ADDRESS = 10;
// Slows guessing spread over many addresses. Set above the per-address limit,
// so it takes several addresses to lock an account's owner out for the window.
const ATTEMPTS_PER_USERNAME = 30;
export const LOCKED = 'Too many attempts. Try again in 15 minutes.';
// One answer for every failed sign-in, so it never says whether the username exists.
const WRONG_CREDENTIALS = 'Wrong username or password.';
// And one for every failed recovery: an unknown name, an account with no code, a wrong code.
const WRONG_RECOVERY = 'Wrong username or recovery code.';
export const NEW_PASSWORD_RULE = `Choose a new password of ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;
const DELETED = 'This account was deleted. Restore it to sign in.';

const newPasswordGivenSchema = z.looseObject({ newPassword: newPasswordSchema });

/** True for a body that asks to be let in by recovery code. Which it is goes by the field being there, so a code that is not one still gets the answer about codes. */
const isRecovery = (sent: unknown): boolean => typeof sent === 'object' && sent !== null && 'recoveryCode' in sent;

/** False once this username has been tried too often, by password or by code, from anywhere. */
const mayTryUsername = (username: string, { db, now }: Context): Promise<boolean> =>
  hitRateLimit(db, `account-login-username:${username}`, ATTEMPTS_PER_USERNAME, LOGIN_WINDOW_MS, now);

async function withPassword(sent: unknown, request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const body = loginSchema.safeParse(sent);
  if (!body.success) {
    return fail(WRONG_CREDENTIALS, 401);
  }
  const { username } = body.data;
  if (!(await mayTryUsername(username, context))) {
    return fail(LOCKED, 429);
  }
  await purgeDeleted(db, now);
  const user = await signIn(db, body.data);
  if (!user) {
    return fail(WRONG_CREDENTIALS, 401);
  }
  // Only someone with the password is told the account was deleted, and only they can bring it back.
  if (user.deletedAt !== null) {
    if (!body.data.restore) {
      return fail(DELETED, 409);
    }
    if (!(await restoreUser(db, user.id))) {
      return fail(WRONG_CREDENTIALS, 401);
    }
  }
  return ok({ username }, 200, accountSession(user.id, user.sessionVersion, request, context));
}

/**
 * Forgot password: the username, its recovery code and a new password. The
 * new password is looked at before the code, and a try that gets as far as
 * the code counts against the username like a try at its password.
 */
async function withRecoveryCode(sent: unknown, request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const chosen = newPasswordGivenSchema.safeParse(sent);
  if (!chosen.success) {
    return fail(NEW_PASSWORD_RULE, 400);
  }
  const claim = recoveryClaimSchema.safeParse(sent);
  if (!claim.success) {
    return fail(WRONG_RECOVERY, 401);
  }
  const { username, recoveryCode, restore } = claim.data;
  if (!(await mayTryUsername(username, context))) {
    return fail(LOCKED, 429);
  }
  await purgeDeleted(db, now);
  const outcome = await recover(db, { username, recoveryCode, newPassword: chosen.data.newPassword, restore });
  if (!outcome.recovered) {
    return outcome.reason === 'deleted' ? fail(DELETED, 409) : fail(WRONG_RECOVERY, 401);
  }
  // The code ended every session there was; this browser is given the one new one.
  return ok({ username, recoveryCode: outcome.recoveryCode }, 200, accountSession(outcome.userId, outcome.sessionVersion, request, context));
}

/** Signing in: with the password, or, having forgotten it, with the recovery code and a new one. Both count against the same limits. */
export async function login(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const { db, now } = context;
  const address = hashIp(clientIp(request), context.secret);
  if (!(await hitRateLimit(db, `account-login:${address}`, ATTEMPTS_PER_ADDRESS, LOGIN_WINDOW_MS, now))) {
    return fail(LOCKED, 429);
  }
  const sent = await readBody(request, z.unknown());
  return isRecovery(sent) ? withRecoveryCode(sent, request, context) : withPassword(sent, request, context);
}
