import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from './client.js';
import { BEFORE_MULTIPLAYER, FIFTH_WAVE, FIRST_WAVE, FOURTH_WAVE, SECOND_WAVE, THIRD_WAVE } from './earlier-schemas.js';
import { SCHEMA_VERSION, SETUP_LOCK, migrate } from './schema.js';

const WHEN = '2026-10-01T12:00:00.000Z';
const USER = randomUUID();
const OTHER = randomUUID();
const GAME = randomUUID();
const MATCH = randomUUID();
const OLD_TABLES = ['users', 'games', 'game_rounds', 'rate_limits'];
const FIRST_WAVE_TABLES = ['matches', 'match_players', 'match_guesses', 'match_queue'];
const SECOND_WAVE_TABLES = ['streak_runs', 'friendships', 'party_invites'];
const THIRD_WAVE_TABLES = ['community_maps', 'map_likes', 'map_reports', 'progress_days', 'queue_gathering'];
const FOURTH_WAVE_TABLES = ['player_reports', 'viewer_days'];
const FIFTH_WAVE_TABLES = ['online_games', 'daily_attempts'];
const SIXTH_WAVE_TABLES = ['queue_waits'];

/**
 * The rows a database held before an upgrade, as they should read after it:
 * unchanged, but for the one change the fifth wave makes to old rows, which
 * is to move an account that has never played a rated game from the old
 * starting rating to the new. `toMatchObject` against these lets a later wave
 * add columns without every earlier test having to list them.
 */
const upgraded = (rows: Record<string, unknown[]>): Record<string, unknown[]> => ({
  ...rows,
  ...(rows.users
    ? {
        users: rows.users.map((user) => {
          const { rating, rated_games: ratedGames } = user as { rating?: number; rated_games?: number };
          return rating === 1000 && ratedGames === 0 ? { ...(user as object), rating: 500 } : user;
        }),
      }
    : {}),
});

let db: Db;

async function run(statements: string[]): Promise<void> {
  for (const statement of statements) {
    await db.query(statement);
  }
}

/** Every row of the given tables, in a fixed order. */
async function contents(tables: string[]): Promise<Record<string, unknown[]>> {
  const rows: Record<string, unknown[]> = {};
  for (const table of tables) {
    // Table names come from the lists above, never from input.
    rows[table] = await db.query(`SELECT * FROM ${table} ORDER BY 1, 2`);
  }
  return rows;
}

