import { randomInt, randomUUID } from 'node:crypto';
import { xpForScores } from '../account/progress.js';
import type { Db, Queryable } from '../db/client.js';
import {
  busyElsewhere,
  closePlayers,
  insertGuess,
  insertHistory,
  loadMatch,
  lockPlayers,
  lockRatings,
  markKicked,
  markLeft,
  openMatchOf,
  removePlayer,
  reseat,
  saveChat,
  saveMatch,
  setMuted,
  setPin,
  setTeams,
  touchPlayer,
  winsOver,
  type HistoryRow,
} from '../db/matches.js';
import { addXp, applyDuel, countTeamMatch, utcDay } from '../db/progress.js';
import { enqueue, recordDodge } from '../db/queue.js';
import { isTooSoon, maskWords, withEntry, type Emote } from './chat.js';
import { rate } from './elo.js';
import type { Settings } from './input.js';
import { advance, cutShort, hasTeams, isActive, revealed, type MatchResult } from './machine.js';
import type { SentPlace } from '../places/check.js';
import { groundFor, type Ground } from './places.js';
import { distanceKm, scoreForDistance } from './scoring.js';
import { matchState } from './state.js';
import {
  COUNTDOWN_MS,
  INACTIVE_AFTER_MS,
  MIN_PARTY_PLAYERS,
  PREPARE_MS,
  accept,
  refuse,
  type GuessRecord,
  type MatchRecord,
  type MatchState,
  type Outcome,
  type PlayerRecord,
  type Reply,
  type Snapshot,
} from './types.js';

// One answer for a match that does not exist and for one the asker is not in.
const NO_SUCH_MATCH = refuse(404, 'That match does not exist, or you are not in it.');
export const KICKED = refuse(403, 'You were removed from that party.');
const HOST_ONLY = refuse(403, 'Only the host can do that.');
const NO_SUCH_PLAYER = refuse(409, 'There is no such player in this match.');
const NOT_YOURSELF = refuse(409, 'You cannot do that to yourself.');
const TEAMS_OFF = refuse(409, 'Teams are off in this party.');
/** How many writes one player may send one match in a minute: far more than play needs, and few enough to stop a flood. */
export const WRITES_PER_MINUTE = 240;
export const SLOW_DOWN = 'Too many requests. Slow down a little.';
const TOO_MANY = refuse(429, SLOW_DOWN);

/** A second early exit from a ranked duel within this long locks the player out of the ranked queue... */
const DODGE_WINDOW_MS = 60 * 60_000;
/** ...for this long. */
const DODGE_LOCK_MS = 120_000;
const MAX_ROUND_SCORE = 5000;
/** A ranked duel pays twice the XP of any other match. */
const RANKED_XP = 2;

type RatingChange = Outcome['ratingChanges'][number] & { userId: string };

/**
 * Moves both players' ratings for a finished ranked duel, each by their own
 * K, and counts the win, loss or tie on each account. Nothing changes if
 * either account is gone.
 */
async function applyRatings(tx: Queryable, matchPlayers: PlayerRecord[], winners: string[], now: number): Promise<RatingChange[]> {
  const [first, second] = matchPlayers;
  if (!first || !second) {
    return [];
  }
  const ratings = await lockRatings(tx, first.userId, second.userId);
  const [a, b] = [ratings.get(first.userId), ratings.get(second.userId)];
  if (!a || !b) {
    return [];
  }
  const score = winners.length === 0 ? 0.5 : winners.includes(first.userId) ? 1 : 0;
  const [winner, loser] = score === 1 ? [first, second] : [second, first];
  const startOfDay = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
  // A draw has no winner to pay less.
  const nthWin = score === 0.5 ? 1 : (await winsOver(tx, winner.userId, loser.userId, startOfDay)) + 1;
  const after = rate(a, b, score, nthWin);
  const went = (own: 0 | 0.5 | 1): 'win' | 'loss' | 'tie' => (own === 1 ? 'win' : own === 0 ? 'loss' : 'tie');
  await applyDuel(tx, first.userId, after[0], went(score), now);
  await applyDuel(tx, second.userId, after[1], went((1 - score) as 0 | 0.5 | 1), now);
  return [
    { userId: first.userId, username: first.username, before: a.rating, after: after[0] },
    { userId: second.userId, username: second.username, before: b.rating, after: after[1] },
  ];
}

