import { randomUUID } from 'node:crypto';
import { MAX_ROUND_SCORE, communitySlugOf, type SavedGame } from '../account/input.js';
import { xpForScores, xpForStreak } from '../account/progress.js';
import { DAILY_MIN_MS } from '../daily/daily.js';
import type { Db, Queryable, Row } from './client.js';
import { dailyBegunAt } from './daily.js';
import { addSoloXp } from './progress.js';
import { fromTs, toTs } from './time.js';

/** A second save of the same game inside this window is taken to be a repeat of the first. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface GameSummary {
  id: string;
  /** ISO 8601. */
  playedAt: string;
  map: SavedGame['map'];
  mode: SavedGame['mode'];
  rounds: number;
  score: number;
  maxScore: number;
}

export interface Stats {
  gamesPlayed: number;
  roundsPlayed: number;
  averageRoundScore: number;
  bestRoundScore: number;
  /** Rounds that scored the maximum. */
  perfectRounds: number;
  /** The game with the highest share of its maximum, or null before the first game. */
  bestGame: { score: number; maxScore: number } | null;
}

/** What was played: alone, the day's challenge, or one of the kinds of online match. */
export type GameKind = 'solo' | 'daily' | 'party' | 'unranked' | 'ranked' | 'team';
export type MatchResult = 'win' | 'loss' | 'draw';

/** What the history tells of a game beyond its summary. */
interface Outcome {
  kind: GameKind;
  /** How a match ended for the player. Null for a game played alone, and for a match that was cancelled. */
  result: MatchResult | null;
  /** What a ranked duel did to the player's rating. Null for everything else. */
  ratingChange: number | null;
  /** Everyone who played, the player included: 1 for a game played alone. */
  players: number;
}

/** One line of the history list, which holds games played alone and online matches alike. */
export interface HistoryEntry extends GameSummary, Outcome {
  xpEarned: number;
}

/** One game with everything its history view shows. */
export interface GameDetail extends Omit<GameSummary, 'rounds'>, Outcome {
  timeLimit: number;
  /** The UTC day it was the daily challenge of, or null. */
  daily: string | null;
  rounds: Array<{
    country: string;
    distanceKm: number | null;
    score: number;
    hinted: boolean;
    /** The place and the guess. Null for a game saved before these were kept, and the guess also when there was none. */
    lng: number | null;
    lat: number | null;
    guessLng: number | null;
    guessLat: number | null;
  }>;
}

const SUMMARY_COLUMNS = 'id, played_at, map, mode, rounds, score, max_score';

interface TotalsRow {
  games_played: number;
  rounds_played: number;
  average_round_score: number;
  best_round_score: number;
  perfect_rounds: number;
}

const NO_ROUNDS: TotalsRow = { games_played: 0, rounds_played: 0, average_round_score: 0, best_round_score: 0, perfect_rounds: 0 };

function rowToSummary(row: Row): GameSummary {
  return {
    id: row.id as string,
    playedAt: new Date(fromTs(row.played_at)).toISOString(),
    map: row.map as GameSummary['map'],
    mode: row.mode as GameSummary['mode'],
    rounds: row.rounds as number,
    score: row.score as number,
    maxScore: row.max_score as number,
  };
}

export interface SavedResult {
  game: GameSummary;
  /** XP the game was paid when it was first saved: what it earned, or as much of that as the day's cap left room for. */
  xpEarned: number;
  /** True when the day's cap on XP from solo play kept the game from being paid all it earned. */
  xpCapped: boolean;
  created: boolean;
}

/** A round as it is stored: the server has put it on a place it knows and scored it before it gets here. */
export interface StoredRound {
  country: string;
  /** Null when there was no guess. */
  distanceKm: number | null;
  score: number;
  lng?: number | null;
  lat?: number | null;
  guessLng?: number | null;
  guessLat?: number | null;
  hinted?: boolean;
}

/** A game as it is stored. */
export interface StoredGame extends Pick<SavedGame, 'map' | 'mode' | 'timeLimit' | 'seed' | 'daily'> {
  rounds: StoredRound[];
}

/** What a game's rounds earn. A map a player made earns none: its maker knows every place on it. */
const xpFor = (map: string, scores: readonly number[]): number => (communitySlugOf(map) === null ? xpForScores(scores) : 0);

/**
 * Writes a game with its rounds and credits its XP, as far as the day's cap
 * on solo XP allows. For a caller that holds the player's row and has made
 * sure the game is not a repeat.
 */