async function addMatch(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO matches (id, kind, phase, map, mode, time_limit, rounds, seed, resolver_id, created_at)
     VALUES ($1, 'party', 'lobby', 'world', 'move', 60, 5, 'seed', $2, $3)`,
    [id, USER, WHEN],
  );
  return id;
}

const seat = (matchId: string, open: boolean) =>
  db.query('INSERT INTO match_players (match_id, user_id, seat, last_seen_at, open) VALUES ($1, $2, 0, $3, $4)', [matchId, USER, WHEN, open]);

/** Accounts, a game and a rate limit, in the tables as they were before multiplayer. */
async function beforeMultiplayer(): Promise<void> {
  db = await createPgliteDb();
  await run(BEFORE_MULTIPLAYER);
  for (const [id, username] of [
    [USER, 'neel'],
    [OTHER, 'friend'],
  ]) {
    await db.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)', [id, username, 'hash', WHEN]);
  }
  await db.query(
    `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at)
     VALUES ($1, $2, 'world', 'move', 0, 'abc', 1, 4200, 5000, $3)`,
    [GAME, USER, WHEN],
  );
  await db.query(`INSERT INTO game_rounds (game_id, round, country, distance_km, score) VALUES ($1, 1, 'FR', 12.5, 4200)`, [GAME]);
  await db.query(`INSERT INTO rate_limits (key, window_start, count) VALUES ('games-save:x', $1, 3)`, [WHEN]);
}

/** The same, after the first wave, with ratings earned, a daily played, a ranked duel under way and someone in a queue. */
async function afterFirstWave(): Promise<void> {
  await beforeMultiplayer();
  await run(FIRST_WAVE);
  await db.query('UPDATE users SET rating = 1016, rated_games = 1 WHERE id = $1', [USER]);
  await db.query(`UPDATE games SET daily = '2026-10-01'`);
  await db.query(
    `INSERT INTO matches (id, kind, phase, map, mode, time_limit, rounds, seed, resolver_id, round, round_starts_at, round_ends_at, places, scale_km, created_at)
     VALUES ($1, 'ranked', 'playing', 'world', 'no-move', 60, 5, 'seed', $2, 1, $3, $3, $4::jsonb, 14916.862, $3)`,
    [MATCH, USER, WHEN, JSON.stringify([{ id: 'a', lng: 1, lat: 2, country: 'FR' }])],
  );
  await db.query(`INSERT INTO match_players (match_id, user_id, seat, last_seen_at) VALUES ($1, $2, 0, $4), ($1, $3, 1, $4)`, [MATCH, USER, OTHER, WHEN]);
  await db.query(`INSERT INTO match_guesses (match_id, user_id, round, lng, lat, distance_km, score) VALUES ($1, $2, 0, 1.5, 2.5, 78.4, 4744)`, [MATCH, USER]);
  const waiting = randomUUID();
  await db.query('INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)', [waiting, 'waiting', 'hash', WHEN]);
  await db.query(`INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, 'team', $2, $2)`, [waiting, WHEN]);
}

/** The same again after the second wave, with XP and a streak earned, a game with its places, chat in the duel, a friendship and an invitation. */
async function afterSecondWave(): Promise<void> {
  await afterFirstWave();
  await run(SECOND_WAVE);
  await db.query('UPDATE users SET xp = 4321, best_streak = 7, renamed_at = $1 WHERE id = $2', [WHEN, USER]);
  await db.query('UPDATE games SET xp_earned = 84');
  await db.query('UPDATE game_rounds SET lng = 2.35, lat = 48.85, guess_lng = 2.4, guess_lat = 48.9, hinted = true');
  await db.query(`UPDATE matches SET chat = '[{"id": 1, "userId": "x", "username": "neel", "text": "hello", "emote": null, "at": "2026-10-01T12:00:00.000Z"}]'::jsonb`);
  await db.query(`INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at) VALUES ($1, 'run', 7, 140, $2)`, [USER, WHEN]);
  await db.query('INSERT INTO friendships (requester_id, addressee_id, accepted, created_at) VALUES ($1, $2, true, $3)', [USER, OTHER, WHEN]);
  await db.query(`INSERT INTO party_invites (from_id, to_id, code, sent_at) VALUES ($1, $2, 'ABCDEF', $3)`, [USER, OTHER, WHEN]);
}

describe('migrate, on the database as it is after the second wave', () => {
  beforeEach(afterSecondWave);
  const EARLIER = [...OLD_TABLES, ...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES];

  it('adds what the third wave needs and changes no row of what was there', async () => {
    const before = await contents(EARLIER);
    await migrate(db);
    const after = await contents(EARLIER);
    expect(after).toMatchObject(upgraded(before));
    for (const table of EARLIER) {
      expect(after[table]).not.toEqual([]);
    }
    expect(after.users).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'neel', rating: 1016, xp: 4321, best_streak: 7 })]));
    expect(after.matches).toMatchObject([{ kind: 'ranked', phase: 'playing', chat: [{ id: 1, text: 'hello' }] }]);
    for (const rows of Object.values(await contents([...THIRD_WAVE_TABLES, ...FOURTH_WAVE_TABLES]))) {
      expect(rows).toEqual([]);
    }
  });

  it('changes nothing when run again and again, with the third wave in use', async () => {
    await migrate(db);
    await db.query(
      `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, plays, created_at, updated_at)
       VALUES ('paris-abc123', $1, 'Paris', '', '[["a", 2.35, 48.85, "FR"]]'::jsonb, 1, 12, $2, $2)`,
      [USER, WHEN],
    );
    await db.query(`INSERT INTO map_likes (slug, user_id) VALUES ('paris-abc123', $1)`, [OTHER]);
    await db.query(`INSERT INTO map_reports (slug, reporter_id, reason, created_at) VALUES ('paris-abc123', $1, 'why', $2)`, [OTHER, WHEN]);
    await db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-01', 4321, 1016)`, [USER]);
    await db.query(`INSERT INTO queue_gathering (kind, starts_at) VALUES ('unranked', $1)`, [WHEN]);
    const all = [...EARLIER, ...THIRD_WAVE_TABLES];
    const before = await contents(all);

    await migrate(db);
    await migrate(db);
    expect(await contents(all)).toEqual(before);
  });

  it('holds a map to one like an account, one report an account, and an account to one point a day', async () => {
    await migrate(db);
    await db.query(
      `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, created_at, updated_at)
       VALUES ('paris-abc123', $1, 'Paris', '', '[]'::jsonb, 0, $2, $2)`,
      [USER, WHEN],
    );
    const like = () => db.query(`INSERT INTO map_likes (slug, user_id) VALUES ('paris-abc123', $1)`, [OTHER]);
    const report = () => db.query(`INSERT INTO map_reports (slug, reporter_id, reason, created_at) VALUES ('paris-abc123', $1, '', $2)`, [OTHER, WHEN]);
    const point = () => db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-01', 1, 1000)`, [USER]);
    await like();
    await report();
    await point();
    await expect(like()).rejects.toThrow(/map_likes_pkey/);
    await expect(report()).rejects.toThrow(/map_reports_pkey/);
    await expect(point()).rejects.toThrow(/progress_days_pkey/);
    await expect(db.query(`INSERT INTO map_likes (slug, user_id) VALUES ('no-such-map', $1)`, [OTHER])).rejects.toThrow(/foreign key/);
  });

  it("takes a deleted account's maps with it, and the likes and reports on them, and its history", async () => {
    await migrate(db);
    await db.query(
      `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, created_at, updated_at)
       VALUES ('paris-abc123', $1, 'Paris', '', '[]'::jsonb, 0, $2, $2)`,
      [USER, WHEN],
    );
    await db.query(`INSERT INTO map_likes (slug, user_id) VALUES ('paris-abc123', $1)`, [OTHER]);
    await db.query(`INSERT INTO map_reports (slug, reporter_id, reason, created_at) VALUES ('paris-abc123', $1, '', $2)`, [OTHER, WHEN]);
    await db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-01', 1, 1000)`, [USER]);
    await db.query('DELETE FROM users WHERE id = $1', [USER]);
    for (const rows of Object.values(await contents(['community_maps', 'map_likes', 'map_reports', 'progress_days']))) {
      expect(rows).toEqual([]);
    }
  });
});

