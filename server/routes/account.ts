import { z } from 'zod';
import { purgeDeleted, register as createAccount } from '../account/accounts.js';
import { accountSession, hasSession, noSession, playerIn, type Player } from '../account/identity.js';
import { EMAIL_RULE, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH, newPasswordSchema, newUsernameSchema, registerSchema } from '../account/input.js';
import { leagueFor, levelFor } from '../account/progress.js';
import { duelRecord } from '../social/duels.js';
import { isModerator } from '../social/moderation.js';
import { teamRecord } from '../social/teams.js';
import { recentGamesFor, statsFor } from '../db/games.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { ratingRankOf } from '../db/social.js';
import { countLogin, findUserByUsername, getUser, type User } from '../db/users.js';
import { clientIp, fail, hashIp, ok, readBody, sameOrigin } from '../http.js';
import type { Context } from '../serve.js';

// Signing in, by password or by recovery code, and what an account changes about itself are each in a file of their own.
export { accountPost } from './account-actions.js';
export { login } from './sign-in.js';

const REFUSED = 'Request refused.';

const REGISTER_WINDOW_MS = 60 * 60_000;
const ACCOUNTS_PER_ADDRESS = 20;

const USERNAME_RULE = `Choose a username of ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} letters, numbers or single underscores, not starting or ending with one.`;
const PASSWORD_RULE = `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
const TAKEN = 'That username is taken. Choose another, or sign in.';
const EMAIL_TAKEN = 'That email already has an account. Sign in, or use another address.';

const RECENT_GAMES = 10;
const SIGNED_OUT = { account: null, guest: null, stats: null, recentGames: [] };

const ipHashOf = (request: Request, context: Context): string => hashIp(clientIp(request), context.secret);

const startSession = accountSession;
const endSession = noSession;

const namedSchema = z.looseObject({ username: newUsernameSchema });
const passwordChosenSchema = z.looseObject({ password: newPasswordSchema });

/** Makes an account and signs the browser in. The reply carries the recovery code, which is never shown again. */
export async function register(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail(REFUSED, 403);
  }
  const { db, now } = context;
  if (!(await hitRateLimit(db, `account-register:${ipHashOf(request, context)}`, ACCOUNTS_PER_ADDRESS, REGISTER_WINDOW_MS, now))) {
    return fail('Too many new accounts from this network. Try again in an hour.', 429);
  }
  const sent = await readBody(request, z.unknown());
  const body = registerSchema.safeParse(sent);
  if (!body.success) {
    if (!namedSchema.safeParse(sent).success) {
      return fail(USERNAME_RULE, 400);
    }
    // With a name that would do, what is wrong is the password; with both, the email.
    return fail(passwordChosenSchema.safeParse(sent).success ? EMAIL_RULE : PASSWORD_RULE, 400);
  }
  const { username } = body.data;
  // Moderators are known by their usernames, so a moderator's name is not there for the taking. It is
  // listed once its account exists, and is answered as any name is that somebody has.
  if (isModerator(context.moderators, username)) {
    return fail(TAKEN, 409);
  }
  // Clearing out accounts deleted long enough ago is what frees their names for this one.
  await purgeDeleted(db, now);
  const made = await createAccount(db, { ...body.data, now });
  if (!made) {
    // Either the name or the email is somebody's. The name is said first: an account that has both is one to sign in to.
    return fail((await findUserByUsername(db, username)) ? TAKEN : EMAIL_TAKEN, 409);
  }
  return ok({ username, recoveryCode: made.recoveryCode }, 201, startSession(made.id, 0, request, context));
}

export async function logout(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail(REFUSED, 403);
  }
  return ok({ signedIn: false }, 200, endSession(request));
}

/** The player a session names, as their row has them. Null when the row is gone, deleted, or not the kind the session says. */
async function rowOf(player: Player, { db, now }: Context): Promise<User | null> {
  // Asking who is signed in is what counts a day of the login streak: the first time each day, and never for a guest.
  const user = (player.guest ? null : await countLogin(db, player.userId, now)) ?? (await getUser(db, player.userId));
  return user?.guest === player.guest ? user : null;
}

function accountView(user: User, rank: number | null, moderators: readonly string[] | undefined) {
  return {
    username: user.username,
    country: user.country,
    rating: user.rating,
    league: leagueFor(user.rating),
    xp: user.xp,
    level: levelFor(user.xp),
    bestStreak: user.bestStreak,
    bestCountry: user.bestCountry,
    bestContinent: user.bestContinent,
    loginStreak: user.loginStreak,
    duels: duelRecord(user, rank),
    teams: teamRecord(user),
    moderator: isModerator(moderators, user.username),
    banned: user.banned,
    allowFriendRequests: user.allowRequests,
    hideChat: user.hideChat,
    hideLastSeen: user.hideLastSeen,
    // Whether there is a code, never the code: that was shown once, when it was made.
    hasRecoveryCode: user.recoveryHash !== null,
    // The account's own, and shown to nobody else: no other view of a player carries it.
    email: user.email,
  };
}

/** Who is signed in, with their stats and latest games. A visitor gets the same shape, empty, and a guest only their name. */
export async function account(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player) {
    // A session that has ended is dropped, so the browser stops sending it.
    return hasSession(request, context) ? ok(SIGNED_OUT, 200, endSession(request)) : ok(SIGNED_OUT);
  }
  const user = await rowOf(player, context);
  if (!user) {
    return ok(SIGNED_OUT, 200, endSession(request));
  }
  if (user.guest) {
    return ok({ ...SIGNED_OUT, guest: user.username });
  }
  const { db, now } = context;
  const [stats, recentGames, rank] = await Promise.all([statsFor(db, user.id), recentGamesFor(db, user.id, RECENT_GAMES), ratingRankOf(db, user.id, now)]);
  return ok({
    account: accountView(user, rank, context.moderators),
    guest: null,
    stats: { ...stats, ratedGames: user.ratedGames },
    recentGames,
  });
}
