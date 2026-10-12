import type { GuessRecord, MatchRecord, Outcome, PlayerRecord, Snapshot, Team } from '../match/types.js';
import type { Queryable, Row } from './client.js';
import { fromTs, toTs } from './time.js';

/** Finished matches, and unfinished ones nobody has polled, are deleted after this long. */
export const MATCH_KEPT_MS = 24 * 60 * 60_000;

const tsOrNull = (ms: number | null): string | null => (ms === null ? null : toTs(ms));
const msOrNull = (value: unknown): number | null => (value === null ? null : fromTs(value));
const jsonOrNull = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

/** Outcomes stored before a duel could be dodged do not say that nobody dodged it. */
function storedOutcome(value: unknown): Outcome | null {
  const stored = value as (Omit<Outcome, 'dodgedBy'> & { dodgedBy?: string | null }) | null;
  return stored === null ? null : { ...stored, dodgedBy: stored.dodgedBy ?? null };
}

function rowToMatch(row: Row): MatchRecord {
  return {
    id: row.id as string,
    code: row.code as string | null,
    kind: row.kind as MatchRecord['kind'],
    phase: row.phase as MatchRecord['phase'],
    settings: {
      map: row.map as string,
      mode: row.mode as MatchRecord['settings']['mode'],
      timeLimit: row.time_limit as number,
      rounds: row.rounds as number,
      communication: row.communication as MatchRecord['settings']['communication'],
      teams: row.teams as MatchRecord['settings']['teams'],
      guests: row.guests as boolean,
    },
    locked: row.locked as boolean,
    seed: row.seed as string,
    resolverId: row.resolver_id as string,
    pickerId: row.picker_id as string | null,
    round: row.round as number,
    prepareEndsAt: msOrNull(row.prepare_ends_at),
    roundStartsAt: msOrNull(row.round_starts_at),
    roundEndsAt: msOrNull(row.round_ends_at),
    revealEndsAt: msOrNull(row.reveal_ends_at),
    places: row.places as MatchRecord['places'],
    scaleKm: row.scale_km as number | null,
    outcome: storedOutcome(row.outcome),
    finishedAt: msOrNull(row.finished_at),
    chat: row.chat as MatchRecord['chat'],
    movedToQueue: row.moved_to_queue as MatchRecord['movedToQueue'],
  };
}

function rowToPlayer(row: Row): PlayerRecord {
  return {
    userId: row.user_id as string,
    username: row.username as string,
    country: row.country as string | null,
    guest: row.guest as boolean,
    rating: row.rating as number,
    ratedGames: row.rated_games as number,
    seat: row.seat as number,
    team: row.team as Team,
    lastSeenAt: fromTs(row.last_seen_at),
    leftAt: msOrNull(row.left_at),
    joinedRound: row.joined_round as number,
    muted: row.muted as string[],
    pin: row.pin_round === null ? null : { round: row.pin_round as number, lng: row.pin_lng as number, lat: row.pin_lat as number },
    banned: row.banned as boolean,
  };
}

function rowToGuess(row: Row): GuessRecord {
  return {
    userId: row.user_id as string,
    round: row.round as number,
    lng: row.lng as number,
    lat: row.lat as number,
    distanceKm: row.distance_km as number,
    score: row.score as number,
  };
}

/**
 * A match with its players and guesses, holding the match's row. Everything
 * that reads or changes a match goes through this lock, so requests for one
 * match take turns and each sees what the one before it did.
 *
 * A player the host removed stays on record, so that they cannot come back,
 * but is no longer one of the match's players: `barred` is where they are.
 */
