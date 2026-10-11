import type { Queryable, Row } from './client.js';
import { fromTs, toTs } from './time.js';

export const MAP_LISTS = ['popular', 'newest', 'mine', 'liked'] as const;
export type MapList = (typeof MAP_LISTS)[number];

/** One place of a map: id, longitude, latitude, country. The same row shape as the dataset files. */
export type LocationRow = [id: string, lng: number, lat: number, country: string];

export interface MapSummary {
  slug: string;
  name: string;
  /** The username of the player who made it. */
  maker: string;
  /** The short description. Empty, or shorter than is now asked for, on a map saved before one was needed. */
  description: string;
  places: number;
  plays: number;
  likes: number;
  /** Whether the asker likes it. False for a visitor. */
  liked: boolean;
}

export interface MapDetail extends MapSummary {
  /** The long description, which may be empty. */
  details: string;
  /** ISO 8601. */
  createdAt: string;
  /** Whether the asker made it. */
  mine: boolean;
  locations: LocationRow[];
}

export interface MapContent {
  name: string;
  description: string;
  details: string;
  locations: LocationRow[];
}

// $1 is always the asker's account id, or null for a visitor. No list ever selects the places or the long description.
// The likes are the map's own count of them, which `setLike` keeps in step with the likes themselves.
const LIKED = 'EXISTS (SELECT 1 FROM map_likes l WHERE l.slug = m.slug AND l.user_id = $1::uuid)';
const SUMMARY = `m.slug, m.name, u.username AS maker, m.description, m.places, m.plays, m.likes, ${LIKED} AS liked`;
const MAPS = 'community_maps m JOIN users u ON u.id = m.owner_id';

// Each ends on the slug, which no two maps share, so a list never reorders between pages.
const ORDER: Record<MapList, string> = {
  popular: 'm.likes DESC, m.plays DESC, m.created_at DESC, m.slug',
  newest: 'm.created_at DESC, m.slug',
  mine: 'm.created_at DESC, m.slug',
  liked: 'm.created_at DESC, m.slug',
};

function rowToSummary(row: Row): MapSummary {
  return {
    slug: row.slug as string,
    name: row.name as string,
    maker: row.maker as string,
    description: row.description as string,
    places: row.places as number,
    plays: row.plays as number,
    likes: row.likes as number,
    liked: row.liked as boolean,
  };
}

/** In a LIKE pattern `%` and `_` stand for anything; a search for them should find only themselves. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);

/**
 * One page of a list of maps, without their places. `search` keeps the maps
 * whose name, short description or maker's name contains it, whatever the
 * capitals. The maps of a banned or a deleted account are in no list but its
 * own. `liked` is the maps the asker likes. Asks for one more than `limit`
 * when there is one, so the caller can tell whether another page follows.
 */
export async function listMaps(
  q: Queryable,
  ask: { list: MapList; search: string; viewerId: string | null; limit: number; offset: number },
): Promise<MapSummary[]> {
  const pattern = ask.search === '' ? null : `%${escapeLike(ask.search.toLowerCase())}%`;
  const rows = await q.query(
    `SELECT ${SUMMARY} FROM ${MAPS}
      WHERE ($2::text IS NULL OR lower(m.name) LIKE $2 ESCAPE '\\' OR lower(m.description) LIKE $2 ESCAPE '\\' OR lower(u.username) LIKE $2 ESCAPE '\\')
        AND (CASE WHEN $3::text = 'mine' THEN m.owner_id = $1::uuid ELSE NOT u.banned AND u.deleted_at IS NULL END)
        AND ($3::text <> 'liked' OR ${LIKED})
      ORDER BY ${ORDER[ask.list]} LIMIT $4 OFFSET $5`,
    [ask.viewerId, pattern, ask.list, ask.limit + 1, ask.offset],
  );
  return rows.map(rowToSummary);
}

export async function summaryOf(q: Queryable, slug: string, viewerId: string | null): Promise<MapSummary | null> {
  const [row] = await q.query(`SELECT ${SUMMARY} FROM ${MAPS} WHERE m.slug = $2`, [viewerId, slug]);
  return row ? rowToSummary(row) : null;
}

/**
 * A map with its places, in one query. Null when there is no such map, and
 * for the map of a banned or a deleted account, which a link to it opens for
 * nobody but its maker: it is in no list either.
 */
export async function mapBySlug(q: Queryable, slug: string, viewerId: string | null): Promise<MapDetail | null> {
  const [row] = await q.query(
    `SELECT ${SUMMARY}, m.details, m.created_at, m.locations, coalesce(m.owner_id = $1::uuid, false) AS mine
       FROM ${MAPS} WHERE m.slug = $2 AND (m.owner_id = $1::uuid OR (NOT u.banned AND u.deleted_at IS NULL))`,
    [viewerId, slug],
  );
  if (!row) {
    return null;
  }
  return {
    ...rowToSummary(row),
    details: row.details as string,
    createdAt: new Date(fromTs(row.created_at)).toISOString(),
    mine: row.mine as boolean,
    locations: row.locations as LocationRow[],
  };
}

