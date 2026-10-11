import { randomInt } from 'node:crypto';
import type { Db, Queryable } from '../db/client.js';
import { insertMatch, insertPlayers, loadMatch, lockPlayer, openMatchOf, openPublicMatches, saveMatch } from '../db/matches.js';
import {
  enqueue,
  everyoneWaiting,
  lockGathering,
  noteNoWait,
  notePairing,
  noteWaits,
  removeAllFromQueue,
  removeFromQueue,
  setGathering,
  standingOf,
  touchQueueEntry,
  typicalWait,
  type Waiting,
} from '../db/queue.js';
import type { QueueKind } from './input.js';
import { advance, isActive, roundToJoinFrom } from './machine.js';
import { ACCOUNT_GONE, IN_A_MATCH, newMatch, tidy } from './parties.js';
import { closeLobby, settleOpenMatch } from './play.js';
import {
  GATHER_MS,
  MAX_PUBLIC_PLAYERS,
  MIN_PUBLIC_PLAYERS,
  PREPARE_MS,
  QUEUE_SETTINGS,
  QUEUE_SIZE,
  accept,
  refuse,
  type PlayerRecord,
  type QueueState,
  type Reply,
  type Team,
} from './types.js';

/** The queue that gathers players over a countdown. The others make a match as soon as the right players are there. */
const PUBLIC = 'unranked';

/** How far apart in rating two players may be when they have just started waiting, and how much further for each second one has waited. */
const WINDOW_AT_FIRST = 50;
const WINDOW_PER_SECOND = 10;
/** The window stops growing here: however long two players wait, they are not paired across a wider gap. */
export const WINDOW_AT_MOST = 400;
/** Two players who have just played each other are not paired again this soon while anyone else is waiting. */
const REMATCH_AFTER_MS = 30 * 60_000;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** How far from their own rating a player who has waited since `joinedAt` will be matched. */
export const windowAfter = (joinedAt: number, now: number): number =>
  Math.min(WINDOW_AT_MOST, WINDOW_AT_FIRST + WINDOW_PER_SECOND * Math.max(0, Math.floor((now - joinedAt) / 1000)));

interface Formed {
  matchId: string;
  userIds: string[];
}

/** The queue state of a player who is not waiting: in a match, perhaps, or locked out of ranked play for a while. */
function notQueued(now: number, matchId: string | null = null, lockedUntil: number | null = null): QueueState {
  const locked = lockedUntil !== null && lockedUntil > now ? lockedUntil : null;
  const serverNow = new Date(now).toISOString();
  return { queued: false, kind: null, waiting: 0, matchId, startsAt: null, since: null, serverNow, window: null, typicalWaitSeconds: null, lockedUntil: iso(locked) };
}

/** The items in a random order (Fisher-Yates). */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other] as T, result[index] as T];
  }
  return result;
}

/** The players of a match about to be made, in seat order, and the one of them who picks the places: whoever waited longest. */
interface Lineup {
  seats: Array<{ userId: string; team: Team }>;
  resolverId: string;
}

/** Starts a match for these players, whose queue entries the caller holds, and takes them out of the queue. */
async function startFor(tx: Queryable, kind: QueueKind, { seats, resolverId }: Lineup, now: number): Promise<Formed> {
  const match = newMatch(kind, QUEUE_SETTINGS[kind], resolverId, { phase: 'preparing', code: null, prepareEndsAt: now + PREPARE_MS });
  await insertMatch(tx, match, now);
  await insertPlayers(tx, match.id, seats.map(({ userId, team }, seat) => ({ userId, seat, team })), now);
  const userIds = seats.map(({ userId }) => userId);
  await noteWaits(tx, userIds, now);
  await removeAllFromQueue(tx, userIds);
  return { matchId: match.id, userIds };
}

/** True when each was the other's last ranked opponent, and recently. */
const justPlayed = (one: Waiting, other: Waiting, now: number): boolean =>
  one.lastOpponent === other.userId && other.lastOpponent === one.userId && one.lastRankedAt !== null && now - one.lastRankedAt < REMATCH_AFTER_MS;

