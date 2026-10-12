import { GUESTS_CANNOT, SIGN_IN_FIRST, playerIn, type Player } from '../account/identity.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { fail, ok, readBody, sameOrigin } from '../http.js';
import { actionNameSchema, matchActionSchema, matchIdSchema, type MatchAction, type MatchActionName } from '../match/input.js';
import { createParty, joinParty } from '../match/parties.js';
import {
  backToLobby,
  configure,
  endRound,
  getMatch,
  guess,
  handOver,
  kick,
  leaveMatch,
  lock,
  mute,
  namePicker,
  pickTeam,
  pin,
  SLOW_DOWN,
  postSentPlaces,
  say,
  shuffleTeams,
  startMatch,
} from '../match/play.js';
import { joinQueue, leaveQueue, pollQueue, queueAsPair } from '../match/queue.js';
import { accept, type Reply } from '../match/types.js';
import type { Context } from '../serve.js';
import { BANNED } from '../social/moderation.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Each is counted per player, never per address. Everything sent to one match (a guess, a pin, a host's
// decision) is counted with that player's seat in it instead: see `WRITES_PER_MINUTE`. Polls are not counted.
const LIMITS: Partial<Record<MatchActionName, { limit: number; windowMs: number; error: string }>> = {
  create: { limit: 30, windowMs: HOUR_MS, error: 'Too many parties opened in the last hour. Try again later.' },
  // Also what stops anyone finding a party by trying codes.
  join: { limit: 60, windowMs: HOUR_MS, error: 'Too many tries at joining a party in the last hour. Try again later.' },
  queue: { limit: 120, windowMs: HOUR_MS, error: 'Too many searches for a match in the last hour. Try again later.' },
  leaveQueue: { limit: 60, windowMs: MINUTE_MS, error: SLOW_DOWN },
};

// A banned account may play out a match it is already in (guess, post its places, leave), and nothing more.
const CLOSED_TO_BANNED: ReadonlySet<MatchActionName> = new Set(['create', 'join', 'start', 'queue', 'chat', 'emote', 'lobby']);

// Playing takes an account, and nothing makes a guest any more. One made before that, whose session
// has up to a day left, may walk out of the match or the queue it was in, and nothing else.
const OPEN_TO_GUESTS: ReadonlySet<MatchActionName> = new Set(['leave', 'leaveQueue']);

const SETTINGS = 'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.';
const NOT_A_MATCH = 'That is not a match.';
const INVALID: Record<MatchActionName, string> = {
  create: SETTINGS,
  configure: SETTINGS,
  join: 'A party code is 6 letters and numbers.',
  start: NOT_A_MATCH,
  places: 'Those places are not valid.',
  guess: 'That guess is not valid.',
  pin: 'That pin is not valid.',
  leave: NOT_A_MATCH,
  queue: 'Choose ranked, unranked or 2v2.',
  leaveQueue: 'That request is not valid.',
  chat: 'A message is 1 to 200 characters.',
  emote: 'That is not one of the reactions.',
  mute: 'Name a player in the match, and say whether to mute them.',
  team: 'Choose team 0 or team 1.',
  shuffle: NOT_A_MATCH,
  kick: 'Name a player in the match.',
  host: 'Name a player in the match.',
  picker: 'Name a player in the match.',
  lock: 'Say whether the party is to be locked.',
  endRound: NOT_A_MATCH,
  lobby: NOT_A_MATCH,
};

function respond<T>(reply: Reply<T>, status = 200): Response {
  return reply.ok ? ok(reply.data, status) : fail(reply.error, reply.status);
}