/** A community map's places as they are stored now, for checking a game played on it. Null when there is no such map. */
export async function locationsOf(q: Queryable, slug: string): Promise<LocationRow[] | null> {
  const [row] = await q.query<{ locations: LocationRow[] }>('SELECT locations FROM community_maps WHERE slug = $1', [slug]);
  return row?.locations ?? null;
}

/**
 * True when there is such a map and `viewerId` may reach it: anyone may,
 * unless its maker is banned or has deleted their account, and then only the
 * maker. What a link to a map opens, and what can be done to one by naming it.
 */
export async function isOpenTo(q: Queryable, slug: string, viewerId: string | null): Promise<boolean> {
  const rows = await q.query(
    `SELECT 1 FROM community_maps m JOIN users u ON u.id = m.owner_id
      WHERE m.slug = $1 AND (m.owner_id = $2::uuid OR (NOT u.banned AND u.deleted_at IS NULL))`,
    [slug, viewerId],
  );
  return rows.length > 0;
}

export async function mapExists(q: Queryable, slug: string): Promise<boolean> {
  return (await q.query('SELECT 1 FROM community_maps WHERE slug = $1', [slug])).length > 0;
}

/** Every map an account has made, by its slug, with how many places each holds: what the limits on an account's maps count. */
export async function mapSizesOf(q: Queryable, ownerId: string): Promise<Array<{ slug: string; places: number }>> {
  return q.query<{ slug: string; places: number }>('SELECT slug, places FROM community_maps WHERE owner_id = $1', [ownerId]);
}

/** False when the slug is taken. */
export async function insertMap(q: Queryable, slug: string, ownerId: string, map: MapContent, now: number): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO community_maps (slug, owner_id, name, description, details, locations, places, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, $8::timestamptz)
     ON CONFLICT (slug) DO NOTHING RETURNING slug`,
    [slug, ownerId, map.name, map.description, map.details, JSON.stringify(map.locations), map.locations.length, toTs(now)],
  );
  return rows.length === 1;
}

/** Replaces what a map holds, keeping its slug, plays and likes. False unless `ownerId` made that map. */
export async function updateMap(q: Queryable, slug: string, ownerId: string, map: MapContent, now: number): Promise<boolean> {
  const rows = await q.query(
    `UPDATE community_maps SET name = $3, description = $4, details = $5, locations = $6::jsonb, places = $7, updated_at = $8::timestamptz
      WHERE slug = $1 AND owner_id = $2 RETURNING slug`,
    [slug, ownerId, map.name, map.description, map.details, JSON.stringify(map.locations), map.locations.length, toTs(now)],
  );
  return rows.length === 1;
}

/** False unless `ownerId` made that map. Its likes and reports go with it. */
export async function deleteMap(q: Queryable, slug: string, ownerId: string): Promise<boolean> {
  return (await q.query('DELETE FROM community_maps WHERE slug = $1 AND owner_id = $2 RETURNING slug', [slug, ownerId])).length === 1;
}

// The like and the map's count of likes change in one statement: the count moves only when a like was really
// added or taken away, and by the row lock it takes, likes arriving together are each counted.
const LIKE = `WITH given AS (
    INSERT INTO map_likes (slug, user_id) SELECT slug, $2::uuid FROM community_maps WHERE slug = $1
    ON CONFLICT DO NOTHING RETURNING slug)
  UPDATE community_maps m SET likes = m.likes + 1 FROM given WHERE m.slug = given.slug`;
const UNLIKE = `WITH taken AS (DELETE FROM map_likes WHERE slug = $1 AND user_id = $2::uuid RETURNING slug)
  UPDATE community_maps m SET likes = m.likes - 1 FROM taken WHERE m.slug = taken.slug`;

/** Likes or unlikes a map. Doing either twice changes nothing, and neither does liking a map that does not exist. */
export async function setLike(q: Queryable, slug: string, userId: string, liked: boolean): Promise<void> {
  await q.query(liked ? LIKE : UNLIKE, [slug, userId]);
}

/** How many times the map has been played, after counting one more if asked to. Null when there is no such map. */
export async function playsOf(q: Queryable, slug: string, countOne: boolean): Promise<number | null> {
  const [row] = countOne
    ? await q.query<{ plays: number }>('UPDATE community_maps SET plays = plays + 1 WHERE slug = $1 RETURNING plays', [slug])
    : await q.query<{ plays: number }>('SELECT plays FROM community_maps WHERE slug = $1', [slug]);
  return row?.plays ?? null;
}

/** Stores a player's report of a map, replacing their earlier one. False when there is no such map. */
export async function saveReport(q: Queryable, slug: string, reporterId: string, reason: string, now: number): Promise<boolean> {
  const rows = await q.query(
    `INSERT INTO map_reports (slug, reporter_id, reason, created_at)
     SELECT slug, $2::uuid, $3::text, $4::timestamptz FROM community_maps WHERE slug = $1
     ON CONFLICT (slug, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = EXCLUDED.created_at
     RETURNING slug`,
    [slug, reporterId, reason, toTs(now)],
  );
  return rows.length === 1;
}
