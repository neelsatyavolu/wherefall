import { z } from 'zod';
import { slugSchema, usernameSchema } from '../account/input.js';
import type { Db } from '../db/client.js';
import { mapExists } from '../db/maps.js';
import {
  clearMapReports,
  removeMap,
  reportedMaps,
  reportedPlayers,
  setBanned,
  settlePlayerReports,
  type ReportedMap,
  type ReportedPlayer,
} from '../db/moderation.js';
import { userIdFor } from '../db/social.js';
import { accept, refuse, type Reply } from '../match/types.js';

/** What every online action answers a banned account, with a 403. */
export const BANNED = 'This account is banned from online play.';
/** What moderation answers anyone who is not a moderator, with a 403. */
export const MODERATORS_ONLY = 'Moderators only.';

export interface ModerationView {
  maps: ReportedMap[];
  players: ReportedPlayer[];
}

/** One decision a moderator can take on a reported map or player. */
export const decisionSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('map'), slug: slugSchema, decision: z.enum(['remove', 'dismiss']) }),
  z.object({ target: z.literal('player'), username: usernameSchema, decision: z.enum(['ban', 'unban', 'dismiss']) }),
]);
export type Decision = z.infer<typeof decisionSchema>;

/** True for the accounts named in the MODERATORS setting. */
export const isModerator = (moderators: readonly string[] | undefined, username: string): boolean => (moderators ?? []).includes(username);

/** Everything reported and not yet decided, for a moderator. Reasons are shown; who gave them never is. */
export async function moderationView(db: Db): Promise<ModerationView> {
  return { maps: await reportedMaps(db), players: await reportedPlayers(db) };
}

/**
 * Carries out a decision about a player. Their reports are kept either way,
 * for the players who made them to see how they ended: the open ones are
 * marked dismissed, or, by a ban, acted on. Lifting a ban changes none.
 */
async function decidePlayer(db: Db, userId: string, decision: 'ban' | 'unban' | 'dismiss'): Promise<void> {
  if (decision === 'dismiss') {
    await settlePlayerReports(db, userId, 'dismissed');
    return;
  }
  await setBanned(db, userId, decision === 'ban');
  if (decision === 'ban') {
    await settlePlayerReports(db, userId, 'actioned');
  }
}

/** Carries out a moderator's decision, and answers with what is left to look at. */
export async function decide(db: Db, decision: Decision): Promise<Reply<ModerationView>> {
  if (decision.target === 'map') {
    // Removing a map takes its reports with it; dismissing them leaves the map.
    const found = decision.decision === 'remove' ? await removeMap(db, decision.slug) : await mapExists(db, decision.slug);
    if (!found) {
      return refuse(404, 'There is no such map.');
    }
    if (decision.decision === 'dismiss') {
      await clearMapReports(db, decision.slug);
    }
    return accept(await moderationView(db));
  }
  const userId = await userIdFor(db, decision.username);
  if (userId === null) {
    return refuse(404, 'No player by that name.');
  }
  await decidePlayer(db, userId, decision.decision);
  return accept(await moderationView(db));
}
