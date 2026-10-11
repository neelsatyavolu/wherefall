import { z } from 'zod';
import { accountIn, noAccount, playerIn } from '../account/identity.js';
import { slugSchema } from '../account/input.js';
import { MAP_LISTS, deleteMap, isOpenTo, listMaps, mapBySlug, playsOf, saveReport, setLike, summaryOf, type MapList } from '../db/maps.js';
import { hitRateLimit } from '../db/rate-limit.js';
import { clientIp, fail, hashIp, ok, readBody, sameOrigin } from '../http.js';
import {
  MAX_MAP_DESCRIPTION,
  MAX_MAP_NAME,
  MAX_MAP_PLACES,
  MAX_REPORT_REASON,
  MIN_MAP_DESCRIPTION,
  MIN_MAP_NAME,
  MIN_MAP_PLACES,
  mapActionNameSchema,
  mapActionSchemas,
  type MapAction,
} from '../maps/input.js';
import { saveMap } from '../maps/maps.js';
import type { Context } from '../serve.js';
import { BANNED } from '../social/moderation.js';

const NO_SUCH_MAP = 'There is no such map.';
// Deleting is the maker's own, and the same answer covers a map that does not exist and one somebody else made.
const NOT_YOUR_MAP = 'You have no map by that name.';
const HOUR_MS = 60 * 60_000;

export const MAPS_PER_PAGE = 24;
/** A search shorter than this is not a search: the list comes back whole. */
const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_LENGTH = 40;
const MAX_PAGE = 10_000;

/** The lists that are the asker's own, and so need an account. */
const OWN_LISTS: readonly MapList[] = ['mine', 'liked'];

const INVALID = {
  save:
    `A map needs a name of ${MIN_MAP_NAME} to ${MAX_MAP_NAME} characters, a description of ${MIN_MAP_DESCRIPTION} to ${MAX_MAP_DESCRIPTION}, ` +
    `and ${MIN_MAP_PLACES} to ${MAX_MAP_PLACES} places.`,
  like: 'Name a map and say whether you like it.',
  report: `A report names a map and gives a reason of up to ${MAX_REPORT_REASON} characters.`,
};

// Per account, except playing: that one is per network address, as it was while a visitor could ask.
// Deleting only ever takes away what its maker made, so its limit is there to stop a script, not a person.
const LIMITS: Record<MapAction, { perHour: number; error: string }> = {
  save: { perHour: 30, error: 'Too many maps saved in the last hour. Try again later.' },
  delete: { perHour: 60, error: 'Too many requests. Slow down a little.' },
  like: { perHour: 120, error: 'Too many likes in the last hour. Try again later.' },
  play: { perHour: 120, error: 'Too many maps started from this network in the last hour. Try again later.' },
  report: { perHour: 20, error: 'Too many reports in the last hour. Try again later.' },
};

/** The first page is 1. A missing page, or 0, is the first. */
const pageSchema = z.coerce.number().int().min(0).max(MAX_PAGE);

async function list(params: URLSearchParams, request: Request, context: Context): Promise<Response> {
  const which = z.enum(MAP_LISTS).safeParse(params.get('list'));
  const asked = pageSchema.safeParse(params.get('page') ?? '1');
  if (!which.success || !asked.success) {
    return fail('Ask for the popular maps, the newest, your own, or the ones you like, by page.', 400);
  }
  const viewer = await playerIn(request, context);
  const viewerId = viewer && !viewer.guest ? viewer.userId : null;
  if (OWN_LISTS.includes(which.data) && !viewerId) {
    return noAccount(viewer);
  }
  const page = Math.max(1, asked.data);
  const typed = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  const search = typed.length < MIN_SEARCH_LENGTH ? '' : typed;
  const found = await listMaps(context.db, { list: which.data, search, viewerId, limit: MAPS_PER_PAGE, offset: (page - 1) * MAPS_PER_PAGE });
  return ok({ maps: found.slice(0, MAPS_PER_PAGE), page, more: found.length > MAPS_PER_PAGE });
}

/** `?slug=` is one map with its places; `?list=` is a page of maps without them. Both are open to visitors, but for the asker's own lists. */
export async function mapsGet(request: Request, context: Context): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.has('slug')) {
    const slug = slugSchema.safeParse(params.get('slug'));
    const map = slug.success ? await mapBySlug(context.db, slug.data, (await accountIn(request, context))?.userId ?? null) : null;
    return map ? ok(map) : fail(NO_SUCH_MAP, 404);
  }
  if (params.has('list')) {
    return list(params, request, context);
  }
  return fail('Ask for a map by its slug, or for a list of maps.', 400);
}