export async function loadMatch(tx: Queryable, id: string): Promise<Snapshot | null> {
  const [row] = await tx.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [id]);
  if (!row) {
    return null;
  }
  const seated = await tx.query(
    `SELECT p.user_id, p.seat, p.team, p.last_seen_at, p.left_at, p.joined_round, p.kicked, p.muted, p.pin_round, p.pin_lng, p.pin_lat,
            u.username, u.rating, u.rated_games, u.country, u.guest, u.banned
       FROM match_players p JOIN users u ON u.id = p.user_id
      WHERE p.match_id = $1 ORDER BY p.seat`,
    [id],
  );
  const guesses = await tx.query('SELECT user_id, round, lng, lat, distance_km, score FROM match_guesses WHERE match_id = $1', [id]);
  const barred = seated.filter((player) => player.kicked === true).map((player) => player.user_id as string);
  return {
    match: rowToMatch(row),
    players: seated.filter((player) => player.kicked !== true).map(rowToPlayer),
    guesses: guesses.filter((guess) => !barred.includes(guess.user_id as string)).map(rowToGuess),
    barred,
  };
}

/** False when the code already belongs to another party. */
export async function insertMatch(q: Queryable, match: MatchRecord, now: number): Promise<boolean> {
  const { settings } = match;
  const rows = await q.query(
    `INSERT INTO matches (id, code, kind, phase, map, mode, time_limit, rounds, communication, teams, seed, resolver_id, prepare_ends_at, created_at, guests)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz, $15)
     ON CONFLICT (code) DO NOTHING RETURNING id`,
    [
      match.id,
      match.code,
      match.kind,
      match.phase,
      settings.map,
      settings.mode,
      settings.timeLimit,
      settings.rounds,
      settings.communication,
      settings.teams,
      match.seed,
      match.resolverId,
      tsOrNull(match.prepareEndsAt),
      toTs(now),
      settings.guests,
    ],
  );
  return rows.length === 1;
}

/** Stores everything about a match that can change after it is created, but its chat. */
export async function saveMatch(tx: Queryable, match: MatchRecord): Promise<void> {
  const { settings } = match;
  await tx.query(
    `UPDATE matches SET phase = $2, resolver_id = $3, round = $4, prepare_ends_at = $5::timestamptz, round_starts_at = $6::timestamptz,
            round_ends_at = $7::timestamptz, reveal_ends_at = $8::timestamptz, places = $9::jsonb, scale_km = $10,
            outcome = $11::jsonb, finished_at = $12::timestamptz, map = $13, mode = $14, time_limit = $15, rounds = $16,
            communication = $17, teams = $18, locked = $19, moved_to_queue = $20, guests = $21, picker_id = $22
      WHERE id = $1`,
    [
      match.id,
      match.phase,
      match.resolverId,
      match.round,
      tsOrNull(match.prepareEndsAt),
      tsOrNull(match.roundStartsAt),
      tsOrNull(match.roundEndsAt),
      tsOrNull(match.revealEndsAt),
      jsonOrNull(match.places),
      match.scaleKm,
      jsonOrNull(match.outcome),
      tsOrNull(match.finishedAt),
      settings.map,
      settings.mode,
      settings.timeLimit,
      settings.rounds,
      settings.communication,
      settings.teams,
      match.locked,
      match.movedToQueue,
      settings.guests,
      match.pickerId,
    ],
  );
}

/** A player taking a seat in a match. `joinedRound` is left out for everyone who is there from the start. */
export interface Seat {
  userId: string;
  seat: number;
  team: Team;
  joinedRound?: number;
}

export async function insertPlayers(tx: Queryable, matchId: string, players: Seat[], now: number): Promise<void> {
  const rows = players.map((player) => ({ user_id: player.userId, seat: player.seat, team: player.team, joined_round: player.joinedRound ?? 0 }));
  await tx.query(
    `INSERT INTO match_players (match_id, user_id, seat, team, joined_round, last_seen_at)
     SELECT $1::uuid, p.user_id, p.seat, p.team, p.joined_round, $3::timestamptz
       FROM jsonb_to_recordset($2::jsonb) AS p(user_id uuid, seat integer, team integer, joined_round integer)`,
    [matchId, JSON.stringify(rows), toTs(now)],
  );
}

/**
 * Games of one kind that have not finished, are not full, and that the player
 * has never been in, newest first. Whether one can really take a new player
 * is for the caller to decide once it holds the match: this is only where to look.
 */
