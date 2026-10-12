import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { communitySlugOf } from '../account/input.js';
import { deleteOldGuests } from '../account/identity.js';
import type { Db } from '../db/client.js';
import { isOpenTo } from '../db/maps.js';
import { deleteOldMatches, insertMatch, insertPlayers, loadMatch, lockPlayer, matchIdForCode, openMatchOf, touchPlayer, type Seated } from '../db/matches.js';
import { deleteLapsedEntries, deleteOldWaits, removeFromQueue } from '../db/queue.js';
import { purgeRateLimits } from '../db/rate-limit.js';
import type { Settings } from './input.js';
import { hasTeams, roundToJoinFrom } from './machine.js';
import { KICKED, settle, settleOpenMatch } from './play.js';
import { matchState } from './state.js';
import { MAX_PARTY_PLAYERS, accept, refuse, type MatchKind, type MatchRecord, type MatchState, type PlayerRecord, type Reply, type Snapshot, type Team } from './types.js';

export const ACCOUNT_GONE = refuse(401, 'Sign in first.');
export const IN_A_MATCH = refuse(409, 'You are already in a match. Leave it before you start another.');

const CODE_LENGTH = 6;
// No 0, O, 1, I or L: a code is read aloud and typed in.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_ATTEMPTS = 5;
const SEED_BYTES = 8;

/** What a host chooses. How players may talk, and whether there are teams, may be left to the defaults. */
export type PartySettings = Pick<Settings, 'map' | 'mode' | 'timeLimit' | 'rounds'> & Partial<Pick<Settings, 'communication' | 'teams' | 'guests'>>;

export const partyCode = (): string => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** A match that has just been made, before anything has happened in it. */
export function newMatch(kind: MatchKind, settings: Settings, resolverId: string, start: Pick<MatchRecord, 'phase' | 'code' | 'prepareEndsAt'>): MatchRecord {
  return {
    id: randomUUID(),
    kind,
    settings,
    locked: false,
    // The same alphabet as a singleplayer seed, so the resolver picks places with it exactly as singleplayer does.
    seed: randomBytes(SEED_BYTES).toString('hex'),
    resolverId,
    pickerId: null,
    round: 0,
    roundStartsAt: null,
    roundEndsAt: null,
    revealEndsAt: null,
    places: null,
    scaleKm: null,
    outcome: null,
    finishedAt: null,
    chat: [],
    movedToQueue: null,
    ...start,
  };
}

/** A player as they are the moment they take a seat. */
export function seatedPlayer(userId: string, account: Seated, seat: number, now: number, team: Team = null, joinedRound = 0): PlayerRecord {
  return { userId, ...account, seat, team, lastSeenAt: now, leftAt: null, joinedRound, muted: [], pin: null };
}

/** Deletes what nobody will come back for. Runs when a match or a queue entry is made, which is rare next to polling. */
export async function tidy(db: Db, now: number): Promise<void> {
  await deleteOldMatches(db, now);
  await deleteLapsedEntries(db, now);
  await deleteOldGuests(db, now);
  await purgeRateLimits(db, now);
  await deleteOldWaits(db, now);
}

/**
 * Opens a party with the player as its host, in its lobby. `newCode` is only
 * ever replaced by a test, to make two parties draw the same code.
 */
export async function createParty(db: Db, userId: string, chosen: PartySettings, now: number, newCode: () => string = partyCode): Promise<Reply<MatchState>> {
  const settings: Settings = { communication: 'chat', teams: 'none', guests: true, ...chosen };
  const slug = communitySlugOf(settings.map);
  // A map whose maker is banned or gone is nobody else's to play on.
  if (slug !== null && !(await isOpenTo(db, slug, userId))) {
    return refuse(404, 'That map does not exist.');
  }
  await settleOpenMatch(db, userId, now);
  await tidy(db, now);
  return db.transaction(async (tx) => {
    const account = await lockPlayer(tx, userId);
    if (!account) {
      return ACCOUNT_GONE;
    }
    // Leaving the queue comes first: it waits for a match being formed from
    // that entry at this moment, so the check below sees that match.
    await removeFromQueue(tx, userId);
    if (await openMatchOf(tx, userId)) {
      return IN_A_MATCH;
    }
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const match = newMatch('party', settings, userId, { phase: 'lobby', code: newCode(), prepareEndsAt: null });
      if (await insertMatch(tx, match, now)) {
        await insertPlayers(tx, match.id, [{ userId, seat: 0, team: null }], now);
        const host = seatedPlayer(userId, account, 0, now);
        return accept(matchState({ match, players: [host], guesses: [], barred: [] }, host, now));
      }
    }
    throw new Error('Could not find a free party code');
  });
}