/**
 * The ranked duels to make from those waiting. Two players can meet when
 * their ratings are within the wider of their two windows, a window that
 * grows the longer its player has waited. The closest pair is made first.
 * Two who have just played each other are kept apart while a third is waiting.
 */
export function rankedPairs(waiting: Waiting[], now: number): Array<[Waiting, Waiting]> {
  const candidates = waiting.flatMap((one, index) =>
    waiting.slice(index + 1).flatMap((other): Array<{ pair: [Waiting, Waiting]; gap: number }> => {
      const gap = Math.abs(one.rating - other.rating);
      const within = gap <= Math.max(windowAfter(one.joinedAt, now), windowAfter(other.joinedAt, now));
      const rematch = waiting.length > 2 && justPlayed(one, other, now);
      return within && !rematch ? [{ pair: [one, other], gap }] : [];
    }),
  );
  // `waiting` is longest-waiting first, and the sort is stable: among equal gaps the pair that has waited longest goes first.
  const byGap = [...candidates].sort((left, right) => left.gap - right.gap);
  const taken = new Set<string>();
  return byGap.flatMap(({ pair }) => {
    if (pair.some((player) => taken.has(player.userId))) {
      return [];
    }
    pair.forEach((player) => taken.add(player.userId));
    return [pair];
  });
}

/**
 * The 2v2 matches to make from those waiting. Players count in units: one
 * alone, or two who queued as a pair and both still wait. Units are taken
 * longest-waiting first while they fit, until four players are found. A pair
 * is a team; players who came alone are dealt into teams at random.
 */
export function teamMatches(waiting: Waiting[]): Lineup[] {
  const units = waiting.reduce<Waiting[][]>((made, player) => {
    const mates = made.find((unit) => unit.length === 1 && player.groupId !== null && unit[0]?.groupId === player.groupId);
    return mates ? made.map((unit) => (unit === mates ? [...unit, player] : unit)) : [...made, [player]];
  }, []);
  const matches: Lineup[] = [];
  let left = units;
  for (;;) {
    const chosen: Waiting[][] = [];
    for (const unit of left) {
      if (chosen.flat().length + unit.length <= QUEUE_SIZE.team) {
        chosen.push(unit);
      }
    }
    if (chosen.flat().length < QUEUE_SIZE.team) {
      return matches;
    }
    const pairs = chosen.filter((unit) => unit.length === 2);
    const singles = shuffled(chosen.filter((unit) => unit.length === 1).flat());
    // Two pairs face each other; one pair faces the two who came alone; four alone are split two and two.
    const sides: Waiting[][] = pairs.length === 2 ? pairs : pairs.length === 1 ? [pairs.flat(), singles] : [singles.slice(0, 2), singles.slice(2)];
    const [longest] = waiting.filter((player) => chosen.flat().includes(player));
    matches.push({ seats: sides.flatMap((side, team) => side.map((player) => ({ userId: player.userId, team: team as 0 | 1 }))), resolverId: longest?.userId ?? '' });
    left = left.filter((unit) => !chosen.includes(unit));
  }
}

/** Makes every ranked duel or 2v2 match that those waiting allow, one request at a time. */
async function formMatches(db: Db, kind: Exclude<QueueKind, typeof PUBLIC>, now: number): Promise<{ formed: Formed[]; waiting: string[] }> {
  return db.transaction(async (tx) => {
    await lockGathering(tx, kind);
    const everyone = await everyoneWaiting(tx, kind, now);
    const formed: Formed[] = [];
    if (kind === 'ranked') {
      for (const [one, other] of rankedPairs(everyone, now)) {
        formed.push(await startFor(tx, kind, { seats: [one, other].map(({ userId }) => ({ userId, team: null })), resolverId: one.userId }, now));
        await notePairing(tx, one.userId, other.userId, now);
      }
    } else {
      for (const lineup of teamMatches(everyone)) {
        formed.push(await startFor(tx, kind, lineup, now));
      }
    }
    const matched = formed.flatMap((match) => match.userIds);
    return { formed, waiting: everyone.map((player) => player.userId).filter((id) => !matched.includes(id)) };
  });
}

interface Gathering {
  /** Who is still waiting, longest first, after any match was started. */
  waiting: string[];
  /** When the countdown for those waiting ends, if one is running. */
  startsAt: number | null;
  formed: Formed | null;
}

