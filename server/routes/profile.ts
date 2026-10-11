import { z } from 'zod';
import { playerIn, type Player } from '../account/identity.js';
import { usernameSchema } from '../account/input.js';
import { leagueFor, levelFor } from '../account/progress.js';
import { recentGamesFor } from '../db/games.js';
import { utcDay } from '../db/progress.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { countProfileView, historyOf, isOnline, profileOf, ratingRankOf, tieBetween, type ProfileRow, type Tie } from '../db/social.js';
import { clientIp, fail, hashIp, ok } from '../http.js';
import type { Context } from '../serve.js';
import { duelRecord } from '../social/duels.js';
import { teamRecord } from '../social/teams.js';

const DAY_MS = 24 * 60 * 60_000;
const PROFILE_GAMES = 10;
/** How far back a profile's progress can be asked to go, today included: a number of days, or everything. */
const RANGES = ['7', '30', 'all'] as const;
const DEFAULT_RANGE = '30';
/** The most points a profile's progress ever has, which is what "all" comes to for an account older than this. */
const MAX_HISTORY_POINTS = 365;

/** What the player on a profile is to the account looking at it. */
function friendState(tie: Tie, viewerId: string): 'friends' | 'outgoing' | 'incoming' | 'none' {
  if (tie === null) {
    return 'none';
  }
  if (tie.accepted) {
    return 'friends';
  }
  return tie.requesterId === viewerId ? 'outgoing' : 'incoming';
}

/** The first day of a profile's progress for a range in days, or null for all of it. */
const historySince = (range: (typeof RANGES)[number], now: number): string | null => (range === 'all' ? null : utcDay(now - (Number(range) - 1) * DAY_MS));

/**
 * The profile's count of views, with this look in it when it is the viewer's
 * first of the UTC day. An account is one viewer wherever it looks from.
 * Anyone else, a guest included, is counted by address, kept only as a keyed
 * hash: a guest's session is free to make, so it is nobody in particular.
 * The day is part of what is counted against, so each day starts afresh, and
 * of looks arriving together from one viewer exactly one finds it uncounted.
 */
async function viewsWith(player: ProfileRow, viewer: Player | null, request: Request, context: Context): Promise<number> {
  const { db, now, secret } = context;
  const who = viewer && !viewer.guest ? `account:${viewer.userId}` : `address:${hashIp(clientIp(request), secret)}`;
  const firstToday = await hitRateLimit(db, `profile-view:${utcDay(now)}:${player.id}:${who}`, 1, DAY_MS, now);
  return firstToday ? ((await countProfileView(db, player.id)) ?? player.views) : player.views;
}

/** What a profile says of the player's standing: the same to whoever is looking. */
function standingOf(player: ProfileRow, rank: number | null) {
  return {
    username: player.username,
    country: player.country,
    joinedAt: new Date(player.joinedAt).toISOString(),
    xp: player.xp,
    level: levelFor(player.xp),
    rating: player.rating,
    league: leagueFor(player.rating),
    ratedGames: player.ratedGames,
    gamesPlayed: player.gamesPlayed,
    bestStreak: player.bestStreak,
    bestCountry: player.bestCountry,
    bestContinent: player.bestContinent,
    duels: duelRecord(player, rank),
    teams: teamRecord(player),
  };
}

/** `?profile=<username>&range=<7|30|all>`: what anyone may see of a player, and what they are to the account looking. */
export async function profile(params: URLSearchParams, request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const range = z.enum(RANGES).safeParse(params.get('range') ?? DEFAULT_RANGE);
  if (!range.success) {
    return fail('Ask for a range of 7, 30 or all.', 400);
  }
  const viewer = await playerIn(request, context);
  const username = usernameSchema.safeParse(params.get('profile'));
  const player = username.success ? await profileOf(db, username.data) : null;
  if (!player) {
    return fail('No player by that name.', 404);
  }
  // A guest has no friends, so to one, as to a visitor, the player is nothing in particular.
  const viewerId = viewer && !viewer.guest ? viewer.userId : null;
  const isSelf = viewerId === player.id;
  const [rank, tie, recentGames, history, views] = await Promise.all([
    ratingRankOf(db, player.id, now),
    viewerId !== null && !isSelf ? tieBetween(db, viewerId, player.id) : null,
    recentGamesFor(db, player.id, PROFILE_GAMES),
    historyOf(db, player.id, historySince(range.data, now), MAX_HISTORY_POINTS),
    // The player looking at their own profile is not a view of it.
    isSelf ? player.views : viewsWith(player, viewer, request, context),
  ]);
  // A player who hides when they were last seen is, to everyone else, only online or offline.
  const lastSeenShown = isSelf || !player.hideLastSeen ? player.lastSeenAt : null;
  return ok({
    ...standingOf(player, rank),
    views,
    friend: viewerId === null ? null : isSelf ? 'self' : friendState(tie, viewerId),
    online: isOnline(player.lastSeenAt, now),
    lastSeenAt: lastSeenShown === null ? null : new Date(lastSeenShown).toISOString(),
    recentGames,
    history,
  });
}