export async function openPublicMatches(q: Queryable, userId: string, seats: number, limit: number): Promise<string[]> {
  const rows = await q.query<{ id: string }>(
    `SELECT m.id FROM matches m
      WHERE m.kind = 'unranked' AND m.phase IN ('preparing', 'playing', 'reveal')
        AND (SELECT count(*) FROM match_players p WHERE p.match_id = m.id) < $2
        AND NOT EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.user_id = $1)
      ORDER BY m.created_at DESC, m.id LIMIT $3`,
    [userId, seats, limit],
  );
  return rows.map((row) => row.id);
}

/** Replaces the match's chat. It is small: only the latest few entries are ever kept. */
export async function saveChat(tx: Queryable, matchId: string, chat: MatchRecord['chat']): Promise<void> {
  await tx.query('UPDATE matches SET chat = $2::jsonb WHERE id = $1', [matchId, JSON.stringify(chat)]);
}

/** Over how long a player's writes to a match are counted. */
export const ACTS_WINDOW_MS = 60_000;

/**
 * Records that a player was heard from. When the request is a write it is
 * counted too, in the same statement, and the answer is how many writes the
 * player has sent the match in the window now running: the limit on them
 * costs no query of its own. A poll is not counted, and answers 0.
 */
export async function touchPlayer(tx: Queryable, matchId: string, userId: string, now: number, write = false): Promise<number> {
  const [row] = await tx.query<{ acts: number }>(
    `UPDATE match_players SET last_seen_at = GREATEST(last_seen_at, $3::timestamptz),
            acts = CASE WHEN NOT $4 THEN acts WHEN acts_from IS NULL OR acts_from <= $5::timestamptz THEN 1 ELSE acts + 1 END,
            acts_from = CASE WHEN $4 AND (acts_from IS NULL OR acts_from <= $5::timestamptz) THEN $3::timestamptz ELSE acts_from END
      WHERE match_id = $1 AND user_id = $2 RETURNING acts`,
    [matchId, userId, toTs(now), write, toTs(now - ACTS_WINDOW_MS)],
  );
  return write ? (row?.acts ?? 0) : 0;
}

/** Takes a player out of a lobby, as if they had never joined. */
export async function removePlayer(tx: Queryable, matchId: string, userId: string): Promise<void> {
  await tx.query('DELETE FROM match_players WHERE match_id = $1 AND user_id = $2', [matchId, userId]);
}

/** Marks a player as gone from a match under way. Their guesses stay. */
export async function markLeft(tx: Queryable, matchId: string, userId: string, now: number): Promise<void> {
  await tx.query('UPDATE match_players SET left_at = $3::timestamptz, open = false WHERE match_id = $1 AND user_id = $2', [matchId, userId, toTs(now)]);
}

/** Marks a player as removed by the host: gone, like one who left, and not to be let back in. */
export async function markKicked(tx: Queryable, matchId: string, userId: string, now: number): Promise<void> {
  await tx.query(
    'UPDATE match_players SET kicked = true, open = false, left_at = coalesce(left_at, $3::timestamptz) WHERE match_id = $1 AND user_id = $2',
    [matchId, userId, toTs(now)],
  );
}

/** Puts each of these players on a team, or (with null) on none. */
export async function setTeams(tx: Queryable, matchId: string, teams: Array<{ userId: string; team: Team }>): Promise<void> {
  await tx.query(
    `UPDATE match_players p SET team = t.team
       FROM jsonb_to_recordset($2::jsonb) AS t(user_id uuid, team integer)
      WHERE p.match_id = $1 AND p.user_id = t.user_id`,
    [matchId, JSON.stringify(teams.map(({ userId, team }) => ({ user_id: userId, team })))],
  );
}