/** The same again after the third wave, with a community map liked and reported, a day of progress, and a public game being gathered. */
async function afterThirdWave(): Promise<void> {
  await afterSecondWave();
  await run(THIRD_WAVE);
  await db.query(
    `INSERT INTO community_maps (slug, owner_id, name, description, locations, places, plays, created_at, updated_at)
     VALUES ('paris-abc123', $1, 'Paris', 'All of it.', '[["a", 2.35, 48.85, "FR"]]'::jsonb, 1, 12, $2, $2)`,
    [USER, WHEN],
  );
  await db.query(`INSERT INTO map_likes (slug, user_id) VALUES ('paris-abc123', $1)`, [OTHER]);
  await db.query(`INSERT INTO map_reports (slug, reporter_id, reason, created_at) VALUES ('paris-abc123', $1, 'why', $2)`, [OTHER, WHEN]);
  await db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-01', 4321, 1016)`, [USER]);
  await db.query(`INSERT INTO queue_gathering (kind, starts_at) VALUES ('unranked', $1)`, [WHEN]);
}

describe('migrate, on the live database after the third wave', () => {
  beforeEach(afterThirdWave);
  const EARLIER = [...OLD_TABLES, ...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES, ...THIRD_WAVE_TABLES];

  it('adds what the fourth wave needs: nobody banned, everyone in their match from the start, and no other row changed', async () => {
    const before = await contents(EARLIER);
    await migrate(db);
    const after = await contents(EARLIER);
    expect(after).toMatchObject(upgraded(before));
    for (const table of EARLIER) {
      expect(after[table]).not.toEqual([]);
    }
    expect(after.match_players).toHaveLength(2);
    expect(after.community_maps).toMatchObject([{ slug: 'paris-abc123', plays: 12 }]);
    for (const rows of Object.values(await contents(FOURTH_WAVE_TABLES))) {
      expect(rows).toEqual([]);
    }
  });

  it('changes nothing when run again and again, with the fourth wave in use', async () => {
    await migrate(db);
    await db.query('UPDATE users SET banned = true WHERE id = $1', [OTHER]);
    await db.query('UPDATE match_players SET joined_round = 2 WHERE user_id = $1', [OTHER]);
    await db.query(`INSERT INTO player_reports (target_id, reporter_id, reason, created_at) VALUES ($1, $2, 'rude', $3)`, [OTHER, USER, WHEN]);
    await db.query(`INSERT INTO viewer_days (day, used) VALUES ('2026-10-01', 149)`);
    const all = [...EARLIER, ...FOURTH_WAVE_TABLES];
    const before = await contents(all);

    await migrate(db);
    await migrate(db);
    expect(await contents(all)).toEqual(before);
  });

  it('holds a player to one report of another, nobody to one of themselves, and a day to one count', async () => {
    await migrate(db);
    const report = (target: string, reporter: string) =>
      db.query(`INSERT INTO player_reports (target_id, reporter_id, reason, created_at) VALUES ($1, $2, '', $3)`, [target, reporter, WHEN]);
    await report(OTHER, USER);
    await report(USER, OTHER);
    await expect(report(OTHER, USER)).rejects.toThrow(/player_reports_pkey/);
    await expect(report(USER, USER)).rejects.toThrow(/check/i);
    await db.query(`INSERT INTO viewer_days (day, used) VALUES ('2026-10-01', 1)`);
    await expect(db.query(`INSERT INTO viewer_days (day, used) VALUES ('2026-10-01', 1)`)).rejects.toThrow(/viewer_days_pkey/);
  });

  it('takes the reports by and about a deleted account with it', async () => {
    await migrate(db);
    await db.query(`INSERT INTO player_reports (target_id, reporter_id, reason, created_at) VALUES ($1, $2, '', $3), ($2, $1, '', $3)`, [OTHER, USER, WHEN]);
    await db.query('DELETE FROM users WHERE id = $1', [USER]);
    expect(await db.query('SELECT 1 FROM player_reports')).toEqual([]);
  });
});

