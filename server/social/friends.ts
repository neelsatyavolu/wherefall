import { leagueFor, levelFor } from '../account/progress.js';
import type { Db, Queryable } from '../db/client.js';
import {
  acceptRequest,
  allowsRequests,
  deleteInvitesBefore,
  deleteTie,
  friendsAndRequestsOf,
  insertRequest,
  invitesFor,
  isInLobby,
  isOnline,
  lockPair,
  tieBetween,
  tiesOf,
  upsertInvite,
  userIdFor,
  type Tie,
} from '../db/social.js';
import { accept, refuse, type Reply } from '../match/types.js';

export const MAX_FRIENDS = 100;
/** A party invitation is shown for this long. */
export const INVITE_KEPT_MS = 10 * 60_000;

export const FRIEND_ACTIONS = ['request', 'accept', 'decline', 'remove'] as const;
export type FriendAction = (typeof FRIEND_ACTIONS)[number];

/** What a player is shown of their own friends. Nobody else is shown any of it. */
export interface FriendsView {
  friends: Array<{
    username: string;
    country: string | null;
    level: number;
    league: string;
    party: string | null;
    online: boolean;
    /** ISO 8601, or null for a friend whose browser has never said it was there, and for one who hides it. */
    lastSeenAt: string | null;
  }>;
  /** Players who have asked to be friends. */
  incoming: string[];
  /** Players this one has asked. */
  outgoing: string[];
  invites: Array<{ from: string; code: string }>;
}

// The one thing an action says about a name that is not a player's. Usernames are public on the leaderboards.
const NO_SUCH_PLAYER = refuse(404, 'No player by that name.');
const THAT_IS_YOU = refuse(400, 'That is your own username.');
const TOO_MANY = refuse(409, `You have ${MAX_FRIENDS} friends and requests, which is the most there can be. Remove one first.`);
const NOT_ACCEPTING = refuse(403, 'That player is not accepting friend requests.');

export async function friendsView(q: Queryable, userId: string, now: number): Promise<FriendsView> {
  const ties = await tiesOf(q, userId);
  const invites = await invitesFor(q, userId, now - INVITE_KEPT_MS);
  return {
    friends: ties
      .filter((tie) => tie.accepted)
      .map((tie) => ({
        username: tie.username,
        country: tie.country,
        level: levelFor(tie.xp),
        league: leagueFor(tie.rating),
        party: tie.party,
        online: isOnline(tie.lastSeenAt, now),
        // A friend who hides it is only ever online or offline.
        lastSeenAt: tie.lastSeenAt === null || tie.hideLastSeen ? null : new Date(tie.lastSeenAt).toISOString(),
      })),
    incoming: ties.filter((tie) => !tie.accepted && !tie.mine).map((tie) => tie.username),
    outgoing: ties.filter((tie) => !tie.accepted && tie.mine).map((tie) => tie.username),
    invites,
  };
}

/** Makes the two players friends, or records the request, if the asker has room for one more. */
async function befriend(tx: Queryable, userId: string, otherId: string, tie: Tie, now: number): Promise<Reply<null>> {
  const theyAsked = tie !== null && tie.requesterId === otherId;
  if (tie !== null && (tie.accepted || !theyAsked)) {
    // Already friends, or the asker's own request is still waiting.
    return accept(null);
  }
  if ((await friendsAndRequestsOf(tx, userId)) >= MAX_FRIENDS) {
    return TOO_MANY;
  }
  if (theyAsked) {
    await acceptRequest(tx, otherId, userId);
    return accept(null);
  }
  // Turning requests off stops new ones arriving. It does not stop the player's own being accepted, above.
  if (!(await allowsRequests(tx, otherId))) {
    return NOT_ACCEPTING;
  }
  await insertRequest(tx, userId, otherId, now);
  return accept(null);
}

async function change(tx: Queryable, action: FriendAction, userId: string, otherId: string, now: number): Promise<Reply<null>> {
  const tie = await tieBetween(tx, userId, otherId);
  const theirRequest = tie !== null && !tie.accepted && tie.requesterId === otherId;
  switch (action) {
    case 'request':
      return befriend(tx, userId, otherId, tie, now);
    case 'accept':
      if (tie?.accepted) {
        return accept(null);
      }
      return theirRequest ? befriend(tx, userId, otherId, tie, now) : refuse(404, 'That player has not asked to be your friend.');
    case 'decline':
      if (theirRequest) {
        await deleteTie(tx, userId, otherId);
      }
      return accept(null);
    case 'remove':
      await deleteTie(tx, userId, otherId);
      return accept(null);
  }
}

/**
 * Changes what the player and the one named are to each other, and answers
 * with the player's friends afterwards. Both accounts are held while it
 * happens, so two players asking each other at the same moment become
 * friends once instead of colliding.
 */
export async function changeFriend(db: Db, action: FriendAction, userId: string, username: string, now: number): Promise<Reply<FriendsView>> {
  const otherId = await userIdFor(db, username);
  if (otherId === null) {
    return NO_SUCH_PLAYER;
  }
  if (otherId === userId) {
    return THAT_IS_YOU;
  }
  const changed = await db.transaction(async (tx) => ((await lockPair(tx, userId, otherId)) ? change(tx, action, userId, otherId, now) : NO_SUCH_PLAYER));
  return changed.ok ? accept(await friendsView(db, userId, now)) : changed;
}

/** Invites a friend to the party lobby the player is in. */
export async function invite(db: Db, userId: string, username: string, code: string, now: number): Promise<Reply<FriendsView>> {
  const otherId = await userIdFor(db, username);
  if (otherId === null) {
    return NO_SUCH_PLAYER;
  }
  if (!(await isInLobby(db, userId, code))) {
    return refuse(409, 'You can only invite a friend to a party whose lobby you are in.');
  }
  await deleteInvitesBefore(db, now - INVITE_KEPT_MS);
  if (!(await upsertInvite(db, userId, otherId, code, now))) {
    return refuse(403, 'You can only invite your friends.');
  }
  return accept(await friendsView(db, userId, now));
}