/** Records where a player's pin is in a round, for their teammates. */
export async function setPin(tx: Queryable, matchId: string, userId: string, pin: { round: number; lng: number; lat: number }): Promise<void> {
  await tx.query('UPDATE match_players SET pin_round = $3, pin_lng = $4, pin_lat = $5 WHERE match_id = $1 AND user_id = $2', [
    matchId,
    userId,
    pin.round,
    pin.lng,
    pin.lat,
  ]);
}

export async function setMuted(tx: Queryable, matchId: string, userId: string, muted: string[]): Promise<void> {
  await tx.query('UPDATE match_players SET muted = $3::jsonb WHERE match_id = $1 AND user_id = $2', [matchId, userId, JSON.stringify(muted)]);
}

/** Frees everyone in a finished match to play another. */
export async function closePlayers(tx: Queryable, matchId: string): Promise<void> {
  await tx.query('UPDATE match_players SET open = false WHERE match_id = $1 AND open', [matchId]);
}

/**
 * Clears a finished party for another game in its lobby: its guesses go, the
 * players in `staying` are seated again as if they had just joined, and every
 * other player but those the host removed is dropped.
 */
export async function reseat(tx: Queryable, matchId: string, staying: string[]): Promise<void> {
  const ids = JSON.stringify(staying);
  await tx.query('DELETE FROM match_guesses WHERE match_id = $1', [matchId]);
  await tx.query(
    `DELETE FROM match_players WHERE match_id = $1 AND NOT kicked
        AND user_id NOT IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))`,
    [matchId, ids],
  );
  await tx.query(
    `UPDATE match_players SET open = true, left_at = NULL, joined_round = 0, pin_round = NULL, pin_lng = NULL, pin_lat = NULL, muted = '[]'::jsonb
      WHERE match_id = $1 AND NOT kicked`,
    [matchId],
  );
}

/** False when the player had already guessed in that round. */
export async function insertGuess(tx: Queryable, matchId: string, guess: GuessRecord): Promise<boolean> {
  const rows = await tx.query(
    `INSERT INTO match_guesses (match_id, user_id, round, lng, lat, distance_km, score) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (match_id, round, user_id) DO NOTHING RETURNING round`,
    [matchId, guess.userId, guess.round, guess.lng, guess.lat, guess.distanceKm, guess.score],
  );
  return rows.length === 1;
}

/** Puts one player's guesses in a match in another's name. Only where the two never guessed in the same round, as in co-op. */
export async function handGuesses(tx: Queryable, matchId: string, fromUserId: string, toUserId: string): Promise<void> {
  await tx.query('UPDATE match_guesses SET user_id = $3 WHERE match_id = $1 AND user_id = $2', [matchId, fromUserId, toUserId]);
}

/** The unfinished match the player is in, if any. */
export async function openMatchOf(q: Queryable, userId: string): Promise<string | null> {
  const [row] = await q.query<{ match_id: string }>('SELECT match_id FROM match_players WHERE user_id = $1 AND open', [userId]);
  return row?.match_id ?? null;
}

/** Which of these players are in an unfinished match other than this one. */
export async function busyElsewhere(tx: Queryable, userIds: string[], matchId: string): Promise<string[]> {
  const rows = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM match_players
      WHERE open AND match_id <> $2 AND user_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(userIds), matchId],
  );
  return rows.map((row) => row.user_id);
}

export async function matchIdForCode(q: Queryable, code: string): Promise<string | null> {
  const [row] = await q.query<{ id: string }>('SELECT id FROM matches WHERE code = $1', [code]);
  return row?.id ?? null;
}

/** What is known of a player when they take a seat. */
export interface Seated {
  username: string;
  rating: number;
  ratedGames: number;
  country: string | null;
  guest: boolean;
  banned: boolean;
}

/**
 * Holds the player's row, so one player's creates, joins and queue requests
 * take turns. Null when the account is gone or deleted.
 *
 * The lock is NO KEY UPDATE, not UPDATE, on purpose. Forming a match from the
 * queue adds the player to it while holding their queue entry, and that
 * insert takes a key-share lock on this row. A request of the player's own
 * holds this row and then waits for that queue entry: with a full UPDATE
 * lock the two would wait on each other.
 */