/** The same again after the fourth wave: a ban, a late arrival in the match, a report of a player and a day of Google viewers. */
async function afterFourthWave(): Promise<void> {
  await afterThirdWave();
  await run(FOURTH_WAVE);
  await db.query('UPDATE users SET banned = true WHERE id = $1', [OTHER]);
  await db.query('UPDATE match_players SET joined_round = 2 WHERE user_id = $1', [OTHER]);
  await db.query(`INSERT INTO player_reports (target_id, reporter_id, reason, created_at) VALUES ($1, $2, 'rude', $3)`, [OTHER, USER, WHEN]);
  await db.query(`INSERT INTO viewer_days (day, used) VALUES ('2026-10-01', 149)`);
  await db.query(`INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, 'ranked', $2, $2)`, [OTHER, WHEN]);
}

describe('migrate, on the live database after the fourth wave', () => {
  beforeEach(afterFourthWave);
  const EARLIER = [...OLD_TABLES, ...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES, ...THIRD_WAVE_TABLES, ...FOURTH_WAVE_TABLES];

  it('adds what the fifth wave needs, with every new column at its default, and keeps every row', async () => {
    const before = await contents(EARLIER);
    await migrate(db);
    const after = await contents(EARLIER);
    expect(after).toMatchObject(upgraded(before));
    for (const table of EARLIER) {
      expect(after[table]).toHaveLength(before[table]?.length ?? -1);
      expect(after[table]).not.toEqual([]);
    }
    const account = {
      guest: false,
      last_seen_at: null,
      country: null,
      deleted_at: null,
      login_streak: 0,
      login_day: null,
      duel_wins: 0,
      duel_losses: 0,
      duel_ties: 0,
      best_country: 0,
      best_continent: 0,
      allow_requests: true,
      hide_chat: false,
      profile_views: 0,
      last_dodge_at: null,
      ranked_locked_until: null,
      last_ranked_opponent: null,
      last_ranked_at: null,
    };
    expect(after.users).toMatchObject((after.users ?? []).map(() => account));
    expect(after.matches).toMatchObject([{ communication: 'chat', teams: 'none', locked: false, moved_to_queue: null }]);
    expect(after.match_players).toMatchObject((after.match_players ?? []).map(() => ({ kicked: false, muted: [], pin_round: null, pin_lng: null, pin_lat: null })));
    expect(after.match_queue).toMatchObject((after.match_queue ?? []).map(() => ({ group_id: null })));
    expect(after.streak_runs).toMatchObject([{ kind: 'streak' }]);
    expect(after.progress_days).toMatchObject([{ xp: 4321, rating: 1016, xp_rank: null, rating_rank: null, xp_gained: 0 }]);
    expect(after.community_maps).toMatchObject([{ details: '', likes: 1 }]);
    for (const rows of Object.values(await contents(FIFTH_WAVE_TABLES))) {
      expect(rows).toEqual([]);
    }
  });

  it('moves an account that never played a rated game to the new starting rating, and leaves a rated one where it was', async () => {
    await migrate(db);
    const ratings = Object.fromEntries((await db.query<{ username: string; rating: number }>('SELECT username, rating FROM users')).map((row) => [row.username, row.rating]));
    expect(ratings).toEqual({ neel: 1016, friend: 500, waiting: 500 });
    await db.query(`INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, 'newcomer', 'hash', $2)`, [randomUUID(), WHEN]);
    expect(await db.query(`SELECT rating FROM users WHERE username = 'newcomer'`)).toEqual([{ rating: 500 }]);
  });

  it('moves the recorded days of an unrated account with it, so its chart shows no fall, and leaves a rated account\u2019s days alone', async () => {
    await db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-01', 50, 1000), ($1, '2026-10-02', 90, 1000)`, [OTHER]);
    await db.query(`INSERT INTO progress_days (user_id, day, xp, rating) VALUES ($1, '2026-10-02', 4400, 1000)`, [USER]);
    await migrate(db);
    await migrate(db);
    expect(await db.query('SELECT u.username, p.day, p.rating FROM progress_days p JOIN users u ON u.id = p.user_id ORDER BY u.username, p.day')).toEqual([
      { username: 'friend', day: '2026-10-01', rating: 500 },
      { username: 'friend', day: '2026-10-02', rating: 500 },
      { username: 'neel', day: '2026-10-01', rating: 1016 },
      { username: 'neel', day: '2026-10-02', rating: 1000 },
    ]);
  });

  it('changes nothing when run again and again, with the fifth wave in use', async () => {
    await migrate(db);
    await db.query(`UPDATE users SET guest = true, country = 'FR', duel_wins = 3, last_seen_at = $1 WHERE id = $2`, [WHEN, OTHER]);
    await db.query(`UPDATE matches SET communication = 'off', teams = 'best', locked = true`);
    await db.query(`UPDATE match_players SET kicked = true, muted = '["x"]'::jsonb, pin_round = 1, pin_lng = 2, pin_lat = 3 WHERE user_id = $1`, [OTHER]);
    await db.query(
      `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, result, score, max_score, players, rounds)
       VALUES ($1, $2, $3, 'ranked', 'world', 'move', 60, $4, 'win', 9000, 25000, 2, '[]'::jsonb)`,
      [randomUUID(), USER, MATCH, WHEN],
    );
    await db.query(`INSERT INTO daily_attempts (user_id, day, started_at) VALUES ($1, '2026-10-01', $2)`, [USER, WHEN]);
    await db.query(`UPDATE community_maps SET details = 'Long.', likes = 1`);
    const all = [...EARLIER, ...FIFTH_WAVE_TABLES];
    const before = await contents(all);

    await migrate(db);
    await migrate(db);
    expect(await contents(all)).toEqual(before);
  });

  it('holds an account to one daily attempt a day, and takes its attempts and online games with it when it goes', async () => {
    await migrate(db);
    const begin = () => db.query(`INSERT INTO daily_attempts (user_id, day, started_at) VALUES ($1, '2026-10-01', $2)`, [USER, WHEN]);
    await begin();
    await expect(begin()).rejects.toThrow(/daily_attempts_pkey/);
    await db.query(
      `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, score, max_score, players, rounds)
       VALUES ($1, $2, $3, 'party', 'world', 'move', 60, $4, 0, 5000, 2, '[]'::jsonb)`,
      [randomUUID(), USER, MATCH, WHEN],
    );
    await db.query('DELETE FROM users WHERE id = $1', [USER]);
    for (const rows of Object.values(await contents(FIFTH_WAVE_TABLES))) {
      expect(rows).toEqual([]);
    }
  });
});