type Handler = (body: unknown, userId: string, context: Context) => Promise<Response>;

/** True while the account, or the address, is within its hourly limit for the action. */
function withinLimit(action: MapAction, who: string, { db, now }: Context): Promise<boolean> {
  return hitRateLimit(db, `map-${action}:${who}`, LIMITS[action].perHour, HOUR_MS, now);
}

const tooMany = (action: MapAction): Response => fail(LIMITS[action].error, 429);

const save: Handler = async (body, userId, { db, now }) => {
  const input = mapActionSchemas.save.safeParse(body);
  if (!input.success) {
    return fail(INVALID.save, 400);
  }
  const saved = await saveMap(db, userId, input.data, now);
  return saved.ok ? ok(saved.data, input.data.slug === undefined ? 201 : 200) : fail(saved.error, saved.status);
};

const remove: Handler = async (body, userId, { db }) => {
  const input = mapActionSchemas.delete.safeParse(body);
  return input.success && (await deleteMap(db, input.data.slug, userId)) ? ok({ deleted: true }) : fail(NOT_YOUR_MAP, 404);
};

const like: Handler = async (body, userId, { db }) => {
  const input = mapActionSchemas.like.safeParse(body);
  if (!input.success) {
    return fail(INVALID.like, 400);
  }
  if (!(await isOpenTo(db, input.data.slug, userId))) {
    return fail(NO_SUCH_MAP, 404);
  }
  await setLike(db, input.data.slug, userId, input.data.liked);
  const summary = await summaryOf(db, input.data.slug, userId);
  return summary ? ok(summary) : fail(NO_SUCH_MAP, 404);
};

const report: Handler = async (body, userId, { db, now }) => {
  const input = mapActionSchemas.report.safeParse(body);
  if (!input.success) {
    return fail(INVALID.report, 400);
  }
  if (!(await isOpenTo(db, input.data.slug, userId))) {
    return fail(NO_SUCH_MAP, 404);
  }
  return (await saveReport(db, input.data.slug, userId, input.data.reason, now)) ? ok({ reported: true }) : fail(NO_SUCH_MAP, 404);
};

const HANDLERS: Record<Exclude<MapAction, 'play'>, Handler> = { save, delete: remove, like, report };

/**
 * Counts a game started on a map. Limited by network address, and a map gains
 * one play an hour at most from each account.
 */
async function play(body: unknown, userId: string, request: Request, context: Context): Promise<Response> {
  const { db, now } = context;
  const address = hashIp(clientIp(request), context.secret);
  if (!(await withinLimit('play', address, context))) {
    return tooMany('play');
  }
  const input = mapActionSchemas.play.safeParse(body);
  if (!input.success || !(await isOpenTo(db, input.data.slug, userId))) {
    return fail(NO_SUCH_MAP, 404);
  }
  const { slug } = input.data;
  const firstThisHour = await hitRateLimit(db, `map-played:${slug}:${userId}`, 1, HOUR_MS, now);
  const plays = await playsOf(db, slug, firstThisHour);
  return plays === null ? fail(NO_SUCH_MAP, 404) : ok({ plays });
}

/** Making, changing and deleting a map, liking, reporting, and counting a play: `{ action, ... }`. */
export async function mapsPost(request: Request, context: Context): Promise<Response> {
  if (!sameOrigin(request)) {
    return fail('Request refused.', 403);
  }
  const body = await readBody(request, mapActionNameSchema);
  if (!body) {
    return fail('That is not something a map can be asked to do.', 400);
  }
  const player = await playerIn(request, context);
  const userId = player && !player.guest ? player.userId : null;
  if (!player || !userId) {
    return noAccount(player);
  }
  // A banned account can still play alone, and so still counts a play.
  if (body.action === 'play') {
    return play(body, userId, request, context);
  }
  // A banned account may still take its own maps down, and nothing else here.
  if (player.banned && body.action !== 'delete') {
    return fail(BANNED, 403);
  }
  if (!(await withinLimit(body.action, userId, context))) {
    return tooMany(body.action);
  }
  return HANDLERS[body.action](body, userId, context);
}