/** The XP a player's own guesses earn in this kind of match: none in a party, double in a ranked duel. */
function xpFor(match: MatchRecord, player: PlayerRecord, guesses: GuessRecord[]): number {
  if (match.kind === 'party' || player.guest) {
    return 0;
  }
  const earned = xpForScores(guesses.filter((guess) => guess.userId === player.userId).map((guess) => guess.score));
  return match.kind === 'ranked' ? earned * RANKED_XP : earned;
}

/** One account's line in its history for a match that has just finished. */
function historyOf(snapshot: Snapshot, result: MatchResult, player: PlayerRecord, changes: RatingChange[]): HistoryRow {
  const { match, players, guesses } = snapshot;
  const mine = guesses.filter((guess) => guess.userId === player.userId);
  // Every round that got as far as being played, whether or not this player guessed in it.
  const played = match.places === null ? [] : match.places.slice(0, match.round + 1);
  const rating = changes.find((change) => change.userId === player.userId);
  return {
    id: randomUUID(),
    userId: player.userId,
    // A cancelled match was neither won nor lost.
    result: !result.rated ? null : result.winners.length === 0 ? 'draw' : result.winners.includes(player.userId) ? 'win' : 'loss',
    score: mine.reduce((sum, guess) => sum + guess.score, 0),
    maxScore: played.length * MAX_ROUND_SCORE,
    ratingBefore: rating?.before ?? null,
    ratingAfter: rating?.after ?? null,
    xpEarned: xpFor(match, player, guesses),
    opponentId: match.kind === 'ranked' ? (players.find((other) => other.userId !== player.userId)?.userId ?? null) : null,
    rounds: played.map((place, round) => {
      const guess = mine.find((made) => made.round === round);
      return {
        country: place.country,
        distanceKm: guess?.distanceKm ?? null,
        score: guess?.score ?? 0,
        lng: place.lng,
        lat: place.lat,
        guessLng: guess?.lng ?? null,
        guessLat: guess?.lat ?? null,
      };
    }),
  };
}

/**
 * What follows a ranked duel one player walked out of before its first
 * guess: the walk-out is noted against them, and the player they left
 * standing goes back into the ranked queue without having to ask.
 */
async function afterDodge(tx: Queryable, players: PlayerRecord[], dodgerId: string, now: number): Promise<void> {
  await recordDodge(tx, dodgerId, now, DODGE_WINDOW_MS, DODGE_LOCK_MS);
  // Unless they have been banned meanwhile: a banned account is in no queue.
  for (const stood of players.filter((player) => player.userId !== dodgerId && !player.banned)) {
    await enqueue(tx, stood.userId, 'ranked', now);
  }
}