/** The team a new arrival goes to in a party with teams under way: the smaller one. None in a lobby, where players pick. */
function teamFor({ match, players }: Snapshot): Team {
  if (!hasTeams(match) || match.phase === 'lobby') {
    return null;
  }
  const size = (team: Team): number => players.filter((player) => player.team === team && player.leftAt === null).length;
  return size(0) <= size(1) ? 0 : 1;
}

/** Why the party cannot take this one more player, if it cannot. */
function refusalToSeat(snapshot: Snapshot, joining: Seated, now: number): Reply<never> | null {
  const { match, players } = snapshot;
  if (match.phase === 'finished') {
    return refuse(409, 'That party has ended.');
  }
  if (joining.guest && !match.settings.guests) {
    return refuse(403, 'This party is for accounts only. Make an account to join.');
  }
  if (match.locked) {
    return refuse(409, 'That party is locked.');
  }
  if (players.length >= MAX_PARTY_PLAYERS) {
    return refuse(409, `That party is full: it has ${MAX_PARTY_PLAYERS} players.`);
  }
  if (match.phase !== 'lobby' && roundToJoinFrom(match, players.length, now) === null) {
    return refuse(409, 'That party is on its last round. Try again when it is back in its lobby.');
  }
  return null;
}

/**
 * Joins the party with that code: its lobby, or a game under way, from the
 * next round to start. Joining a party the player is already in answers
 * with its state.
 */
export async function joinParty(db: Db, userId: string, code: string, now: number): Promise<Reply<MatchState>> {
  await settleOpenMatch(db, userId, now);
  return db.transaction(async (tx) => {
    const account = await lockPlayer(tx, userId);
    if (!account) {
      return ACCOUNT_GONE;
    }
    await removeFromQueue(tx, userId);
    const matchId = await matchIdForCode(tx, code);
    const loaded = matchId === null ? null : await loadMatch(tx, matchId);
    if (!loaded) {
      return refuse(404, 'No party has that code.');
    }
    if (loaded.barred.includes(userId)) {
      return KICKED;
    }
    const already = loaded.players.find((player) => player.userId === userId && player.leftAt === null);
    if (already && loaded.match.phase !== 'finished') {
      await touchPlayer(tx, loaded.match.id, userId, now);
      const me = { ...already, lastSeenAt: Math.max(already.lastSeenAt, now) };
      const players = loaded.players.map((player) => (player.userId === userId ? me : player));
      return accept(matchState(await settle(tx, { ...loaded, players }, now), me, now));
    }
    const snapshot = await settle(tx, loaded, now);
    // Someone who left this party while it was being played has a seat in it already, and does not get a second.
    const cannot = snapshot.players.some((player) => player.userId === userId) ? refuse(409, 'That party has already started.') : refusalToSeat(snapshot, account, now);
    if (cannot) {
      return cannot;
    }
    if (await openMatchOf(tx, userId)) {
      return IN_A_MATCH;
    }
    const seat = Math.max(...snapshot.players.map((player) => player.seat)) + 1 + snapshot.barred.length;
    const joinedRound = snapshot.match.phase === 'lobby' ? 0 : (roundToJoinFrom(snapshot.match, snapshot.players.length, now) ?? 0);
    const team = teamFor(snapshot);
    await insertPlayers(tx, snapshot.match.id, [{ userId, seat, team, joinedRound }], now);
    const me = seatedPlayer(userId, account, seat, now, team, joinedRound);
    return accept(matchState({ ...snapshot, players: [...snapshot.players, me] }, me, now));
  });
}
