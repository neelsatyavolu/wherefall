import { z } from 'zod';
import { call, post, type Result } from '../account/client.ts';
import type { LocationSet } from '../game/locations.ts';

const MAPS = '/api/maps';

/** `popular` is by likes, then plays, then age. `mine` and `liked` need a session; `liked` is newest first. */
export const MAP_LISTS = ['popular', 'newest', 'mine', 'liked'] as const;
export type MapList = (typeof MAP_LISTS)[number];

/**
 * The limits the server holds a map to, repeated here so a form can say so before sending. The
 * description is the short one, which every map must have; `maxDetails` is for the long one, which
 * is optional. A search shorter than `minSearch` characters is ignored by the server. All of an
 * account's maps together hold `accountPlaces` places: a save past that is refused (409) in the
 * server's words, which is the only place the total is known.
 */
export const MAP_LIMITS = {
  minPlaces: 5,
  maxPlaces: 5000,
  minName: 3,
  maxName: 30,
  minDescription: 20,
  maxDescription: 100,
  maxDetails: 1000,
  maxReason: 200,
  perAccount: 20,
  accountPlaces: 25_000,
  minSearch: 3,
} as const;

const summarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** the username of the player who made it */
  maker: z.string(),
  places: z.number(),
  plays: z.number(),
  likes: z.number(),
  /** whether the asker likes it; false for a visitor */
  liked: z.boolean(),
  /** the short description: 20 to 100 characters, or what a map saved before that rule has */
  description: z.string(),
});

/** One place: id, longitude, latitude, country. The same row shape as the dataset files. */
const rowSchema = z.tuple([z.string(), z.number(), z.number(), z.string()]);

const detailSchema = summarySchema.extend({
  /** the long description: up to 1000 characters, line breaks kept; may be empty */
  details: z.string(),
  /** ISO 8601 */
  createdAt: z.string(),
  /** whether the asker made it */
  mine: z.boolean(),
  locations: z.array(rowSchema),
});

const pageSchema = z.object({ maps: z.array(summarySchema), page: z.number(), more: z.boolean() });

export type MapSummary = z.infer<typeof summarySchema>;
export type MapDetail = z.infer<typeof detailSchema>;
export type MapRow = z.infer<typeof rowSchema>;
export type MapPage = z.infer<typeof pageSchema>;

export interface MapContent {
  /** 3 to 30 characters */
  name: string;
  /** the short description, 20 to 100 characters */
  description: string;
  /** the long description, up to 1000 characters; left out, the map has none */
  details?: string;
  /** 5 to 5000 places */
  locations: MapRow[];
}

type Reply<T> = Promise<Result<T>>;

/**
 * A page of community maps: 24 at a time, pages from 1. `mine` and `liked` need a session. A search
 * of three or more characters looks in the name, the description and the maker's name.
 */
export function getMaps(ask: { list: MapList; search?: string; page?: number }, fetchFn: typeof fetch = fetch): Reply<MapPage> {
  const params = new URLSearchParams({ list: ask.list, page: String(ask.page ?? 1) });
  const search = ask.search?.trim() ?? '';
  if (search !== '') {
    params.set('q', search);
  }
  return call(fetchFn, `${MAPS}?${params}`, pageSchema);
}

/** One map with its places. The map of a maker who is banned or deleted is 404 "There is no such map." to everyone but its maker. */
export function getMap(slug: string, fetchFn: typeof fetch = fetch): Reply<MapDetail> {
  return call(fetchFn, `${MAPS}?slug=${encodeURIComponent(slug)}`, detailSchema);
}

/** Publishes a new map, or saves over one of the player's own when its slug is given. */
export function saveMap(content: MapContent, slug: string | null, fetchFn: typeof fetch = fetch): Reply<MapDetail> {
  return call(fetchFn, MAPS, detailSchema, post({ action: 'save', ...(slug === null ? {} : { slug }), ...content }));
}

/** Deletes one of the player's own maps. 60 an hour, then `REFUSALS.slowDown`. */
export function deleteMap(slug: string, fetchFn: typeof fetch = fetch): Reply<{ deleted: true }> {
  return call(fetchFn, MAPS, z.object({ deleted: z.literal(true) }), post({ action: 'delete', slug }));
}

export function likeMap(slug: string, liked: boolean, fetchFn: typeof fetch = fetch): Reply<MapSummary> {
  return call(fetchFn, MAPS, summarySchema, post({ action: 'like', slug, liked }));
}

/** Tells the server a game on the map has started. It counts at most one an hour per player per map. */
export function countPlay(slug: string, fetchFn: typeof fetch = fetch): Reply<{ plays: number }> {
  return call(fetchFn, MAPS, z.object({ plays: z.number() }), post({ action: 'play', slug }));
}

export function reportMap(slug: string, reason: string, fetchFn: typeof fetch = fetch): Reply<{ reported: true }> {
  return call(fetchFn, MAPS, z.object({ reported: z.literal(true) }), post({ action: 'report', slug, reason }));
}

/** A community map's places as the set a game picks its rounds from. It has no regions: it is one map. */
export function toLocationSet(map: Pick<MapDetail, 'locations'>): LocationSet {
  return { regions: {}, locations: map.locations.map(([id, lng, lat, country]) => ({ id, lng, lat, country })) };
}