/** Stores a match that has just finished: its outcome, the ratings and XP it moved, its place in each account's history, and its players set free. */
async function conclude(tx: Queryable, snapshot: Snapshot, result: MatchResult, now: number): Promise<Snapshot> {
  const { players } = snapshot;
  const rated = snapshot.match.kind === 'ranked' && result.rated;
  const changes = rated ? await applyRatings(tx, players, result.winners, now) : [];
  const outcome: Outcome = {
    winners: players.filter((player) => result.winners.includes(player.userId)).map((player) => player.username),
    ratingChanges: changes.map(({ username, before, after }) => ({ username, before, after })),
    dodgedBy: players.find((player) => player.userId === result.dodgedBy)?.username ?? null,
  };
  const match: MatchRecord = { ...snapshot.match, outcome };
  await saveMatch(tx, match);
  // Accounts are taken in the same order every time, so two matches finishing at once that share players cannot wait on each other.
  const accounts = players.filter((player) => !player.guest).sort((one, other) => one.userId.localeCompare(other.userId));
  for (const player of accounts) {
    const xp = xpFor(match, player, snapshot.guesses);
    if (xp > 0) {
      await addXp(tx, player.userId, xp, now);
    }
    if (match.kind === 'team' && result.rated) {
      await countTeamMatch(tx, player.userId, result.winners.length === 0 ? 'tie' : result.winners.includes(player.userId) ? 'win' : 'loss');
    }
  }
  // A match that never got as far as its places was not a game, and is in nobody's history.
  if (accounts.length > 0 && match.places !== null) {
    const rows = accounts.map((player) => historyOf({ ...snapshot, match }, result, player, changes));
    await insertHistory(tx, match, players.length, rows, now);
  }
  await closePlayers(tx, match.id);
  if (result.dodgedBy !== null) {
    await afterDodge(tx, players, result.dodgedBy, now);
  }
  const ratingOf = new Map(changes.map((change) => [change.userId, change.after]));
  return { ...snapshot, match, players: players.map((player) => ({ ...player, rating: ratingOf.get(player.userId) ?? player.rating })) };
}

/**
 * Brings the match up to the clock and stores what changed. The caller holds
 * the match's row, so a phase is left once, by one request, and a match is
 * finished (and its ratings moved) once.
 */
export async function settle(tx: Queryable, snapshot: Snapshot, now: number): Promise<Snapshot> {
  const { match, result } = advance(snapshot.match, snapshot.players, snapshot.guesses, now);
  if (match === snapshot.match) {
    return snapshot;
  }
  if (result) {
    return conclude(tx, { ...snapshot, match }, result, now);
  }
  await saveMatch(tx, match);
  return { ...snapshot, match };
}

/** Ends a lobby without a game, as when its two players go to queue together. Nobody won and nothing is kept of it. */
export async function closeLobby(tx: Queryable, snapshot: Snapshot, movedToQueue: MatchRecord['movedToQueue'], now: number): Promise<Snapshot> {
  const match: MatchRecord = { ...snapshot.match, phase: 'finished', finishedAt: now, movedToQueue };
  return conclude(tx, { ...snapshot, match }, { winners: [], rated: false, dodgedBy: null }, now);
}

/**
 * Brings the unfinished match the player is in, if any, up to the clock. A
 * match everyone has stopped polling stays unfinished until someone asks, and
 * this is the asking: it runs before a player starts something new.
 */
export async function settleOpenMatch(db: Db, userId: string, now: number): Promise<void> {
  const matchId = await openMatchOf(db, userId);
  if (matchId === null) {
    return;
  }
  await db.transaction(async (tx) => {
    const snapshot = await loadMatch(tx, matchId);
    if (snapshot) {
      await settle(tx, snapshot, now);
    }
  });
}

interface Entered {
  snapshot: Snapshot;
  me: PlayerRecord;
}

/**
 * Locks the match for a player in it, counts the request as their heartbeat,
 * and brings the match up to the clock. A refusal when there is no such
 * match, the player is not in it, or the host removed them from it.
 */
async function enter(tx: Queryable, matchId: string, userId: string, now: number, write = false): Promise<Reply<Entered>> {
  const loaded = await loadMatch(tx, matchId);
  if (loaded?.barred.includes(userId)) {
    return KICKED;
  }
  const found = loaded?.players.find((player) => player.userId === userId);
  if (!loaded || !found) {
    return NO_SUCH_MATCH;
  }
  // A finished match still takes heartbeats: they are how a party knows who is there to go back to its lobby.
  if (found.leftAt !== null) {
    return accept({ snapshot: await settle(tx, loaded, now), me: found });
  }
  if ((await touchPlayer(tx, matchId, userId, now, write)) > WRITES_PER_MINUTE) {
    return TOO_MANY;
  }
  const me = { ...found, lastSeenAt: Math.max(found.lastSeenAt, now) };
  const players = loaded.players.map((player) => (player.userId === userId ? me : player));
  return accept({ snapshot: await settle(tx, { ...loaded, players }, now), me });
}