/** The same again after the fifth wave: a guest, a locked party with a kicked player, a history row, a daily attempt. */
async function afterFifthWave(): Promise<void> {
  await afterFourthWave();
  await run(FIFTH_WAVE);
  await db.query(`UPDATE users SET country = 'FR', duel_wins = 3, last_seen_at = $1 WHERE id = $2`, [WHEN, OTHER]);
  await db.query(`UPDATE matches SET communication = 'off', teams = 'best', locked = true`);
  await db.query(`UPDATE match_players SET kicked = true, muted = '["x"]'::jsonb WHERE user_id = $1`, [OTHER]);
  await db.query(
    `INSERT INTO online_games (id, user_id, match_id, kind, map, mode, time_limit, played_at, result, score, max_score, players, rounds)
     VALUES ($1, $2, $3, 'ranked', 'world', 'move', 60, $4, 'win', 9000, 25000, 2, '[]'::jsonb)`,
    [randomUUID(), USER, MATCH, WHEN],
  );
  await db.query(`INSERT INTO daily_attempts (user_id, day, started_at) VALUES ($1, '2026-10-01', $2)`, [USER, WHEN]);
}

describe('migrate, on the live database after the fifth wave', () => {
  beforeEach(afterFifthWave);
  const EARLIER = [...OLD_TABLES, ...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES, ...THIRD_WAVE_TABLES, ...FOURTH_WAVE_TABLES, ...FIFTH_WAVE_TABLES];

  it('adds what the sixth wave needs, with every new column at its default, and changes no row', async () => {
    const before = await contents(EARLIER);
    await migrate(db);
    const after = await contents(EARLIER);
    expect(after).toMatchObject(before);
    for (const table of EARLIER) {
      expect(after[table]).toHaveLength(before[table]?.length ?? -1);
      expect(after[table]).not.toEqual([]);
    }
    const account = { session_version: 0, recovery_hash: null, team_wins: 0, team_losses: 0, team_ties: 0, hide_last_seen: false, solo_xp: 0, solo_xp_day: null };
    expect(after.users).toMatchObject((after.users ?? []).map(() => account));
    expect(after.matches).toMatchObject([{ guests: true }]);
    expect(after.match_players).toMatchObject((after.match_players ?? []).map(() => ({ acts: 0, acts_from: null })));
    expect(after.player_reports).toMatchObject([{ reason: 'rude', category: 'other', status: 'open' }]);
    for (const rows of Object.values(await contents(SIXTH_WAVE_TABLES))) {
      expect(rows).toEqual([]);
    }
  });

  it('changes nothing when run again and again, with the sixth wave in use', async () => {
    await migrate(db);
    await db.query(`UPDATE users SET session_version = 4, recovery_hash = 'hash', team_wins = 2, hide_last_seen = true, solo_xp = 900, solo_xp_day = '2026-10-01' WHERE id = $1`, [USER]);
    await db.query('UPDATE matches SET guests = false');
    await db.query('UPDATE match_players SET acts = 7, acts_from = $1', [WHEN]);
    await db.query(`UPDATE player_reports SET category = 'chat', status = 'actioned'`);
    await db.query(`INSERT INTO queue_waits (kind, found_at, waited_ms) VALUES ('ranked', $1, 4200)`, [WHEN]);
    const all = [...EARLIER, ...SIXTH_WAVE_TABLES];
    const before = await contents(all);

    await migrate(db);
    await migrate(db);
    expect(await contents(all)).toEqual(before);
  });
});

