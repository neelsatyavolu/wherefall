import { z } from 'zod';
import { call, countrySchema, duelsSchema, post, recentGameSchema, teamsSchema, type Result } from '../account/client.ts';

const SOCIAL = '/api/social';

export const BOARDS = ['rating', 'xp', 'streak'] as const;
export type Board = (typeof BOARDS)[number];

/** A board over all time, or by what was gained today (UTC). */
export const PERIODS = ['all', 'day'] as const;
export type Period = (typeof PERIODS)[number];

/** How far back a profile's history goes: 7 days, 30 days, or the last 365 points. */
export const PROFILE_RANGES = [7, 30, 'all'] as const;
export type ProfileRange = (typeof PROFILE_RANGES)[number];

/** How often the page tells the server it is still open, which is what "online" is built from. */
export const PRESENCE_MS = 60_000;

/** What a report of a player is about. The server refuses a report without one. */
export const REPORT_CATEGORIES = ['cheating', 'name', 'chat', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Where a report stands: `actioned` once a moderator bans the player, `dismissed` when a moderator dismisses the reports. */
export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const leaderboardSchema = z.object({
  board: z.enum(BOARDS),
  period: z.enum(PERIODS),
  /** whether players not seen for 14 days were ranked too: what was applied, which is never so for `day` */
  inactive: z.boolean(),
  /** top 100; for `day`, `value` is what was gained today */
  entries: z.array(z.object({ rank: z.number(), username: z.string(), country: countrySchema, value: z.number(), level: z.number(), league: z.string() })),
  /** where the signed-in player stands; null for a visitor or a player not on the board */
  you: z.object({ rank: z.number(), value: z.number() }).nullable(),
});

const profileSchema = z.object({
  username: z.string(),
  country: countrySchema,
  /** ISO 8601 */
  joinedAt: z.string(),
  xp: z.number(),
  level: z.number(),
  rating: z.number(),
  league: z.string(),
  ratedGames: z.number(),
  gamesPlayed: z.number(),
  bestStreak: z.number(),
  /** best Country Guesser and Continent Guesser scores, 0 to 10000 */
  bestCountry: z.number(),
  bestContinent: z.number(),
  duels: duelsSchema,
  /** the player's 2v2 matches */
  teams: teamsSchema,
  /** how often the profile was opened by anyone but its owner: each viewer counts once a day */
  views: z.number(),
  /** how the asker stands to this player; null for a visitor or a guest */
  friend: z.enum(['self', 'friends', 'outgoing', 'incoming', 'none']).nullable(),
  online: z.boolean(),
  /** ISO 8601; null for a player never seen, and for one who hides it from everyone else (`online` is still sent) */
  lastSeenAt: z.string().nullable(),
  recentGames: z.array(recentGameSchema),
  /** XP, rating and the places on both boards at the end of each day, oldest first. The ranks are null for days before they were kept */
  history: z.array(z.object({ day: z.string(), xp: z.number(), rating: z.number(), xpRank: z.number().nullable(), ratingRank: z.number().nullable() })),
});

const friendsSchema = z.object({
  friends: z.array(
    z.object({
      username: z.string(),
      country: countrySchema,
      level: z.number(),
      league: z.string(),
      /** code of a lobby they are in */
      party: z.string().nullable(),
      /** seen in the last two minutes */
      online: z.boolean(),
      /** ISO 8601; null for a friend never seen, and for one who hides it */
      lastSeenAt: z.string().nullable(),
    }),
  ),
  /** usernames who asked to be friends */
  incoming: z.array(z.string()),
  /** usernames the player asked */
  outgoing: z.array(z.string()),
  /** party invites from the last 10 minutes */
  invites: z.array(z.object({ from: z.string(), code: z.string() })),
});

const renamedSchema = z.object({ username: z.string() });
const onlineSchema = z.object({ online: z.number() });

/** What has been reported and not yet dealt with. Moderators only. */
const moderationSchema = z.object({
  maps: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      maker: z.string(),
      reports: z.number(),
      /** newest first, up to 10 */
      reasons: z.array(z.string()),
    }),
  ),
  players: z.array(
    z.object({
      username: z.string(),
      /** open reports */
      reports: z.number(),
      /** what each open report is about and the note that came with it, which may be empty; newest first */
      reasons: z.array(z.object({ category: z.string(), note: z.string() })),
      banned: z.boolean(),
    }),
  ),
});

/** The account's own reports of players, newest first, 50 at most. Reports of maps are not listed. */
const myReportsSchema = z.object({
  reports: z.array(
    z.object({
      username: z.string(),
      /** one of `REPORT_CATEGORIES` */
      category: z.string(),
      /** the note that was sent with it; may be empty */
      note: z.string(),
      /** ISO 8601: when the report was made, or last made again */
      at: z.string(),
      status: z.enum(REPORT_STATUSES),
    }),
  ),
});