export async function insertGame(tx: Queryable, userId: string, game: StoredGame, now: number): Promise<SavedResult> {
  const rounds = game.rounds.map((round, index) => ({
    round: index + 1,
    country: round.country,
    distance_km: round.distanceKm,
    score: round.score,
    lng: round.lng ?? null,
    lat: round.lat ?? null,
    guess_lng: round.guessLng ?? null,
    guess_lat: round.guessLat ?? null,
    hinted: round.hinted ?? false,
  }));
  const score = rounds.reduce((sum, round) => sum + round.score, 0);
  const maxScore = rounds.length * MAX_ROUND_SCORE;
  // The scores are the server's own by now (a hinted round's already halved), and XP follows them.
  const earned = xpFor(
    game.map,
    rounds.map((round) => round.score),
  );
  // The game's row says what it was paid, so the XP goes first.
  const xpEarned = earned > 0 ? await addSoloXp(tx, userId, earned, now) : 0;

  const id = randomUUID();
  await tx.query(
    `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at, daily, xp_earned)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12)`,
    [id, userId, game.map, game.mode, game.timeLimit, game.seed, rounds.length, score, maxScore, toTs(now), game.daily ?? null, xpEarned],
  );
  await tx.query(
    `INSERT INTO game_rounds (game_id, round, country, distance_km, score, lng, lat, guess_lng, guess_lat, hinted)
     SELECT $1::uuid, r.round, r.country, r.distance_km, r.score, r.lng, r.lat, r.guess_lng, r.guess_lat, r.hinted
       FROM jsonb_to_recordset($2::jsonb) AS r(round integer, country text, distance_km double precision, score integer,
            lng double precision, lat double precision, guess_lng double precision, guess_lat double precision, hinted boolean)`,
    [id, JSON.stringify(rounds)],
  );
  return {
    game: { id, playedAt: toTs(now), map: game.map, mode: game.mode, rounds: rounds.length, score, maxScore },
    xpEarned,
    xpCapped: xpEarned < earned,
    created: true,
  };
}

/** A game saved earlier, answered again as it was the first time. */
async function savedBefore(tx: Queryable, existing: Row): Promise<SavedResult> {
  const game = rowToSummary(existing);
  const rounds = await tx.query<{ score: number }>('SELECT score FROM game_rounds WHERE game_id = $1', [game.id]);
  const xpEarned = existing.xp_earned as number;
  const earned = xpFor(
    game.map,
    rounds.map((round) => round.score),
  );
  return { game, xpEarned, xpCapped: xpEarned < earned, created: false };
}

/** Why a daily challenge's result is not taken. */
export type DailyRefusal = 'unstarted' | 'too-soon';

/** Null when the account began the day's challenge long enough ago to have played it. */
async function dailyRefusal(tx: Queryable, userId: string, day: string, now: number): Promise<DailyRefusal | null> {
  const begunAt = await dailyBegunAt(tx, userId, day);
  if (begunAt === null) {
    return 'unstarted';
  }
  return now - begunAt < DAILY_MIN_MS ? 'too-soon' : null;
}

/**
 * Stores a finished game with its rounds and credits its XP. A repeat of a
 * game saved moments ago returns the first copy instead (`created` is false),
 * so a double submit is counted, and paid, once. A daily challenge the
 * account has no result for yet is taken only when the account began it, and
 * not sooner than it could have been played. Null when the account does not
 * exist.
 */
export async function saveGame(db: Db, userId: string, game: StoredGame, now: number): Promise<SavedResult | DailyRefusal | null> {
  return db.transaction(async (tx) => {
    // Holding the player's row makes their saves take turns, so the second of
    // two simultaneous copies sees the first one's game.
    const owner = await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (owner.length === 0) {
      return null;
    }
    // A daily challenge counts once per account per day, however long after the first a second arrives.
    const [existing] = game.daily
      ? await tx.query(`SELECT ${SUMMARY_COLUMNS}, xp_earned FROM games WHERE user_id = $1 AND daily = $2`, [userId, game.daily])
      : await tx.query(
          `SELECT ${SUMMARY_COLUMNS}, xp_earned FROM games
            WHERE user_id = $1 AND seed = $2 AND map = $3 AND mode = $4 AND time_limit = $5 AND played_at > $6::timestamptz
            ORDER BY played_at DESC LIMIT 1`,
          [userId, game.seed, game.map, game.mode, game.timeLimit, toTs(now - DUPLICATE_WINDOW_MS)],
        );
    if (existing) {
      return savedBefore(tx, existing);
    }
    const refusal = game.daily ? await dailyRefusal(tx, userId, game.daily, now) : null;
    return refusal ?? insertGame(tx, userId, game, now);
  });
}

/** A country streak, or a run of Country Guesser or Continent Guesser. */
export type RunKind = 'streak' | 'country' | 'continent';

export interface Run {
  kind: RunKind;
  /** The id the run was given when it was started: what tells one run from another. */
  id: string;
  /** Countries got right in a row, or answers got right out of ten, as the server counted them. */
  count: number;
  /** False for a streak counted behind ordinary games, which earns nothing: those games paid their own XP. */
  paid: boolean;
}