type Step = (tx: Queryable, entered: Entered) => Promise<Reply<Snapshot>>;

/**
 * Runs one player's action on a match, in a transaction that holds the match,
 * and answers with the state afterwards. Everything but a poll is a write,
 * and a player's writes to one match are counted against a limit.
 */
async function act(db: Db, matchId: string, userId: string, now: number, step: Step, write = true): Promise<Reply<MatchState>> {
  return db.transaction(async (tx) => {
    const entered = await enter(tx, matchId, userId, now, write);
    if (!entered.ok) {
      return entered;
    }
    const stepped = await step(tx, entered.data);
    if (!stepped.ok) {
      return stepped;
    }
    const after = await settle(tx, stepped.data, now);
    // The action may have changed the asker: their team, who they muted.
    const me = after.players.find((player) => player.userId === userId) ?? entered.data.me;
    return accept(matchState(after, me, now));
  });
}

/** True for the host of a party who is still in it: the powers go with the seat, and a host who has left has none. */
const isHost = ({ snapshot, me }: Entered): boolean => snapshot.match.kind === 'party' && snapshot.match.resolverId === me.userId && me.leftAt === null;

/** An action only the host of a party may take. */
const asHost =
  (_userId: string, step: Step): Step =>
  (tx, entered) =>
    isHost(entered) ? step(tx, entered) : Promise.resolve(HOST_ONLY);

/** Stores a changed match and carries it forward. */
async function changed(tx: Queryable, snapshot: Snapshot, match: MatchRecord): Promise<Reply<Snapshot>> {
  await saveMatch(tx, match);
  return accept({ ...snapshot, match });
}

/** The other player of that name who is still in the match. */
function other(snapshot: Snapshot, userId: string, username: string): Reply<PlayerRecord> {
  const target = snapshot.players.find((player) => player.username === username && player.leftAt === null);
  if (!target) {
    return NO_SUCH_PLAYER;
  }
  return target.userId === userId ? NOT_YOURSELF : accept(target);
}

/** The match as it stands. Counts as the player's heartbeat. */
export function getMatch(db: Db, userId: string, matchId: string, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (_tx, { snapshot }) => accept(snapshot), false);
}

/** The host changes a party's settings in its lobby. Turning teams off takes everyone off theirs. */
export function configure(db: Db, userId: string, matchId: string, settings: Settings, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      if (snapshot.match.phase !== 'lobby') {
        return accept(snapshot);
      }
      const players = settings.teams === 'none' ? snapshot.players.map((player) => ({ ...player, team: null })) : snapshot.players;
      if (settings.teams === 'none') {
        await setTeams(tx, matchId, players.map(({ userId: id }) => ({ userId: id, team: null })));
      }
      return changed(tx, { ...snapshot, players }, { ...snapshot.match, settings });
    }),
  );
}

/** The players with nobody left without a team: each of those goes, in turn, to whichever team is smaller by then. */
function withEveryoneOnATeam(players: PlayerRecord[]): PlayerRecord[] {
  const size = [players.filter((player) => player.team === 0).length, players.filter((player) => player.team === 1).length];
  return players.map((player) => {
    if (player.team !== null) {
      return player;
    }
    const team = (size[0] ?? 0) <= (size[1] ?? 0) ? 0 : 1;
    size[team] = (size[team] ?? 0) + 1;
    return { ...player, team };
  });
}

