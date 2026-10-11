import { z } from 'zod';
import { SIGN_IN_FIRST, accountIn, markSeen, noAccount, playerIn } from '../account/identity.js';
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, newUsernameSchema, usernameSchema } from '../account/input.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { onlineCount, rename } from '../db/social.js';
import { getUser } from '../db/users.js';
import { fail, ok, readBody, sameOrigin } from '../http.js';
import { MAX_REPORT_REASON } from '../maps/input.js';
import { onOneLine } from '../match/chat.js';
import { partyCodeSchema } from '../match/input.js';
import type { Reply } from '../match/types.js';
import type { Context } from '../serve.js';
import { FRIEND_ACTIONS, changeFriend, friendsView, invite, type FriendAction } from '../social/friends.js';
import { BANNED, MODERATORS_ONLY, decide, decisionSchema, isModerator, moderationView } from '../social/moderation.js';
import { REPORT_CATEGORIES, report, reportsView } from '../social/reports.js';
import { leaderboard } from './boards.js';
import { profile } from './profile.js';

const NO_SUCH_PLAYER = 'No player by that name.';
// Names every member of REPORT_CATEGORIES, in its order.
const NO_CATEGORY = 'Say what the report is about: cheating, name, chat or other.';
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const RENAME_EVERY_MS = 30 * DAY_MS;

const ACTIONS = ['request', 'accept', 'decline', 'remove', 'invite', 'rename', 'report', 'moderate'] as const;
type Action = (typeof ACTIONS)[number];

const actionNameSchema = z.looseObject({ action: z.enum(ACTIONS) });
const namedSchema = z.object({ username: usernameSchema });
const renamedSchema = z.object({ username: newUsernameSchema });
const inviteSchema = z.object({ username: usernameSchema, code: partyCodeSchema });
const categorisedSchema = z.looseObject({ category: z.enum(REPORT_CATEGORIES) });
const reportSchema = z.object({
  username: usernameSchema,
  category: z.enum(REPORT_CATEGORIES),
  /** The note that may come with it. */
  reason: z.string().transform(onOneLine).pipe(z.string().max(MAX_REPORT_REASON)).default(''),
});

/** What a banned account may still do here: change its own name. Moderating is a moderator's, banned or not. */
const OPEN_TO_BANNED: ReadonlySet<Action> = new Set(['rename', 'moderate']);

// Accepting, declining and removing only ever undo or answer something, so theirs is set where nobody
// doing it by hand would reach it: it is there to stop a script, and is the account's own, not its address's.
const ANSWERS_PER_HOUR = 120;
const SLOW_DOWN = 'Too many requests. Slow down a little.';

const LIMITS: Partial<Record<Action, { perHour: number; error: string }>> = {
  request: { perHour: 60, error: 'Too many friend requests in the last hour. Try again later.' },
  accept: { perHour: ANSWERS_PER_HOUR, error: SLOW_DOWN },
  decline: { perHour: ANSWERS_PER_HOUR, error: SLOW_DOWN },
  remove: { perHour: ANSWERS_PER_HOUR, error: SLOW_DOWN },
  invite: { perHour: 60, error: 'Too many invitations in the last hour. Try again later.' },
  rename: { perHour: 10, error: 'Too many tries at a new username in the last hour. Try again later.' },
  report: { perHour: 20, error: 'Too many reports in the last hour. Try again later.' },
};

function respond<T>(reply: Reply<T>): Response {
  return reply.ok ? ok(reply.data) : fail(reply.error, reply.status);
}

/** How many players are online. Asking is also how a browser with a session, an account's or a guest's, says it is still there. */
async function online(request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const player = await playerIn(request, context);
  if (player) {
    await markSeen(db, player.userId, now);
  }
  return ok({ online: await onlineCount(db, now) });
}

/** The account's own friends. */
async function friends(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  return ok(await friendsView(context.db, player.userId, context.now));
}

/** The reports of players the account has made, each with where it stands. */
async function reports(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  return ok(await reportsView(context.db, player.userId));
}

/** `?leaderboard=`, `?profile=` and `?online=1` are open to visitors; `?friends=1` and `?reports=1` are the signed-in player's own. */
export async function socialGet(request: Request, context: Context): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.has('online')) {
    return online(request, context);
  }
  if (params.has('leaderboard')) {
    return leaderboard(params, request, context);
  }
  if (params.has('profile')) {
    return profile(params, request, context);
  }
  if (params.has('friends')) {
    return friends(request, context);
  }
  if (params.has('reports')) {
    return reports(request, context);
  }
  if (params.has('moderation')) {
    return (await moderatorIn(request, context)) ? ok(await moderationView(context.db)) : fail(MODERATORS_ONLY, 403);
  }
  return fail('Ask for a leaderboard, a profile or your friends.', 400);
}