export interface RunResult {
  /** The account's best of the run's kind: a streak in countries, a guesser in points. */
  best: number;
  /** What the run came to when it was first saved. */
  count: number;
  /** XP paid for it now: nothing for a run already counted. */
  xpEarned: number;
  /** True when the day's cap on XP from solo play kept the run from being paid all it earned. */
  xpCapped: boolean;
}

// Where an account's best run of each kind is kept. These go into the SQL, so they are fixed names and never input.
const BEST_COLUMN: Record<RunKind, string> = { streak: 'best_streak', country: 'best_country', continent: 'best_continent' };

/** XP for each right answer in Country Guesser and Continent Guesser. */
const GUESSER_XP = 20;
/** Points for each right answer there. An account's best at either is kept in points. */
const GUESSER_POINTS = 1000;

/** What a run is worth: the figure an account's best is kept as (the streak itself, or points), and the XP it earns. */
function worthOf(run: Run): { value: number; xp: number } {
  const worth = run.kind === 'streak' ? { value: run.count, xp: xpForStreak(run.count) } : { value: run.count * GUESSER_POINTS, xp: run.count * GUESSER_XP };
  return run.paid ? worth : { ...worth, xp: 0 };
}

/**
 * Records a run: its XP, as far as the day's cap on solo XP allows, and its
 * worth if that is the player's best of its kind. A run counts once: finished
 * again (told apart by the id its start gave it, which the table keeps as
 * its seed) it answers with what it came to the first time and earns nothing.
 * Null when the account does not exist.
 */