/**
 * Looks after the public queue: starts the countdown when a second player is
 * waiting, cancels it when fewer than two are, and when it has run out starts
 * a game for up to ten of those waiting, longest first.
 *
 * Everything is decided while holding the queue's gathering row, so of any
 * number of requests arriving as a countdown ends, one starts the game and
 * the rest find those players gone from the queue.
 */
async function gather(db: Db, now: number): Promise<Gathering> {
  return db.transaction(async (tx) => {
    const startsAt = await lockGathering(tx, PUBLIC);
    const everyone = (await everyoneWaiting(tx, PUBLIC, now)).map((player) => player.userId);
    const due = startsAt !== null && now >= startsAt && everyone.length >= MIN_PUBLIC_PLAYERS;
    const seats = everyone.slice(0, MAX_PUBLIC_PLAYERS).map((userId) => ({ userId, team: null }));
    const formed = due ? await startFor(tx, PUBLIC, { seats, resolverId: everyone[0] ?? '' }, now) : null;
    const waiting = formed ? everyone.slice(MAX_PUBLIC_PLAYERS) : everyone;
    // Those left over from a full game, if there are two of them, start counting down to the next.
    const fresh = formed !== null || startsAt === null;
    const next = waiting.length < MIN_PUBLIC_PLAYERS ? null : fresh ? now + GATHER_MS : startsAt;
    if (next !== startsAt) {
      await setGathering(tx, PUBLIC, next);
    }
    return { waiting, startsAt: next, formed };
  });
}

/**
 * Where the player stands: waiting, matched, or neither. Counts as their
 * queue heartbeat, and is the moment matches get made, since nothing runs
 * between requests.
 */
export async function pollQueue(db: Db, userId: string, now: number): Promise<QueueState> {
  // The heartbeat is its own statement, not part of the transaction that
  // forms a match, so it never holds the entry while matches are being made.
  const entry = await touchQueueEntry(db, userId, now);
  if (entry === null) {
    const { matchId, lockedUntil } = await standingOf(db, userId);
    return notQueued(now, matchId, lockedUntil);
  }
  const typicalWaitSeconds = await typicalWait(db, entry.kind, now);
  const base = { queued: true, kind: entry.kind, matchId: null, since: iso(entry.joinedAt), serverNow: new Date(now).toISOString(), typicalWaitSeconds, lockedUntil: null };
  if (entry.kind === PUBLIC) {
    const { waiting, startsAt, formed } = await gather(db, now);
    if (formed?.userIds.includes(userId) || !waiting.includes(userId)) {
      // In the game just started, or in one another request started a moment ago.
      return notQueued(now, formed?.userIds.includes(userId) ? formed.matchId : await openMatchOf(db, userId));
    }
    return { ...base, waiting: waiting.length, startsAt: iso(startsAt), window: null };
  }
  const { formed, waiting } = await formMatches(db, entry.kind, now);
  const mine = formed.find((match) => match.userIds.includes(userId));
  if (mine || !waiting.includes(userId)) {
    return notQueued(now, mine ? mine.matchId : await openMatchOf(db, userId));
  }
  return { ...base, waiting: waiting.length, startsAt: null, window: entry.kind === 'ranked' ? windowAfter(entry.joinedAt, now) : null };
}

/** How many public games under way a new arrival is tried against before they are left to wait in the queue. */
const GAMES_TRIED = 3;

/**
 * Seats the player in a public game already under way, if one can take them,
 * and says which. Each game is looked at while holding it, so of two players
 * after its last seat one gets it, and a game that has just moved on to a
 * round too late, or ended, is passed over.
 *
 * The game is brought up to the clock here only as far as moving between
 * rounds. If it is due to finish, that is left for one of its own players'
 * requests: finishing pays XP into accounts, and this caller already holds
 * its own.
 */
