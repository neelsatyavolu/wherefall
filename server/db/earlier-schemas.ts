// The schema as it stood at each earlier release, statement for statement, so
// tests can build the database a release left behind and upgrade it. Nothing
// outside tests reads these: the live statements are in schema.ts.

// The tables exactly as they were before multiplayer.
export const BEFORE_MULTIPLAYER = [
  `CREATE TABLE users (id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE TABLE rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL)`,
  `CREATE TABLE games (
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
  `CREATE INDEX games_user_played_idx ON games (user_id, played_at DESC)`,
  `CREATE TABLE game_rounds (
    game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    round integer NOT NULL,
    country text NOT NULL,
    distance_km double precision,
    score integer NOT NULL,
    PRIMARY KEY (game_id, round)
  )`,
];

// What the first wave of multiplayer added. With the tables above, this is what the live database has.
export const FIRST_WAVE = [
  `ALTER TABLE users ADD COLUMN rating integer NOT NULL DEFAULT 1000`,
  `ALTER TABLE users ADD COLUMN rated_games integer NOT NULL DEFAULT 0`,
  `ALTER TABLE games ADD COLUMN daily text`,
  `CREATE UNIQUE INDEX games_user_daily_idx ON games (user_id, daily) WHERE daily IS NOT NULL`,
  `CREATE INDEX games_daily_score_idx ON games (daily, score DESC, played_at) WHERE daily IS NOT NULL`,
  `CREATE TABLE matches (
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
  `CREATE TABLE match_players (
    match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    seat integer NOT NULL,
    team integer,
    last_seen_at timestamptz NOT NULL,
    left_at timestamptz,
    open boolean NOT NULL DEFAULT true,
    PRIMARY KEY (match_id, user_id)
  )`,
  `CREATE UNIQUE INDEX match_players_open_idx ON match_players (user_id) WHERE open`,
  `CREATE TABLE match_guesses (
    match_id uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    round integer NOT NULL,
    lng double precision NOT NULL,
    lat double precision NOT NULL,
    distance_km double precision NOT NULL,
    score integer NOT NULL,
    PRIMARY KEY (match_id, round, user_id)
  )`,
  `CREATE TABLE match_queue (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    kind text NOT NULL,
    joined_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL
  )`,
  `CREATE INDEX match_queue_kind_idx ON match_queue (kind, joined_at)`,
];

// What the second wave added: the database as it stands before this one.
export const SECOND_WAVE = [
  `ALTER TABLE users ADD COLUMN xp integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN best_streak integer NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN renamed_at timestamptz`,
  `CREATE INDEX users_rating_board_idx ON users (rating DESC, created_at, id) WHERE rated_games > 0`,
  `CREATE INDEX users_xp_board_idx ON users (xp DESC, created_at, id) WHERE xp > 0`,
  `CREATE INDEX users_streak_board_idx ON users (best_streak DESC, created_at, id) WHERE best_streak > 0`,
  `ALTER TABLE games ADD COLUMN xp_earned integer NOT NULL DEFAULT 0`,
  `ALTER TABLE game_rounds ADD COLUMN lng double precision`,
  `ALTER TABLE game_rounds ADD COLUMN lat double precision`,
  `ALTER TABLE game_rounds ADD COLUMN guess_lng double precision`,
  `ALTER TABLE game_rounds ADD COLUMN guess_lat double precision`,
  `ALTER TABLE game_rounds ADD COLUMN hinted boolean NOT NULL DEFAULT false`,
  `CREATE TABLE streak_runs (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    seed text NOT NULL,
    streak integer NOT NULL,
    xp_earned integer NOT NULL,
    played_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, seed)
  )`,
  `ALTER TABLE matches ADD COLUMN chat jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE TABLE friendships (
    requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    accepted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
  )`,
  `CREATE UNIQUE INDEX friendships_pair_idx ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`,
  `CREATE INDEX friendships_addressee_idx ON friendships (addressee_id)`,
  `CREATE TABLE party_invites (
    from_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    to_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code text NOT NULL,
    sent_at timestamptz NOT NULL,
    PRIMARY KEY (from_id, to_id)
  )`,
  `CREATE INDEX party_invites_to_idx ON party_invites (to_id, sent_at)`,
];

// What the third wave added: the database as it stands before the fourth.
export const THIRD_WAVE = [
  // Third wave: community maps, progress history, public unranked games.

  // A map a player made: a named list of places, each [id, lng, lat, country] as in the dataset files.
  `CREATE TABLE community_maps (
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
  `CREATE INDEX community_maps_popular_idx ON community_maps (plays DESC, created_at DESC, slug)`,
  `CREATE INDEX community_maps_newest_idx ON community_maps (created_at DESC, slug)`,
  `CREATE INDEX community_maps_owner_idx ON community_maps (owner_id, created_at DESC, slug)`,
  // The primary key keeps a like to one per account per map.
  `CREATE TABLE map_likes (
    slug text NOT NULL REFERENCES community_maps (slug) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (slug, user_id)
  )`,
  // Kept for whoever looks into a map by hand. Nothing ever sends these back.
  `CREATE TABLE map_reports (
    slug text NOT NULL REFERENCES community_maps (slug) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (slug, reporter_id)
  )`,

  // Where an account stood at the end of each UTC day (YYYY-MM-DD) on which its XP or rating changed.
  `CREATE TABLE progress_days (
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day text NOT NULL,
    xp integer NOT NULL,
    rating integer NOT NULL,
    PRIMARY KEY (user_id, day)
  )`,

  // One row per queue that gathers players over a countdown. Holding it is what makes that queue's changes take turns.
  `CREATE TABLE queue_gathering (
    kind text PRIMARY KEY,
    starts_at timestamptz
  )`,
];

// What the fourth wave added: the database as it stands before the fifth.
export const FOURTH_WAVE = [
  // Fourth wave: joining a game under way, moderation, the Google viewer budget.

  // The first round a player may guess in: 0 for everyone there at the start, later for one who joined a public game under way.
  `ALTER TABLE match_players ADD COLUMN joined_round integer NOT NULL DEFAULT 0`,
  // A banned account can still sign in and play alone; everything online refuses it.
  `ALTER TABLE users ADD COLUMN banned boolean NOT NULL DEFAULT false`,
  // Like map_reports: kept for the moderators, and who reported is never sent back to anyone.
  `CREATE TABLE player_reports (
    target_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (target_id, reporter_id),
    CHECK (target_id <> reporter_id)
  )`,
  // How many Google viewers were asked for on each UTC day (YYYY-MM-DD).
  `CREATE TABLE viewer_days (
    day text PRIMARY KEY,
    used integer NOT NULL
  )`,
];

/** What the fifth wave added, as it stood when the sixth was written. */
export const FIFTH_WAVE = [
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
];