/** The host sends a party from its lobby to the resolver. A second start changes nothing. */
export function startMatch(db: Db, userId: string, matchId: string, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (tx, entered) => {
    const { snapshot } = entered;
    const { match } = snapshot;
    if (!isHost(entered)) {
      return HOST_ONLY;
    }
    if (match.phase !== 'lobby') {
      return accept(snapshot);
    }
    // Anyone banned since they sat down is left behind.
    const banned = snapshot.players.filter((player) => player.banned && player.userId !== userId);
    for (const player of banned) {
      await removePlayer(tx, matchId, player.userId);
    }
    const allowed = snapshot.players.filter((player) => !banned.includes(player));
    if (allowed.length < MIN_PARTY_PLAYERS) {
      return refuse(409, `A party needs at least ${MIN_PARTY_PLAYERS} players to start.`);
    }
    const players = hasTeams(match) ? withEveryoneOnATeam(allowed) : allowed;
    if (hasTeams(match)) {
      if (!players.some((player) => player.team === 0) || !players.some((player) => player.team === 1)) {
        return refuse(409, 'Each team needs at least one player.');
      }
      await setTeams(tx, matchId, players.map((player) => ({ userId: player.userId, team: player.team })));
    }
    return changed(tx, { ...snapshot, players }, { ...match, phase: 'preparing', prepareEndsAt: now + PREPARE_MS });
  });
}

/**
 * The resolver gives the match its places, and the first round is scheduled.
 * A second time changes nothing. `groundOf` is asked for the places only
 * once the match is known to be waiting for this player's.
 */
function place(db: Db, userId: string, matchId: string, count: number, groundOf: (tx: Queryable, match: MatchRecord) => Promise<Reply<Ground>>, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (tx, { snapshot }) => {
    const { match } = snapshot;
    if (match.resolverId !== userId) {
      return refuse(403, 'Only the player picking the places can post them.');
    }
    if (match.phase !== 'preparing') {
      return accept(snapshot);
    }
    if (count !== match.settings.rounds) {
      return refuse(400, `This match needs exactly ${match.settings.rounds} places.`);
    }
    const ground = await groundOf(tx, match);
    if (!ground.ok) {
      return ground;
    }
    const startsAt = now + COUNTDOWN_MS;
    const { timeLimit } = match.settings;
    return changed(tx, snapshot, {
      ...match,
      phase: 'playing',
      round: 0,
      places: ground.data.places,
      scaleKm: ground.data.scaleKm,
      roundStartsAt: startsAt,
      roundEndsAt: timeLimit === 0 ? null : startsAt + timeLimit * 1000,
    });
  });
}

/**
 * Starts a match on places and a scale that are already the server's own.
 * Nothing a browser sent comes this way: see `postSentPlaces`.
 */
export function postPlaces(db: Db, userId: string, input: { matchId: string } & Ground, now: number): Promise<Reply<MatchState>> {
  return place(db, userId, input.matchId, input.places.length, () => Promise.resolve(accept({ places: input.places, scaleKm: input.scaleKm })), now);
}

/** The resolver's browser posts the places it drew. They are checked against the match's map, and scored on the server's scale. */
export function postSentPlaces(db: Db, userId: string, input: { matchId: string; places: SentPlace[] }, now: number): Promise<Reply<MatchState>> {
  return place(db, userId, input.matchId, input.places.length, (tx, match) => groundFor(tx, match, input.places), now);
}

/** True while the player may act in the round they name: it is the one being played, it has started, and they are in the game for it. */
function mayPlay({ match }: Snapshot, me: PlayerRecord, round: number, now: number): boolean {
  const open = match.phase === 'playing' && round === match.round && match.roundStartsAt !== null && now >= match.roundStartsAt;
  // A player who joined a game under way plays from the round after the one they arrived in.
  return open && me.leftAt === null && round >= me.joinedRound;
}

/**
 * Scores a player's guess for the round being played. A guess for any other
 * round, a second guess, or one outside the round's time is ignored: the
 * answer is the state as it is. A guess that leaves one player to go cuts
 * the round's remaining time.
 */