async function joinRunning(tx: Queryable, userId: string, now: number): Promise<string | null> {
  for (const matchId of await openPublicMatches(tx, userId, MAX_PUBLIC_PLAYERS, GAMES_TRIED)) {
    const game = await loadMatch(tx, matchId);
    const moved = game ? advance(game.match, game.players, game.guesses, now) : null;
    const from = game && moved && !moved.result ? roundToJoinFrom(moved.match, game.players.length, now) : null;
    if (game && moved && from !== null) {
      if (moved.match !== game.match) {
        await saveMatch(tx, moved.match);
      }
      const seat = Math.max(...game.players.map((player) => player.seat)) + 1;
      await insertPlayers(tx, matchId, [{ userId, seat, team: null, joinedRound: from }], now);
      await noteNoWait(tx, PUBLIC, now);
      return matchId;
    }
  }
  return null;
}

/**
 * Joins a queue, leaving any other. Refused while the player is in an
 * unfinished match, and from the ranked queue while they are locked out of
 * it. A player asking for a public game is put straight into one already
 * under way when there is one that can take them.
 */
export async function joinQueue(db: Db, userId: string, kind: QueueKind, now: number): Promise<Reply<QueueState>> {
  await settleOpenMatch(db, userId, now);
  await tidy(db, now);
  const lockedUntil = kind === 'ranked' ? (await standingOf(db, userId)).lockedUntil : null;
  if (lockedUntil !== null && lockedUntil > now) {
    return refuse(429, `You left two ranked matches before they began. You can queue again in ${Math.ceil((lockedUntil - now) / 1000)} seconds.`);
  }
  const settled = await db.transaction(async (tx): Promise<Reply<QueueState> | null> => {
    if (!(await lockPlayer(tx, userId))) {
      return ACCOUNT_GONE;
    }
    // The entry is written before the check, not after. If the player is
    // already waiting and a match is being formed from that entry at this
    // moment, the write waits for it, and the check then sees that match.
    await enqueue(tx, userId, kind, now);
    if (await openMatchOf(tx, userId)) {
      await removeFromQueue(tx, userId);
      return IN_A_MATCH;
    }
    const matchId = kind === PUBLIC ? await joinRunning(tx, userId, now) : null;
    if (matchId === null) {
      return null;
    }
    await removeFromQueue(tx, userId);
    return accept(notQueued(now, matchId));
  });
  if (settled?.ok) {
    // The player may have been waiting already: if their going leaves one behind, the countdown stops.
    await gather(db, now);
  }
  return settled ?? accept(await pollQueue(db, userId, now));
}

const NOT_A_PAIR = refuse(409, 'To queue as a pair, be the host of a party of exactly two.');

/**
 * Puts the two players of a party lobby into the 2v2 queue as a pair, who
 * will be teammates. The lobby closes; its other player learns of the move
 * from the lobby's state. Only the host can do it, and only for two accounts
 * who are both there.
 */
export async function queueAsPair(db: Db, userId: string, lobbyId: string, now: number): Promise<Reply<QueueState>> {
  const pair = await db.transaction(async (tx): Promise<Reply<string[]>> => {
    const lobby = await loadMatch(tx, lobbyId);
    const { match, players } = lobby ?? { match: null, players: [] };
    // Two accounts, both there, and neither banned: a banned account is put in no queue, as a partner or otherwise.
    const fit = (player: PlayerRecord): boolean => !player.guest && !player.banned && (player.userId === userId || isActive(player, now));
    const ready = players.length === 2 && players.every(fit);
    if (!lobby || !match || match.kind !== 'party' || match.phase !== 'lobby' || match.resolverId !== userId || !ready) {
      return NOT_A_PAIR;
    }
    await closeLobby(tx, lobby, 'team', now);
    return accept(players.map((player) => player.userId));
  });
  if (!pair.ok) {
    return pair;
  }
  // The entries are written once the lobby has let both players go, each in its own statement: nothing is held across them.
  for (const member of pair.data) {
    await enqueue(db, member, 'team', now, lobbyId);
  }
  return accept(await pollQueue(db, userId, now));
}

/** Takes the player out of the queue. Leaving the public queue with one player behind cancels its countdown at once. */
export async function leaveQueue(db: Db, userId: string, now: number): Promise<{ queued: false }> {
  if ((await removeFromQueue(db, userId)) === PUBLIC) {
    await gather(db, now);
  }
  return { queued: false };
}