describe('migrate, on the database as it was before multiplayer', () => {
  beforeEach(beforeMultiplayer);

  it('adds everything since and keeps every row', async () => {
    const before = await contents(OLD_TABLES);
    await migrate(db);
    const after = await contents(OLD_TABLES);

    const since = { rating: 500, rated_games: 0, xp: 0, best_streak: 0, renamed_at: null, banned: false };
    expect(after.users).toMatchObject(before.users?.map((user) => ({ ...(user as object), ...since })) ?? []);
    expect(after.games).toMatchObject(before.games?.map((game) => ({ ...(game as object), daily: null, xp_earned: 0 })) ?? []);
    expect(after.game_rounds).toMatchObject(
      before.game_rounds?.map((round) => ({ ...(round as object), lng: null, lat: null, guess_lng: null, guess_lat: null, hinted: false })) ?? [],
    );
    expect(after.rate_limits).toEqual(before.rate_limits);
    for (const rows of Object.values(await contents([...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES, ...THIRD_WAVE_TABLES, ...FOURTH_WAVE_TABLES]))) {
      expect(rows).toEqual([]);
    }
  });
});

describe('migrate, on the live database after the first wave', () => {
  beforeEach(afterFirstWave);

  it('adds what the second wave needs and keeps every row, with matches under way', async () => {
    const before = await contents([...OLD_TABLES, ...FIRST_WAVE_TABLES]);
    await migrate(db);
    const after = await contents([...OLD_TABLES, ...FIRST_WAVE_TABLES]);

    expect(after.users).toMatchObject(upgraded(before).users?.map((user) => ({ ...(user as object), xp: 0, best_streak: 0, renamed_at: null, banned: false })) ?? []);
    expect(after.users).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'neel', rating: 1016, rated_games: 1 })]));
    expect(after.games).toMatchObject(before.games?.map((game) => ({ ...(game as object), xp_earned: 0 })) ?? []);
    expect(after.games).toMatchObject([{ daily: '2026-10-01' }]);
    expect(after.game_rounds).toMatchObject(
      before.game_rounds?.map((round) => ({ ...(round as object), lng: null, lat: null, guess_lng: null, guess_lat: null, hinted: false })) ?? [],
    );
    expect(after.matches).toMatchObject(before.matches?.map((match) => ({ ...(match as object), chat: [] })) ?? []);
    expect(after.matches).toMatchObject([{ kind: 'ranked', phase: 'playing', round: 1, rounds: 5 }]);
    for (const table of ['rate_limits', 'match_players', 'match_guesses', 'match_queue']) {
      expect(after[table]).toMatchObject(before[table] ?? []);
      expect(after[table]).not.toEqual([]);
    }
    for (const rows of Object.values(await contents(SECOND_WAVE_TABLES))) {
      expect(rows).toEqual([]);
    }
  });

  it('changes nothing when run again and again, with the second wave in use', async () => {
    await migrate(db);
    await db.query('UPDATE users SET xp = 4321, best_streak = 7, renamed_at = $1 WHERE id = $2', [WHEN, USER]);
    await db.query(`UPDATE matches SET chat = '[{"id": 1, "text": "hello"}]'::jsonb`);
    await db.query('INSERT INTO friendships (requester_id, addressee_id, accepted, created_at) VALUES ($1, $2, true, $3)', [USER, OTHER, WHEN]);
    await db.query(`INSERT INTO party_invites (from_id, to_id, code, sent_at) VALUES ($1, $2, 'ABCDEF', $3)`, [USER, OTHER, WHEN]);
    await db.query(`INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at) VALUES ($1, 'run', 7, 140, $2)`, [USER, WHEN]);
    const all = [...OLD_TABLES, ...FIRST_WAVE_TABLES, ...SECOND_WAVE_TABLES];
    const before = await contents(all);

    await migrate(db);
    await migrate(db);
    expect(await contents(all)).toEqual(before);
  });

  it('holds a player to one unfinished match, however many finished ones they have', async () => {
    await migrate(db);
    await seat(await addMatch(), false);
    await seat(await addMatch(), false);
    await expect(seat(await addMatch(), true)).rejects.toThrow(/match_players_open_idx/);
  });

  it('holds a player to one queue', async () => {
    await migrate(db);
    const enqueue = (kind: string) => db.query('INSERT INTO match_queue (user_id, kind, joined_at, last_seen_at) VALUES ($1, $2, $3, $3)', [USER, kind, WHEN]);
    await enqueue('ranked');
    await expect(enqueue('team')).rejects.toThrow(/match_queue_pkey/);
  });

  it('holds an account to one daily result a day, and to any number of other games', async () => {
    await migrate(db);
    const play = (daily: string | null) =>
      db.query(
        `INSERT INTO games (id, user_id, map, mode, time_limit, seed, rounds, score, max_score, played_at, daily)
         VALUES ($1, $2, 'world', 'move', 120, 'abc', 5, 1, 25000, $3, $4)`,
        [randomUUID(), USER, WHEN, daily],
      );
    await play(null);
    await play(null);
    await play('2026-10-11');
    await expect(play('2026-10-11')).rejects.toThrow(/games_user_daily_idx/);
  });

  it('holds two players to one tie between them, whoever asked, and nobody to one with themselves', async () => {
    await migrate(db);
    const ask = (from: string, to: string) => db.query('INSERT INTO friendships (requester_id, addressee_id, created_at) VALUES ($1, $2, $3)', [from, to, WHEN]);
    await ask(USER, OTHER);
    await expect(ask(USER, OTHER)).rejects.toThrow(/friendships_pkey/);
    await expect(ask(OTHER, USER)).rejects.toThrow(/friendships_pair_idx/);
    await expect(ask(USER, USER)).rejects.toThrow(/check/i);
  });

  it('holds a streak run to one count per player', async () => {
    await migrate(db);
    const record = (userId: string) => db.query(`INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at) VALUES ($1, 'run', 3, 60, $2)`, [userId, WHEN]);
    await record(USER);
    await record(OTHER);
    await expect(record(USER)).rejects.toThrow(/streak_runs_pkey/);
  });

  it('takes a deleted account out of its matches, its queue, its friendships, its invitations and its runs', async () => {
    await migrate(db);
    await db.query('INSERT INTO friendships (requester_id, addressee_id, created_at) VALUES ($1, $2, $3)', [OTHER, USER, WHEN]);
    await db.query(`INSERT INTO party_invites (from_id, to_id, code, sent_at) VALUES ($1, $2, 'ABCDEF', $3)`, [OTHER, USER, WHEN]);
    await db.query(`INSERT INTO streak_runs (user_id, seed, streak, xp_earned, played_at) VALUES ($1, 'run', 3, 60, $2)`, [USER, WHEN]);
    await db.query('DELETE FROM users');
    for (const rows of Object.values(await contents(['match_players', 'match_guesses', 'match_queue', ...SECOND_WAVE_TABLES]))) {
      expect(rows).toEqual([]);
    }
  });
});