export function guess(
  db: Db,
  userId: string,
  input: { matchId: string; round: number; lng: number; lat: number },
  now: number,
): Promise<Reply<MatchState>> {
  return act(db, input.matchId, userId, now, async (tx, { snapshot, me }) => {
    const { match } = snapshot;
    const place = match.places?.[input.round];
    if (!mayPlay(snapshot, me, input.round, now) || !place || match.scaleKm === null) {
      return accept(snapshot);
    }
    const distance = distanceKm(place, input);
    const scored: GuessRecord = {
      userId,
      round: input.round,
      lng: input.lng,
      lat: input.lat,
      distanceKm: distance,
      score: scoreForDistance(distance, match.scaleKm),
    };
    if (!(await insertGuess(tx, match.id, scored))) {
      return accept(snapshot);
    }
    const guesses = [...snapshot.guesses, scored];
    const cut = cutShort(match, snapshot.players, guesses, now);
    return cut === match ? accept({ ...snapshot, guesses }) : changed(tx, { ...snapshot, guesses }, cut);
  });
}

/** Records where the player's pin is, for their teammates to see while the round is played. */
export function pin(db: Db, userId: string, input: { matchId: string; round: number; lng: number; lat: number }, now: number): Promise<Reply<MatchState>> {
  return act(db, input.matchId, userId, now, async (tx, { snapshot, me }) => {
    if (!hasTeams(snapshot.match) || !mayPlay(snapshot, me, input.round, now)) {
      return accept(snapshot);
    }
    const placed = { round: input.round, lng: input.lng, lat: input.lat };
    await setPin(tx, input.matchId, userId, placed);
    return accept({ ...snapshot, players: snapshot.players.map((player) => (player.userId === userId ? { ...player, pin: placed } : player)) });
  });
}

/** The player picks a team in the lobby of a party with teams. */
export function pickTeam(db: Db, userId: string, matchId: string, team: 0 | 1, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (tx, { snapshot }) => {
    if (snapshot.match.kind !== 'party' || !hasTeams(snapshot.match)) {
      return TEAMS_OFF;
    }
    if (snapshot.match.phase !== 'lobby') {
      return accept(snapshot);
    }
    await setTeams(tx, matchId, [{ userId, team }]);
    return accept({ ...snapshot, players: snapshot.players.map((player) => (player.userId === userId ? { ...player, team } : player)) });
  });
}

/** The players in a random order (Fisher-Yates). */
function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap] as T, result[index] as T];
  }
  return result;
}

/** The host deals the lobby's players into two teams at random, as evenly as their number allows. */
export function shuffleTeams(db: Db, userId: string, matchId: string, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      if (!hasTeams(snapshot.match)) {
        return TEAMS_OFF;
      }
      if (snapshot.match.phase !== 'lobby') {
        return accept(snapshot);
      }
      const teamOf = new Map(shuffled(snapshot.players).map((player, index) => [player.userId, (index % 2) as 0 | 1]));
      const players = snapshot.players.map((player) => ({ ...player, team: teamOf.get(player.userId) ?? null }));
      await setTeams(tx, matchId, players.map((player) => ({ userId: player.userId, team: player.team })));
      return accept({ ...snapshot, players });
    }),
  );
}

/** The host removes a player, who may not come back to this party. */
export function kick(db: Db, userId: string, matchId: string, username: string, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      const target = other(snapshot, userId, username);
      if (!target.ok) {
        return target;
      }
      const gone = target.data.userId;
      await markKicked(tx, matchId, gone, now);
      return accept({ ...snapshot, players: snapshot.players.filter((player) => player.userId !== gone), barred: [...snapshot.barred, gone] });
    }),
  );
}