export async function saveRun(db: Db, userId: string, run: Run, now: number): Promise<RunResult | null> {
  const column = BEST_COLUMN[run.kind];
  const worth = worthOf(run);
  return db.transaction(async (tx) => {
    // Holding the player's row makes two copies of a run take turns, so the second sees the first.
    const [owner] = await tx.query<{ best: number }>(`SELECT ${column} AS best FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    if (!owner) {
      return null;
    }
    const [repeat] = await tx.query<{ streak: number }>('SELECT streak FROM streak_runs WHERE user_id = $1 AND seed = $2', [userId, run.id]);
    if (repeat) {
      return { best: owner.best, count: repeat.streak, xpEarned: 0, xpCapped: false };
    }
    const best = Math.max(owner.best, worth.value);
    const xpEarned = worth.xp > 0 ? await addSoloXp(tx, userId, worth.xp, now) : 0;
    await tx.query('INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at, kind) VALUES ($1, $2, $3, $4, $5::timestamptz, $6)', [
      userId,
      run.id,
      run.count,
      xpEarned,
      toTs(now),
      run.kind,
    ]);
    await tx.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [userId, best]);
    return { best, count: run.count, xpEarned, xpCapped: xpEarned < worth.xp };
  });
}

/** The round of a match as the match keeps it for each player: the place, and that player's own guess. */
interface MatchRound {
  country: string;
  distanceKm: number | null;
  score: number;
  lng: number;
  lat: number;
  guessLng: number | null;
  guessLat: number | null;
}

const HISTORY_COLUMNS = 'id, kind, played_at, map, mode, rounds, score, max_score, result, rating_change, xp_earned, players';
// Both tables in the shape of one history line. Only a ranked duel has a rating change to tell.
const SOLO_AS_HISTORY = `id, CASE WHEN daily IS NULL THEN 'solo' ELSE 'daily' END AS kind, played_at, map, mode, rounds, score, max_score,
       NULL::text AS result, NULL::integer AS rating_change, xp_earned, 1 AS players`;
const MATCH_AS_HISTORY = `id, kind, played_at, map, mode, jsonb_array_length(rounds) AS rounds, score, max_score,
       result, CASE WHEN kind = 'ranked' THEN rating_after - rating_before END AS rating_change, xp_earned, players`;

function rowToOutcome(row: Row): Outcome {
  return {
    kind: row.kind as GameKind,
    result: row.result as MatchResult | null,
    ratingChange: row.rating_change as number | null,
    players: row.players as number,
  };
}

/**
 * One page of everything the player has played, alone and online, newest
 * first, in one query. Asks for one more than `limit` when there is one, so
 * the caller can tell whether another page follows.
 */
export async function gameHistoryFor(q: Queryable, userId: string, limit: number, offset: number): Promise<HistoryEntry[]> {
  // Each table gives up only as many rows as the page could need, by its own index, before the two are merged.
  const rows = await q.query(
    `SELECT ${HISTORY_COLUMNS} FROM (
       (SELECT ${SOLO_AS_HISTORY} FROM games WHERE user_id = $1 ORDER BY played_at DESC, id DESC LIMIT $4)
       UNION ALL
       (SELECT ${MATCH_AS_HISTORY} FROM online_games WHERE user_id = $1 ORDER BY played_at DESC, id DESC LIMIT $4)
     ) played ORDER BY played_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [userId, limit + 1, offset, offset + limit + 1],
  );
  return rows.map((row) => ({ ...rowToSummary(row), ...rowToOutcome(row), xpEarned: row.xp_earned as number }));
}

/** One of the player's own online matches, with their own guess in each round. */
async function matchFor(q: Queryable, userId: string, gameId: string): Promise<GameDetail | null> {
  const [match] = await q.query(`SELECT ${MATCH_AS_HISTORY}, time_limit, rounds AS played FROM online_games WHERE id = $1 AND user_id = $2`, [gameId, userId]);
  if (!match) {
    return null;
  }
  return {
    ...rowToSummary(match),
    ...rowToOutcome(match),
    timeLimit: match.time_limit as number,
    daily: null,
    rounds: (match.played as MatchRound[]).map((round) => ({
      country: round.country,
      distanceKm: round.distanceKm ?? null,
      score: round.score,
      // Nothing online is played with a hint.
      hinted: false,
      lng: round.lng ?? null,
      lat: round.lat ?? null,
      guessLng: round.guessLng ?? null,
      guessLat: round.guessLat ?? null,
    })),
  };
}

/**
 * One of the player's own games with its rounds, whether played alone or
 * online. Null when there is no such game or it is someone else's.
 */
export async function gameFor(q: Queryable, userId: string, gameId: string): Promise<GameDetail | null> {
  const [game] = await q.query(`SELECT ${SUMMARY_COLUMNS}, time_limit, daily FROM games WHERE id = $1 AND user_id = $2`, [gameId, userId]);
  if (!game) {
    return matchFor(q, userId, gameId);
  }
  const rounds = await q.query('SELECT country, distance_km, score, hinted, lng, lat, guess_lng, guess_lat FROM game_rounds WHERE game_id = $1 ORDER BY round', [
    gameId,
  ]);
  const daily = game.daily as string | null;
  return {
    ...rowToSummary(game),
    kind: daily === null ? 'solo' : 'daily',
    result: null,
    ratingChange: null,
    players: 1,
    timeLimit: game.time_limit as number,
    daily,
    rounds: rounds.map((round) => ({
      country: round.country as string,
      distanceKm: round.distance_km as number | null,
      score: round.score as number,
      hinted: round.hinted as boolean,
      lng: round.lng as number | null,
      lat: round.lat as number | null,
      guessLng: round.guess_lng as number | null,
      guessLat: round.guess_lat as number | null,
    })),
  };
}

/**
 * Which games count towards a player's stats: every game but those on a map
 * a player made, where the maker (or anyone who has played it) knows the
 * places. Those games are still saved and shown; they are just not counted.
 */
export const COUNTED_GAMES = `map NOT LIKE 'community:%'`;

/** A player's totals, worked out by the database. */
export async function statsFor(q: Queryable, userId: string): Promise<Stats> {
  const [[totals = NO_ROUNDS], [best]] = await Promise.all([
    q.query<TotalsRow>(
      `SELECT count(DISTINCT g.id)::int AS games_played,
              count(r.round)::int AS rounds_played,
              coalesce(round(avg(r.score)), 0)::int AS average_round_score,
              coalesce(max(r.score), 0)::int AS best_round_score,
              (count(r.round) FILTER (WHERE r.score = $2))::int AS perfect_rounds
         FROM games g JOIN game_rounds r ON r.game_id = g.id
        WHERE g.user_id = $1 AND g.${COUNTED_GAMES}`,
      [userId, MAX_ROUND_SCORE],
    ),
    q.query<{ score: number; max_score: number }>(
      `SELECT score, max_score FROM games WHERE user_id = $1 AND ${COUNTED_GAMES}
        ORDER BY score::double precision / max_score DESC, max_score DESC, played_at ASC LIMIT 1`,
      [userId],
    ),
  ]);
  return {
    gamesPlayed: totals.games_played,
    roundsPlayed: totals.rounds_played,
    averageRoundScore: totals.average_round_score,
    bestRoundScore: totals.best_round_score,
    perfectRounds: totals.perfect_rounds,
    bestGame: best ? { score: best.score, maxScore: best.max_score } : null,
  };
}

/** The player's latest games, newest first. */
export async function recentGamesFor(q: Queryable, userId: string, limit: number): Promise<GameSummary[]> {
  const rows = await q.query(`SELECT ${SUMMARY_COLUMNS} FROM games WHERE user_id = $1 ORDER BY played_at DESC, id DESC LIMIT $2`, [
    userId,
    limit,
  ]);
  return rows.map(rowToSummary);
}