export type Leaderboard = z.infer<typeof leaderboardSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Friends = z.infer<typeof friendsSchema>;
export type Friend = Friends['friends'][number];
export type FriendStanding = Profile['friend'];
export type FriendAction = 'request' | 'accept' | 'decline' | 'remove';
export type Moderation = z.infer<typeof moderationSchema>;
export type MyReports = z.infer<typeof myReportsSchema>;
export type MyReport = MyReports['reports'][number];
export type MapDecision = 'remove' | 'dismiss';
export type PlayerDecision = 'ban' | 'unban' | 'dismiss';

type Reply<T> = Promise<Result<T>>;

/**
 * The top 100 by rating, XP or best streak: over all time, or by today's gain. Players not seen
 * for 14 days are left out of the all-time boards unless `inactive` asks for them; the day's board
 * ignores it, and the reply says what was applied. Works without a session.
 */
export function getLeaderboard(board: Board, period: Period = 'all', inactive = false, fetchFn: typeof fetch = fetch): Reply<Leaderboard> {
  return call(fetchFn, `${SOCIAL}?leaderboard=${board}&period=${period}${inactive ? '&inactive=1' : ''}`, leaderboardSchema);
}

/** A player's public profile, with its history over `range`. Fails with the server's message when there is no such player. */
export function getProfile(username: string, range: ProfileRange = 30, fetchFn: typeof fetch = fetch): Reply<Profile> {
  return call(fetchFn, `${SOCIAL}?profile=${encodeURIComponent(username)}&range=${range}`, profileSchema);
}

/**
 * How many players, guests included, were seen in the last two minutes. With a session it also marks
 * the caller as seen: call it once a minute while the page is visible. Works without a session.
 */
export function getOnline(fetchFn: typeof fetch = fetch): Reply<{ online: number }> {
  return call(fetchFn, `${SOCIAL}?online=1`, onlineSchema);
}

/** The signed-in player's friends, requests both ways, and party invites. */
export function getFriends(fetchFn: typeof fetch = fetch): Reply<Friends> {
  return call(fetchFn, `${SOCIAL}?friends=1`, friendsSchema);
}

/**
 * Asks, accepts, declines or removes a friend. Answers with the lists as they are afterwards. A
 * request to a player who has turned requests off fails with the server's message. Accepting,
 * declining and removing are held to 120 an hour, then `REFUSALS.slowDown`.
 */
export function friendAction(action: FriendAction, username: string, fetchFn: typeof fetch = fetch): Reply<Friends> {
  return call(fetchFn, SOCIAL, friendsSchema, post({ action, username }));
}

/** Invites a friend to the party lobby the player is in. */
export function inviteFriend(username: string, code: string, fetchFn: typeof fetch = fetch): Reply<Friends> {
  return call(fetchFn, SOCIAL, friendsSchema, post({ action: 'invite', username, code }));
}

/** Changes the player's username: same rules as sign-up, once per 30 days. */
export function rename(username: string, fetchFn: typeof fetch = fetch): Reply<{ username: string }> {
  return call(fetchFn, SOCIAL, renamedSchema, post({ action: 'rename', username }));
}

/** How many things on the friends pane are waiting for the player: requests to answer and invites to take up. */
export const pendingCount = (friends: Friends) => friends.incoming.length + friends.invites.length;

/**
 * Reports a player to the moderators for one of `REPORT_CATEGORIES`, with a note of up to 200
 * characters or none. One report per reporter per player: a newer one replaces it and opens it again.
 */
export function reportPlayer(username: string, category: ReportCategory, reason?: string, fetchFn: typeof fetch = fetch): Reply<{ reported: true }> {
  return call(fetchFn, SOCIAL, z.object({ reported: z.literal(true) }), post({ action: 'report', username, category, ...(reason === undefined ? {} : { reason }) }));
}

/** The signed-in player's own reports of players, each with where it stands. */
export function getMyReports(fetchFn: typeof fetch = fetch): Reply<MyReports> {
  return call(fetchFn, `${SOCIAL}?reports=1`, myReportsSchema);
}

/** The maps and players that have been reported. Refused (403) for anyone who is not a moderator. */
export function getModeration(fetchFn: typeof fetch = fetch): Reply<Moderation> {
  return call(fetchFn, `${SOCIAL}?moderation=1`, moderationSchema);
}

/** Removes a reported map, or clears its reports. Answers with what is still waiting. */
export function moderateMap(slug: string, decision: MapDecision, fetchFn: typeof fetch = fetch): Reply<Moderation> {
  return call(fetchFn, SOCIAL, moderationSchema, post({ action: 'moderate', target: 'map', slug, decision }));
}

/** Bans or unbans a player from online play, or clears their reports. */
export function moderatePlayer(username: string, decision: PlayerDecision, fetchFn: typeof fetch = fetch): Reply<Moderation> {
  return call(fetchFn, SOCIAL, moderationSchema, post({ action: 'moderate', target: 'player', username, decision }));
}