/** The action a request names, carried out for the player who sent it. */
async function perform(action: MatchAction, userId: string, { db, now }: Context): Promise<Response> {
  switch (action.action) {
    case 'create':
      return respond(await createParty(db, userId, action.settings, now), 201);
    case 'configure':
      return respond(await configure(db, userId, action.matchId, action.settings, now));
    case 'join':
      return respond(await joinParty(db, userId, action.code, now));
    case 'start':
      return respond(await startMatch(db, userId, action.matchId, now));
    case 'places':
      return respond(await postSentPlaces(db, userId, action, now));
    case 'guess':
      return respond(await guess(db, userId, action, now));
    case 'pin':
      return respond(await pin(db, userId, action, now));
    case 'leave':
      return respond(await leaveMatch(db, userId, action.matchId, now));
    case 'queue':
      return respond(action.matchId === undefined ? await joinQueue(db, userId, action.kind, now) : await queueAsPair(db, userId, action.matchId, now));
    case 'leaveQueue':
      return respond(accept(await leaveQueue(db, userId, now)));
    case 'chat':
      return respond(await say(db, userId, action.matchId, { text: action.text, emote: null, scope: action.scope }, now));
    case 'emote':
      return respond(await say(db, userId, action.matchId, { text: null, emote: action.emote }, now));
    case 'mute':
      return respond(await mute(db, userId, action.matchId, action.username, action.muted, now));
    case 'team':
      return respond(await pickTeam(db, userId, action.matchId, action.team, now));
    case 'shuffle':
      return respond(await shuffleTeams(db, userId, action.matchId, now));
    case 'kick':
      return respond(await kick(db, userId, action.matchId, action.username, now));
    case 'host':
      return respond(await handOver(db, userId, action.matchId, action.username, now));
    case 'picker':
      return respond(await namePicker(db, userId, action.matchId, action.username, now));
    case 'lock':
      return respond(await lock(db, userId, action.matchId, action.locked, now));
    case 'endRound':
      return respond(await endRound(db, userId, action.matchId, now));
    case 'lobby':
      return respond(await backToLobby(db, userId, action.matchId, now));
  }
}

/** Why this player may not take this action, if they may not: a guest outside what guests may do, or a banned account. */
function refusal(action: MatchAction, player: Player): Response | null {
  if (player.guest) {
    return OPEN_TO_GUESTS.has(action.action) ? null : fail(GUESTS_CANNOT, 403);
  }
  return CLOSED_TO_BANNED.has(action.action) && player.banned ? fail(BANNED, 403) : null;
}

/** Every change to a match or a queue: `{ action, ... }`. */
export async function matchPost(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const named = await readBody(request, actionNameSchema);
  const player = await playerIn(request, context);
  if (!player) {
    return fail(SIGN_IN_FIRST, 401);
  }
  if (!named) {
    return fail('That is not something a match can be asked to do.', 400);
  }
  const action = matchActionSchema.safeParse(named);
  if (!action.success) {
    return fail(INVALID[named.action], 400);
  }
  const refused = refusal(action.data, player);
  if (refused) {
    return refused;
  }
  const limit = LIMITS[named.action];
  if (limit && !(await hitRateLimit(context.db, `match-${named.action}:${player.userId}`, limit.limit, limit.windowMs, context.now))) {
    return fail(limit.error, 429);
  }
  return perform(action.data, player.userId, context);
}

/**
 * Asking is a player's heartbeat, and what matches one who waits. A guest left from before playing
 * took an account can do neither any more: they are taken out of the queue, or of the match they
 * ask for, so that no account's game is made of them or waits on them, and are told why.
 */
async function turnAway(params: URLSearchParams, userId: string, { db, now }: Context): Promise<Response> {
  const matchId = matchIdSchema.safeParse(params.get('id'));
  if (params.has('queue')) {
    await leaveQueue(db, userId, now);
  } else if (matchId.success) {
    await leaveMatch(db, userId, matchId.data, now);
  }
  return fail(GUESTS_CANNOT, 403);
}

/** `?id=` is a match's state and that player's heartbeat; `?queue=1` is their place in the queue and its heartbeat. */
export async function matchGet(request: Request, context: Context): Promise<Response> {
  const player = await playerIn(request, context);
  if (!player) {
    return fail(SIGN_IN_FIRST, 401);
  }
  const params = new URL(request.url).searchParams;
  if (player.guest) {
    return turnAway(params, player.userId, context);
  }
  if (params.has('queue')) {
    return ok(await pollQueue(context.db, player.userId, context.now));
  }
  const matchId = matchIdSchema.safeParse(params.get('id'));
  if (!matchId.success) {
    return fail('Ask for a match by its id, or for the queue.', 400);
  }
  return respond(await getMatch(context.db, player.userId, matchId.data, context.now));
}
