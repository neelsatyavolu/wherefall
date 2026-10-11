import { z } from 'zod';
import { accountSession } from '../account/identity.js';
import { EMAIL_RULE, emailSchema, newPasswordSchema } from '../account/input.js';
import { beginReset, finishReset, hashEmail, resetTokenSchema } from '../account/reset.js';
import { deleteResetTokensOf } from '../db/password-resets.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { findUserByEmail, type User } from '../db/users.js';
import { clientIp, fail, hashIp, ok, readBody, sameOrigin } from '../http.js';
import { mailLanguageSchema, resetEmail, type MailLanguage } from '../mail/copy.js';
import { renderEmail } from '../mail/template.js';
import type { Context } from '../serve.js';
import { LOCKED, NEW_PASSWORD_RULE } from './sign-in.js';

// Forgot password, by email: a visitor asks for a link to be sent to an account's address, and
// whoever opens the link chooses a new password. Neither half needs a session.

const MINUTE_MS = 60_000;
const WINDOW_MS = 15 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const REQUESTS_PER_ADDRESS = 5;
const COMPLETIONS_PER_ADDRESS = 10;
/** How many links one email address is sent in an hour, whoever asks. */
const EMAILS_PER_EMAIL = 3;
/** How many reset emails the whole site sends in a day: what a flood of requests can cost. */
const EMAILS_PER_DAY = 50;

// One answer whether or not an account has the address, so asking never says which addresses have accounts.
const REQUESTED = { requested: true };
const NOT_SENT = 'The email could not be sent. Try again later.';
// And one for every link that cannot be used: never made, used already, or over its hour.
const BAD_LINK = 'This reset link is not valid or has expired. Ask for a new one.';

const ACTIONS = ['request', 'complete'] as const;
type Action = (typeof ACTIONS)[number];

const actionNameSchema = z.looseObject({ action: z.enum(ACTIONS) });
const requestSchema = z.looseObject({ email: emailSchema, lang: mailLanguageSchema });
const passwordChosenSchema = z.looseObject({ password: newPasswordSchema });
const tokenGivenSchema = z.looseObject({ token: resetTokenSchema });

type Handler = (body: unknown, request: Request, context: Context) => Promise<Response>;

/** False once this network has asked for `what` too often in the last 15 minutes. */
const mayAsk = (what: Action, limit: number, request: Request, { db, now, secret }: Context): Promise<boolean> =>
  hitRateLimit(db, `reset-${what}:${hashIp(clientIp(request), secret)}`, limit, WINDOW_MS, now);

/** The link an email carries. It is built on the address the server was told is its own, never on anything a request says. */
function resetLink(token: string, { appUrl }: Context): string {
  if (!appUrl) {
    throw new Error('APP_URL is not set, so a reset link has nowhere to point');
  }
  return `${appUrl}/?reset=${token}`;
}

/**
 * Sends one account its reset link, in the language asked for. False when
 * the email could not be sent, and the link, which nobody has, is then ended.
 * Where no email can be sent at all, which is a developer's own machine, the
 * link is written to the server log instead.
 */
async function sendLink(user: User, email: string, lang: MailLanguage, context: Context): Promise<boolean> {
  const { db, now, sendMail } = context;
  const link = resetLink(await beginReset(db, user.id, now), context);
  if (!sendMail) {
    console.info(`[plonk] no RESEND_API_KEY, so no email was sent. Password reset link for ${user.username}: ${link}`);
    return true;
  }
  try {
    await sendMail({ to: email, ...renderEmail(resetEmail(lang, user.username, link)) });
    return true;
  } catch (error) {
    // Only what went wrong: the link and the address stay out of the log.
    console.error('[plonk] reset email not sent:', error instanceof Error ? error.message : 'unknown error');
    await deleteResetTokensOf(db, user.id);
    return false;
  }
}

/**
 * `{ email, lang }`: sends the account that has the address a link to choose
 * a new password with. An address nobody has, a deleted account's, and one
 * that has been sent its three for the hour are all answered as a link sent
 * is. The limit on an address is counted for every address, known or not,
 * and by a keyed hash of it.
 */
const requestLink: Handler = async (body, request, context) => {
  const { db, now, secret } = context;
  if (!(await mayAsk('request', REQUESTS_PER_ADDRESS, request, context))) {
    return fail(LOCKED, 429);
  }
  const asked = requestSchema.safeParse(body);
  if (!asked.success) {
    return fail(EMAIL_RULE, 400);
  }
  const { email, lang } = asked.data;
  if (!(await hitRateLimit(db, `reset-email:${hashEmail(email, secret)}`, EMAILS_PER_EMAIL, HOUR_MS, now))) {
    return ok(REQUESTED);
  }
  const user = await findUserByEmail(db, email);
  // Counted only when there is an email to send, so requests for addresses nobody has cannot use the day up.
  if (!user || !(await hitRateLimit(db, 'reset-emails', EMAILS_PER_DAY, DAY_MS, now))) {
    return ok(REQUESTED);
  }
  return (await sendLink(user, email, lang, context)) ? ok(REQUESTED) : fail(NOT_SENT, 502);
};

/**
 * `{ token, password }`: the link's token and a new password. The password is
 * looked at first, so one that will not do does not cost the link. The reply
 * signs this browser in, at the one session the account then has.
 */
const completeReset: Handler = async (body, request, context) => {
  if (!(await mayAsk('complete', COMPLETIONS_PER_ADDRESS, request, context))) {
    return fail(LOCKED, 429);
  }
  const chosen = passwordChosenSchema.safeParse(body);
  if (!chosen.success) {
    return fail(NEW_PASSWORD_RULE, 400);
  }
  const given = tokenGivenSchema.safeParse(body);
  const done = given.success ? await finishReset(context.db, given.data.token, chosen.data.password, context.now) : null;
  if (!done) {
    return fail(BAD_LINK, 400);
  }
  return ok({ username: done.username }, 200, accountSession(done.userId, done.sessionVersion, request, context));
};

const HANDLERS: Record<Action, Handler> = { request: requestLink, complete: completeReset };

/** Forgot password, by email: `{ action: 'request', ... }` asks for the link, `{ action: 'complete', ... }` uses it. */
export async function reset(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const body = await readBody(request, actionNameSchema);
  if (!body) {
    return fail('That is not something that can be asked here.', 400);
  }
  return HANDLERS[body.action](body, request, context);
}