/** The signed-in account's id when it is one of the moderators, and null for everyone else, visitors included. */
async function moderatorIn(request: Request, context: Context): Promise<string | null> {
  const account = await accountIn(request, context);
  return account && isModerator(context.moderators, account.username) ? account.userId : null;
}

const TAKEN = 'That username is taken. Choose another.';

async function changeUsername(body: unknown, userId: string, context: Context): Promise<Response> {
  const { db, now } = context;
  const named = renamedSchema.safeParse(body);
  if (!named.success) {
    return fail(`A username is ${MIN_USERNAME_LENGTH} to ${MAX_USERNAME_LENGTH} letters, numbers or single underscores, not starting or ending with one.`, 400);
  }
  const { username } = named.data;
  const user = await getUser(db, userId);
  if (!user) {
    return fail(SIGN_IN_FIRST, 401);
  }
  // Moderators are known by their usernames. One who gave theirs up would
  // leave it for anyone to take, and with it the right to moderate.
  if (isModerator(context.moderators, user.username)) {
    return fail("A moderator's username cannot be changed.", 409);
  }
  if (isModerator(context.moderators, username) && username !== user.username) {
    return fail(TAKEN, 409);
  }
  const outcome = await rename(db, userId, username, now, now - RENAME_EVERY_MS);
  if (outcome === 'renamed') {
    return ok({ username });
  }
  if (outcome === 'taken') {
    return fail(TAKEN, 409);
  }
  return user.username === username ? fail('That is already your username.', 400) : fail('You can change your username once every 30 days.', 409);
}

async function moderate(request: Request, body: unknown, context: Context): Promise<Response> {
  if (!(await moderatorIn(request, context))) {
    return fail(MODERATORS_ONLY, 403);
  }
  const decision = decisionSchema.safeParse(body);
  return decision.success
    ? respond(await decide(context.db, decision.data))
    : fail('Say whether it is a map or a player, which one, and what to do: remove or dismiss a map; ban, unban or dismiss a player.', 400);
}

type Handler = (body: unknown, userId: string, context: Context) => Promise<Response>;

/** A report of a player: who, what it is about, and a note if there is one. */
const reportPlayer: Handler = async (body, userId, { db, now }) => {
  // A name that could not be a username is nobody's.
  if (!namedSchema.safeParse(body).success) {
    return fail(NO_SUCH_PLAYER, 404);
  }
  if (!categorisedSchema.safeParse(body).success) {
    return fail(NO_CATEGORY, 400);
  }
  const reported = reportSchema.safeParse(body);
  if (!reported.success) {
    return fail(`A reason is up to ${MAX_REPORT_REASON} characters.`, 400);
  }
  const { username, category, reason } = reported.data;
  return respond(await report(db, userId, username, { category, note: reason }, now));
};

const HANDLERS: Record<Exclude<Action, 'moderate' | FriendAction>, Handler> = {
  rename: changeUsername,
  invite: async (body, userId, { db, now }) => {
    const invited = inviteSchema.safeParse(body);
    return invited.success
      ? respond(await invite(db, userId, invited.data.username, invited.data.code, now))
      : fail('Invite a friend by their username, to a party by its code.', 400);
  },
  report: reportPlayer,
};

const isFriendAction = (action: Action): action is FriendAction => (FRIEND_ACTIONS as readonly string[]).includes(action);

/** Friends, party invitations, reports, the username, and a moderator's decisions: `{ action, ... }`. */
export async function socialPost(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const player = await playerIn(request, context);
  if (!player || player.guest) {
    return noAccount(player);
  }
  const { userId } = player;
  const body = await readBody(request, actionNameSchema);
  if (!body) {
    return fail('That is not something that can be asked here.', 400);
  }
  const { action } = body;
  if (action === 'moderate') {
    return moderate(request, body, context);
  }
  if (player.banned && !OPEN_TO_BANNED.has(action)) {
    return fail(BANNED, 403);
  }
  const limit = LIMITS[action];
  if (limit && !(await hitRateLimit(context.db, `social-${action}:${userId}`, limit.perHour, HOUR_MS, context.now))) {
    return fail(limit.error, 429);
  }
  if (!isFriendAction(action)) {
    return HANDLERS[action](body, userId, context);
  }
  // A name that could not be a username is nobody's.
  const named = namedSchema.safeParse(body);
  return named.success ? respond(await changeFriend(context.db, action, userId, named.data.username, context.now)) : fail(NO_SUCH_PLAYER, 404);
}
