import { createHash } from 'node:crypto';
import type { Db, Queryable } from './client.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    count integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    map text NOT NULL,
    mode text NOT NULL,
    time_limit integer NOT NULL,
    seed text NOT NULL,
    rounds integer NOT NULL,
    score integer NOT NULL,
    max_score integer NOT NULL,
    played_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS games_user_played_idx ON games (user_id, played_at DESC)`,
  `CREATE TABLE IF NOT EXISTS game_rounds (
    game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    round integer NOT NULL,
    country text NOT NULL,
    distance_km double precision,
    score integer NOT NULL,
    PRIMARY KEY (game_id, round)
  )`,
  // Later additions go here as idempotent ALTERs, so existing databases catch up.

  // Elo for ranked duels. Every account starts at 1000.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS rating integer NOT NULL DEFAULT 1000`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS rated_games integer NOT NULL DEFAULT 0`,

  // The UTC day (YYYY-MM-DD) a game was that day's daily challenge; null for every other game.
  `ALTER TABLE games ADD COLUMN IF NOT EXISTS daily text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS games_user_daily_idx ON games (user_id, daily) WHERE daily IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS games_daily_score_idx ON games (daily, score DESC, played_at) WHERE daily IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS matches (
    id uuid PRIMARY KEY,
    code text UNIQUE,
    kind text NOT NULL,
    phase text NOT NULL,
    map text NOT NULL,
    mode text NOT NULL,
    time_limit integer NOT NULL,
    rounds integer NOT NULL,
    seed text NOT NULL,
    resolver_id uuid NOT NULL,
    round integer NOT NULL DEFAULT 0,
    prepare_ends_at timestamptz,
    round_starts_at timestamptz,
    round_ends_at timestamptz,
    reveal_ends_at timestamptz,
    places jsonb,
    scale_km double precision,
    outcome jsonb,
    created_at timestamptz NOT NULL,
    finished_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS match_players (
    match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    seat integer NOT NULL,
    team integer,
    last_seen_at timestamptz NOT NULL,
    left_at timestamptz,
    open boolean NOT NULL DEFAULT true,
    PRIMARY KEY (match_id, user_id)
  )`,
  // A player is in at most one match that is still going.
  `CREATE UNIQUE INDEX IF NOT EXISTS match_players_open_idx ON match_players (user_id) WHERE open`,
  `CREATE TABLE IF NOT EXISTS match_guesses (
    match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    round integer NOT NULL,
    lng double precision NOT NULL,
    lat double precision NOT NULL,
    distance_km double precision NOT NULL,
    score integer NOT NULL,
    PRIMARY KEY (match_id, round, user_id)
  )`,
  // The primary key keeps a player to one queue.
  `CREATE TABLE IF NOT EXISTS match_queue (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL,
    joined_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS match_queue_kind_idx ON match_queue (kind, joined_at)`,

  // Second wave: progress, history, chat, friends.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS xp integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS best_streak integer NOT NULL DEFAULT 0`,
  // When the username was last changed; null for one that never was.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS renamed_at timestamptz`,
  // One index per leaderboard, in the order it is read, holding only the players who are on it.
  `CREATE INDEX IF NOT EXISTS users_rating_board_idx ON users (rating DESC, created_at, id) WHERE rated_games > 0`,
  `CREATE INDEX IF NOT EXISTS users_xp_board_idx ON users (xp DESC, created_at, id) WHERE xp > 0`,
  `CREATE INDEX IF NOT EXISTS users_streak_board_idx ON users (best_streak DESC, created_at, id) WHERE best_streak > 0`,

  `ALTER TABLE games ADD COLUMN IF NOT EXISTS xp_earned integer NOT NULL DEFAULT 0`,
  // Where each round's place and guess were, for the history view. Null for games saved before these existed.
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS lng double precision`,
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS lat double precision`,
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS guess_lng double precision`,
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS guess_lat double precision`,
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS hinted boolean NOT NULL DEFAULT false`,

  // One row per country-streak run, so a run posted twice is counted once.
  `CREATE TABLE IF NOT EXISTS streak_runs (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    seed text NOT NULL,
    streak integer NOT NULL,
    xp_earned integer NOT NULL,
    played_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, seed)
  )`,

  // The last few chat lines of a match, kept in its own row: a poll reads them with the match and they go when it goes.
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS chat jsonb NOT NULL DEFAULT '[]'::jsonb`,

  // A friend request, and once accepted a friendship. One row per pair of players, whoever asked.
  `CREATE TABLE IF NOT EXISTS friendships (
    requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    accepted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_idx
     ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`,
  `CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id)`,

  // The latest invitation from one player to another to join a party lobby.
  `CREATE TABLE IF NOT EXISTS party_invites (
    from_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    to_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code text NOT NULL,
    sent_at timestamptz NOT NULL,
    PRIMARY KEY (from_id, to_id)
  )`,
  `CREATE INDEX IF NOT EXISTS party_invites_to_idx ON party_invites (to_id, sent_at)`,

  // Third wave: community maps, progress history, public unranked games.

  // A map a player made: a named list of places, each [id, lng, lat, country] as in the dataset files.
  `CREATE TABLE IF NOT EXISTS community_maps (
    slug text PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL,
    locations jsonb NOT NULL,
    places integer NOT NULL,
    plays integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  // One index per list, in the order the list is read.
  `CREATE INDEX IF NOT EXISTS community_maps_popular_idx ON community_maps (plays DESC, created_at DESC, slug)`,
  `CREATE INDEX IF NOT EXISTS community_maps_newest_idx ON community_maps (created_at DESC, slug)`,
  `CREATE INDEX IF NOT EXISTS community_maps_owner_idx ON community_maps (owner_id, created_at DESC, slug)`,
  // The primary key keeps a like to one per account per map.
  `CREATE TABLE IF NOT EXISTS map_likes (
    slug text NOT NULL REFERENCES community_maps (slug) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (slug, user_id)
  )`,
  // Kept for whoever looks into a map by hand. Nothing ever sends these back.
  `CREATE TABLE IF NOT EXISTS map_reports (
    slug text NOT NULL REFERENCES community_maps (slug) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (slug, reporter_id)
  )`,

  // Where an account stood at the end of each UTC day (YYYY-MM-DD) on which its XP or rating changed.
  `CREATE TABLE IF NOT EXISTS progress_days (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day text NOT NULL,
    xp integer NOT NULL,
    rating integer NOT NULL,
    PRIMARY KEY (user_id, day)
  )`,

  // One row per queue that gathers players over a countdown. Holding it is what makes that queue's changes take turns.
  `CREATE TABLE IF NOT EXISTS queue_gathering (
    kind text PRIMARY KEY,
    starts_at timestamptz
  )`,

  // Fourth wave: joining a game under way, moderation, the Google viewer budget.

  // The first round a player may guess in: 0 for everyone there at the start, later for one who joined a public game under way.
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS joined_round integer NOT NULL DEFAULT 0`,
  // A banned account can still sign in and play alone; everything online refuses it.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false`,
  // Like map_reports: kept for the moderators, and who reported is never sent back to anyone.
  `CREATE TABLE IF NOT EXISTS player_reports (
    target_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (target_id, reporter_id),
    CHECK (target_id <> reporter_id)
  )`,
  // How many Google viewers were asked for on each UTC day (YYYY-MM-DD).
  `CREATE TABLE IF NOT EXISTS viewer_days (
    day text PRIMARY KEY,
    used integer NOT NULL
  )`,

  // Fifth wave: rules aligned with WorldGuessr, guests, party options, history, presence.

  // New accounts start at 500. An account that has never played a rated game is moved there too; rated accounts keep theirs.
  `ALTER TABLE users ALTER COLUMN rating SET DEFAULT 500`,
  `UPDATE users SET rating = 500 WHERE rated_games = 0 AND rating = 1000`,
  // A guest is a row here like any player, told apart by this flag and by a name no account can have.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS guest boolean NOT NULL DEFAULT false`,
  // When the player's browser last said it was there. Null until it first does.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS users_seen_idx ON users (last_seen_at)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS country text`,
  // Set when the player deletes the account; the row goes 30 days later unless they restore it.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak integer NOT NULL DEFAULT 0`,
  // The last UTC day (YYYY-MM-DD) the login streak counted.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS login_day text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS duel_wins integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS duel_losses integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS duel_ties integer NOT NULL DEFAULT 0`,
  // Best scores in Country Guesser and Continent Guesser, in points.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS best_country integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS best_continent integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_requests boolean NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_chat boolean NOT NULL DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_views integer NOT NULL DEFAULT 0`,
  // Leaving a ranked duel before its first guess: when the player last did, and until when a second one locks them out.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_dodge_at timestamptz`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ranked_locked_until timestamptz`,
  // Who the player's last ranked duel was against, and when it was made, so the queue can avoid an instant rematch.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ranked_opponent uuid`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ranked_at timestamptz`,

  // Party options.
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS communication text NOT NULL DEFAULT 'chat'`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS teams text NOT NULL DEFAULT 'none'`,
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false`,
  // Set on a two-player lobby whose players went into a queue together.
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS moved_to_queue text`,
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS kicked boolean NOT NULL DEFAULT false`,
  // The ids of the players this one has muted in the match.
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS muted jsonb NOT NULL DEFAULT '[]'::jsonb`,
  // Where the player's pin is in the round being played, for teammates to see.
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS pin_round integer`,
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS pin_lng double precision`,
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS pin_lat double precision`,
  // Two players queueing for 2v2 as a pair carry the same group.
  `ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS group_id uuid`,

  // Country Guesser and Continent Guesser runs are counted once per seed, like streak runs.
  `ALTER TABLE streak_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'streak'`,

  // One row for each account in each finished online match: the history list, and what tells rematches apart.
  `CREATE TABLE IF NOT EXISTS online_games (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    match_id uuid NOT NULL,
    kind text NOT NULL,
    map text NOT NULL,
    mode text NOT NULL,
    time_limit integer NOT NULL,
    played_at timestamptz NOT NULL,
    result text,
    score integer NOT NULL,
    max_score integer NOT NULL,
    rating_before integer,
    rating_after integer,
    xp_earned integer NOT NULL DEFAULT 0,
    players integer NOT NULL,
    opponent_id uuid,
    rounds jsonb NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS online_games_user_played_idx ON online_games (user_id, played_at DESC)`,

  // The one attempt at each day's daily challenge an account has begun.
  `CREATE TABLE IF NOT EXISTS daily_attempts (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day text NOT NULL,
    started_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, day)
  )`,

  // Where the account ranked on each board that day. Null for days recorded before ranks were kept.
  `ALTER TABLE progress_days ADD COLUMN IF NOT EXISTS xp_rank integer`,
  `ALTER TABLE progress_days ADD COLUMN IF NOT EXISTS rating_rank integer`,
  // What the account earned on the day, which the day's XP board ranks. Days
  // recorded before the column say 0.
  `ALTER TABLE progress_days ADD COLUMN IF NOT EXISTS xp_gained integer NOT NULL DEFAULT 0`,
  // The recorded days of an account that never played a rated game follow it
  // from the old starting rating to the new one, so its chart shows no fall.
  `UPDATE progress_days p SET rating = 500 FROM users u WHERE u.id = p.user_id AND u.rated_games = 0 AND p.rating = 1000`,

  // Maps: a long description beside the short one, and a count of likes to sort the popular list by.
  `ALTER TABLE community_maps ADD COLUMN IF NOT EXISTS details text NOT NULL DEFAULT ''`,
  `ALTER TABLE community_maps ADD COLUMN IF NOT EXISTS likes integer NOT NULL DEFAULT 0`,
  `UPDATE community_maps m SET likes = (SELECT count(*) FROM map_likes l WHERE l.slug = m.slug)
    WHERE m.likes <> (SELECT count(*) FROM map_likes l WHERE l.slug = m.slug)`,
  `CREATE INDEX IF NOT EXISTS community_maps_liked_idx ON community_maps (likes DESC, plays DESC, created_at DESC, slug)`,

  // Sixth wave: hardening after the security review, recovery codes, 2v2 records, report categories.

  // Raised to end every session of the account: a token carries the version it was made at.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0`,
  // The recovery code, hashed like a password. Null until the account is given one.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_hash text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS team_wins integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS team_losses integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS team_ties integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_last_seen boolean NOT NULL DEFAULT false`,
  // XP earned from solo play on one UTC day (YYYY-MM-DD), which is capped. Kept on the row so the cap is one atomic update.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS solo_xp integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS solo_xp_day text`,

  // Whether a party takes players with no account.
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS guests boolean NOT NULL DEFAULT true`,
  // Co-op: the player whose guess is everyone's. Null leaves it to the host.
  `ALTER TABLE matches ADD COLUMN IF NOT EXISTS picker_id uuid`,
  // How many writes the player has sent the match since `acts_from`: the per-seat rate limit, kept with the heartbeat.
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS acts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS acts_from timestamptz`,

  `ALTER TABLE player_reports ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'`,
  // open, actioned or dismissed: what the reporter is shown.
  `ALTER TABLE player_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`,
  `CREATE INDEX IF NOT EXISTS player_reports_reporter_idx ON player_reports (reporter_id, created_at DESC)`,

  // How long each player waited in a queue before their match was found: the "typical wait" shown to the next one.
  `CREATE TABLE IF NOT EXISTS queue_waits (
    kind text NOT NULL,
    found_at timestamptz NOT NULL,
    waited_ms integer NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS queue_waits_kind_idx ON queue_waits (kind, found_at)`,

  // Old windows are cleared out by when they began.
  `CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start)`,

  // Email on accounts, and password resets sent to it.

  // Trimmed and in lower case. Null for a guest, and for an account made before emails until it adds one.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email) WHERE email IS NOT NULL`,
  // One row for each reset link that can still be used. The link carries the token; only its SHA-256 is kept.
  `CREATE TABLE IF NOT EXISTS password_resets (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id)`,
];