describe('migrate, as an instance starting up', () => {
  /** The same database, noting every statement it is asked to run outside a transaction. */
  function watched(inner: Db): { db: Db; asked: string[] } {
    const asked: string[] = [];
    const db: Db = {
      query: (sql, params) => {
        asked.push(sql);
        return inner.query(sql, params);
      },
      transaction: inner.transaction,
    };
    return { db, asked };
  }
  const changesSchema = (sql: string): boolean => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql);

  beforeEach(async () => {
    db = await createPgliteDb();
  });

  it('records what it set up, so the next instance does two small reads and changes nothing', async () => {
    const first = watched(db);
    await migrate(first.db);
    expect(first.asked.filter(changesSchema).length).toBeGreaterThan(40);
    expect(await db.query('SELECT version FROM schema_version')).toEqual([{ version: SCHEMA_VERSION }]);
    expect(SCHEMA_VERSION).toMatch(/^[0-9a-f]{16}$/);

    const second = watched(db);
    await migrate(second.db);
    expect(second.asked).toHaveLength(2);
    expect(second.asked.filter(changesSchema)).toEqual([]);
    expect(second.asked.every((sql) => sql.trimStart().startsWith('SELECT'))).toBe(true);
  });

  it('sets up again, and records it, when a release has changed the statements', async () => {
    await migrate(db);
    await db.query(`UPDATE schema_version SET version = 'an-earlier-release'`);
    const next = watched(db);
    await migrate(next.db);
    expect(next.asked.filter(changesSchema).length).toBeGreaterThan(40);
    expect(await db.query('SELECT only_row, version FROM schema_version')).toEqual([{ only_row: true, version: SCHEMA_VERSION }]);
  });

  it('brings a database with every table but no record, which is the live one today, up to date and records it', async () => {
    await migrate(db);
    await db.query('DROP TABLE schema_version');
    await migrate(db);
    expect(await db.query('SELECT version FROM schema_version')).toEqual([{ version: SCHEMA_VERSION }]);
  });

  it('does its work under the one setup lock when the database has other sessions to keep out', async () => {
    const taken: number[] = [];
    const during: boolean[] = [];
    let held = false;
    const shared: Db = {
      query: (sql, params) => {
        if (changesSchema(sql)) {
          during.push(held);
        }
        return db.query(sql, params);
      },
      transaction: db.transaction,
      exclusively: async (key, fn) => {
        taken.push(key);
        held = true;
        try {
          return await fn();
        } finally {
          held = false;
        }
      },
    };
    await migrate(shared);
    expect(taken).toEqual([SETUP_LOCK]);
    expect(during.length).toBeGreaterThan(40);
    expect(during.every(Boolean)).toBe(true);

    // Already set up: the next instance does not even take the lock.
    await migrate(shared);
    expect(taken).toEqual([SETUP_LOCK]);
  });

  it('does nothing when the instance it waited for has already done the work', async () => {
    const { db: watching, asked } = watched(db);
    const waited: Db = {
      ...watching,
      exclusively: async (_key, fn) => {
        // While this instance waited for the lock, another set everything up.
        await migrate(db);
        asked.length = 0;
        return fn();
      },
    };
    await migrate(waited);
    expect(asked.filter(changesSchema)).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it('lets a failure through and records nothing, so the next request tries again', async () => {
    const failing: Db = {
      query: (sql, params) => (sql.includes('match_queue') ? Promise.reject(new Error('connection lost')) : db.query(sql, params)),
      transaction: db.transaction,
    };
    await expect(migrate(failing)).rejects.toThrow('connection lost');
    expect(await db.query(`SELECT to_regclass('schema_version') IS NOT NULL AS present`)).toEqual([{ present: false }]);
    await migrate(db);
    expect(await db.query('SELECT version FROM schema_version')).toEqual([{ version: SCHEMA_VERSION }]);
  });
});