export async function lockPlayer(tx: Queryable, userId: string): Promise<Seated | null> {
  const [row] = await tx.query(
    'SELECT username, rating, rated_games, country, guest, banned FROM users WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE',
    [userId],
  );
  return row
    ? {
        username: row.username as string,
        rating: row.rating as number,
        ratedGames: row.rated_games as number,
        country: row.country as string | null,
        guest: row.guest as boolean,
        banned: row.banned as boolean,
      }
    : null;
}

/** Holds these players' rows, always in the same order, so nothing else seats or rates them meanwhile. */
export async function lockPlayers(tx: Queryable, userIds: string[]): Promise<void> {
  await tx.query('SELECT id FROM users WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)) ORDER BY id FOR NO KEY UPDATE', [
    JSON.stringify(userIds),
  ]);
}

/** Two players' ratings and rated games so far, read under a lock on both accounts, always taken in the same order. */
export async function lockRatings(tx: Queryable, a: string, b: string): Promise<Map<string, { rating: number; games: number }>> {
  const rows = await tx.query<{ id: string; rating: number; rated_games: number }>(
    'SELECT id, rating, rated_games FROM users WHERE id IN ($1, $2) ORDER BY id FOR NO KEY UPDATE',
    [a, b],
  );
  return new Map(rows.map((row) => [row.id, { rating: row.rating, games: row.rated_games }]));
}

/** How many ranked duels one player has won against another since `since`. */
export async function winsOver(tx: Queryable, winnerId: string, loserId: string, since: number): Promise<number> {
  const rows = await tx.query(
    `SELECT 1 FROM online_games WHERE user_id = $1 AND opponent_id = $2 AND kind = 'ranked' AND result = 'win' AND played_at >= $3::timestamptz`,
    [winnerId, loserId, toTs(since)],
  );
  return rows.length;
}

/** One account's line in the history of a finished match. */
export interface HistoryRow {
  id: string;
  userId: string;
  result: 'win' | 'loss' | 'draw' | null;
  score: number;
  maxScore: number;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpEarned: number;
  opponentId: string | null;
  rounds: unknown[];
}

/** Saves a finished match for each account that was in it. */
export async function insertHistory(tx: Queryable, match: MatchRecord, players: number, rows: HistoryRow[], now: number): Promise<void> {
  const records = rows.map((row) => ({
    id: row.id,
    user_id: row.userId,
    result: row.result,
    score: row.score,
    max_score: row.maxScore,
    rating_before: row.ratingBefore,
    rating_after: row.ratingAfter,
    xp_earned: row.xpEarned,
    opponent_id: row.opponentId,
    rounds: row.rounds,
  }));
  await tx.query(
    `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, result, score, max_score,
                               rating_before, rating_after, xp_earned, players, opponent_id, rounds)
     SELECT r.id, r.user_id, $1::uuid, $2, $3, $4, $5, $6::timestamptz, r.result, r.score, r.max_score,
            r.rating_before, r.rating_after, r.xp_earned, $7, r.opponent_id, r.rounds
       FROM jsonb_to_recordset($8::jsonb) AS r(id uuid, user_id uuid, result text, score integer, max_score integer,
            rating_before integer, rating_after integer, xp_earned integer, opponent_id uuid, rounds jsonb)`,
    [match.id, match.kind, match.settings.map, match.settings.mode, match.settings.timeLimit, toTs(now), players, JSON.stringify(records)],
  );
}

/** Deletes matches that finished long ago, and unfinished ones that everyone walked away from. */
export async function deleteOldMatches(q: Queryable, now: number): Promise<void> {
  await q.query(
    `DELETE FROM matches m
      WHERE m.finished_at < $1::timestamptz
         OR (m.finished_at IS NULL AND m.created_at < $1::timestamptz
             AND NOT EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.last_seen_at >= $1::timestamptz))`,
    [toTs(now - MATCH_KEPT_MS)],
  );
}