/** The host hands the party over to another player, who also takes over picking the places. */
export function handOver(db: Db, userId: string, matchId: string, username: string, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      const target = other(snapshot, userId, username);
      if (!target.ok) {
        return target;
      }
      if (target.data.guest) {
        return refuse(409, 'A guest cannot host.');
      }
      // While the places are being picked, the one picking them cannot change.
      return snapshot.match.phase === 'preparing' ? accept(snapshot) : changed(tx, snapshot, { ...snapshot.match, resolverId: target.data.userId });
    }),
  );
}

/** The host closes the party to new players, or opens it again. */
export function lock(db: Db, userId: string, matchId: string, locked: boolean, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, asHost(userId, (tx, { snapshot }) => changed(tx, snapshot, { ...snapshot.match, locked })));
}

/** The host ends the round being played, as when a round has no timer and someone will not guess. */
export function endRound(db: Db, userId: string, matchId: string, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      const { match } = snapshot;
      const underWay = match.phase === 'playing' && match.roundStartsAt !== null && now >= match.roundStartsAt;
      return underWay ? changed(tx, snapshot, revealed(match, snapshot.players, snapshot.guesses, now)) : accept(snapshot);
    }),
  );
}

/**
 * The host takes a finished party back to its lobby, with the same code and
 * settings. Everyone who is still there comes along: those who have polled
 * lately and have not gone off into another match. The rest are dropped.
 */
export function backToLobby(db: Db, userId: string, matchId: string, now: number): Promise<Reply<MatchState>> {
  return act(
    db,
    matchId,
    userId,
    now,
    asHost(userId, async (tx, { snapshot }) => {
      if (snapshot.match.phase !== 'finished') {
        return accept(snapshot);
      }
      // A player banned since the game began does not come back with the others.
      const here = (player: PlayerRecord): boolean => player.userId === userId || (player.lastSeenAt > now - INACTIVE_AFTER_MS && !player.banned);
      const there = snapshot.players.filter((player) => player.leftAt === null && here(player));
      // Holding their accounts keeps any of them from taking a seat elsewhere while they are seated here again.
      await lockPlayers(tx, there.map((player) => player.userId));
      const busy = await busyElsewhere(tx, there.map((player) => player.userId), matchId);
      if (busy.includes(userId)) {
        return refuse(409, 'You are already in a match. Leave it before you start another.');
      }
      const staying = there.filter((player) => !busy.includes(player.userId));
      await reseat(tx, matchId, staying.map((player) => player.userId));
      await saveChat(tx, matchId, []);
      const lobby: MatchRecord = {
        ...snapshot.match,
        phase: 'lobby',
        round: 0,
        prepareEndsAt: null,
        roundStartsAt: null,
        roundEndsAt: null,
        revealEndsAt: null,
        places: null,
        scaleKm: null,
        outcome: null,
        finishedAt: null,
        chat: [],
        movedToQueue: null,
      };
      const players = staying.map((player) => ({ ...player, lastSeenAt: Math.max(player.lastSeenAt, now), joinedRound: 0, muted: [], pin: null }));
      return changed(tx, { ...snapshot, players, guesses: [] }, lobby);
    }),
  );
}

/** The player stops, or starts again, receiving another player's chat for the rest of the match. */
export function mute(db: Db, userId: string, matchId: string, username: string, muted: boolean, now: number): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (tx, { snapshot, me }) => {
    const target = snapshot.players.find((player) => player.username === username);
    if (!target) {
      return NO_SUCH_PLAYER;
    }
    if (target.userId === userId) {
      return NOT_YOURSELF;
    }
    const list = muted ? [...new Set([...me.muted, target.userId])] : me.muted.filter((id) => id !== target.userId);
    await setMuted(tx, matchId, userId, list);
    return accept({ ...snapshot, players: snapshot.players.map((player) => (player.userId === userId ? { ...player, muted: list } : player)) });
  });
}

/** Whether free chat, and whether reactions, may be sent in this match. */
const allowsChat = (match: MatchRecord): boolean => match.kind === 'team' || (match.kind === 'party' && match.settings.communication === 'chat');
const allowsReactions = (match: MatchRecord): boolean => match.kind !== 'party' || match.settings.communication !== 'off';