/**
 * A fingerprint of the statements above. It is stored in the database once
 * they have all run, so an instance can tell at a glance that there is
 * nothing to do, and it changes by itself whenever a statement is added.
 */
export const SCHEMA_VERSION = createHash('sha256').update(STATEMENTS.join('\n')).digest('hex').slice(0, 16);

/** The one lock every instance takes to set the schema up. Any fixed number would do; this one spells "plon". */
export const SETUP_LOCK = 0x706c6f6e;

/** True when the database records that this very set of statements has been run on it. */
async function isCurrent(db: Queryable): Promise<boolean> {
  // The record is itself a table that a new database does not have yet.
  const [found] = await db.query<{ present: boolean }>(`SELECT to_regclass('schema_version') IS NOT NULL AS present`);
  if (!found?.present) {
    return false;
  }
  const [recorded] = await db.query<{ version: string }>('SELECT version FROM schema_version');
  return recorded?.version === SCHEMA_VERSION;
}

/** Runs every statement, then records that it did. Only ever one instance at a time: see `migrate`. */
async function setUp(db: Queryable): Promise<void> {
  // Whoever held the lock before this instance may have just finished the job.
  if (await isCurrent(db)) {
    return;
  }
  for (const statement of STATEMENTS) {
    await db.query(statement);
  }
  await db.query('CREATE TABLE IF NOT EXISTS schema_version (only_row boolean PRIMARY KEY DEFAULT true, version text NOT NULL)');
  await db.query(
    `INSERT INTO schema_version (only_row, version) VALUES (true, $1)
     ON CONFLICT (only_row) DO UPDATE SET version = EXCLUDED.version`,
    [SCHEMA_VERSION],
  );
}

/**
 * Creates any missing tables and columns. Safe to run on every start, and
 * safe for any number of instances to run at the same moment.
 *
 * `CREATE TABLE IF NOT EXISTS` is not safe against itself: two sessions
 * running it together both find the table missing, and one fails. So setup
 * is done under a lock that spans the database. The first instance in does
 * the work; the others wait for it, then find the work recorded and do
 * nothing. The statements still run one at a time outside any transaction,
 * as they always have, so none holds a table longer than it takes to run.
 *
 * On a database already set up this is two small reads and no lock.
 */
export async function migrate(db: Db): Promise<void> {
  if (await isCurrent(db)) {
    return;
  }
  await (db.exclusively ? db.exclusively(SETUP_LOCK, () => setUp(db)) : setUp(db));
}