/** Adds a chat line or a reaction to the match. Each player may send one a second. */
export function say(
  db: Db,
  userId: string,
  matchId: string,
  said: { text: string; emote: null; scope: 'all' | 'team' } | { text: null; emote: Emote },
  now: number,
): Promise<Reply<MatchState>> {
  return act(db, matchId, userId, now, async (tx, { snapshot, me }) => {
    const { match } = snapshot;
    if (me.leftAt !== null) {
      return refuse(403, 'You have left this match.');
    }
    if (said.text !== null && !allowsChat(match)) {
      return refuse(403, 'Chat is off in this match.');
    }
    if (said.text === null && !allowsReactions(match)) {
      return refuse(403, 'Reactions are off in this match.');
    }
    if (isTooSoon(match.chat, userId, now)) {
      return refuse(429, 'One message a second. Try again in a moment.');
    }
    // A line for the team only makes sense where the sender has one.
    const forTeam = said.text !== null && said.scope === 'team' && hasTeams(match) && me.team !== null;
    const chat = withEntry(match.chat, {
      userId,
      username: me.username,
      text: said.text === null ? null : maskWords(said.text),
      emote: said.emote,
      at: new Date(now).toISOString(),
      scope: forTeam ? 'team' : 'all',
      team: forTeam ? me.team : null,
    });
    await saveChat(tx, matchId, chat);
    return accept({ ...snapshot, match: { ...match, chat } });
  });
}

const LEFT = accept({ left: true as const });

/**
 * Who a party passes to when its host leaves: the next account still in it,
 * one who is being heard from before one who is not. Never a guest, who
 * cannot host.
 */
function heirOf(players: PlayerRecord[], now: number): PlayerRecord | undefined {
  const accounts = players.filter((player) => !player.guest && player.leftAt === null);
  return accounts.find((player) => isActive(player, now)) ?? accounts[0];
}

/**
 * Takes the player out of a match. From a lobby they are simply gone, and the
 * host's place passes to whoever joined next. From a match under way they
 * count as inactive from then on.
 */
export function leaveMatch(db: Db, userId: string, matchId: string, now: number): Promise<Reply<{ left: true }>> {
  return db.transaction(async (tx) => {
    const entered = await enter(tx, matchId, userId, now, true);
    if (!entered.ok) {
      return entered;
    }
    const { snapshot, me } = entered.data;
    if (snapshot.match.phase === 'finished' || me.leftAt !== null) {
      return LEFT;
    }
    const wasHost = snapshot.match.kind === 'party' && snapshot.match.resolverId === userId;
    if (snapshot.match.phase !== 'lobby') {
      await markLeft(tx, matchId, userId, now);
      const players = snapshot.players.map((player) => (player.userId === userId ? { ...player, leftAt: now } : player));
      // The party goes on under the next account in it, who can end a round, lock it or take it back to its lobby.
      const heir = wasHost ? heirOf(players, now) : undefined;
      const match: MatchRecord = heir ? { ...snapshot.match, resolverId: heir.userId } : snapshot.match;
      if (heir) {
        await saveMatch(tx, match);
      }
      await settle(tx, { ...snapshot, match, players }, now);
      return LEFT;
    }
    await removePlayer(tx, matchId, userId);
    const players = snapshot.players.filter((player) => player.userId !== userId);
    const heir = wasHost ? heirOf(players, now) : undefined;
    const match: MatchRecord = heir ? { ...snapshot.match, resolverId: heir.userId } : snapshot.match;
    if (heir) {
      await saveMatch(tx, match);
    }
    // With the host gone and only guests left, nobody can start it: it is over.
    const orphaned = wasHost && !heir;
    await (orphaned ? closeLobby(tx, { ...snapshot, match, players }, null, now) : settle(tx, { ...snapshot, match, players }, now));
    return LEFT;
  });
}
