import { randomBytes } from 'node:crypto';
import type { Db, Queryable } from '../db/client.js';
import { insertMap, mapBySlug, mapSizesOf, updateMap, type MapContent, type MapDetail } from '../db/maps.js';
import { lockPlayer } from '../db/matches.js';
import { maskWords } from '../match/chat.js';
import { accept, refuse, type Reply } from '../match/types.js';

export const MAX_MAPS_PER_ACCOUNT = 20;
/** The most places all of an account's maps may hold between them: what keeps one account's maps from filling the database. */
export const MAX_PLACES_PER_ACCOUNT = 25_000;

// One answer for a map that does not exist and for one somebody else made.
export const NOT_YOUR_MAP = refuse(404, 'You have no map by that name.');
const TOO_MANY_MAPS = refuse(409, `You have ${MAX_MAPS_PER_ACCOUNT} maps, which is the most an account can have. Delete one first.`);
const TOO_MANY_PLACES = refuse(
  409,
  `An account's maps can hold ${MAX_PLACES_PER_ACCOUNT.toLocaleString('en-US')} places in all. Make this one smaller, or delete another.`,
);

const SLUG_NAME_LENGTH = 32;
const SLUG_SUFFIX_BYTES = 3;
const SLUG_ATTEMPTS = 5;
const SLUG_FALLBACK = 'map';

/**
 * What a new map is known by: its name in small letters and hyphens, then a
 * short random ending, so two maps of the same name get different slugs and a
 * slug cannot be guessed from a name. `ending` is only ever replaced by a test.
 */
export function slugFor(name: string, ending: () => string = () => randomBytes(SLUG_SUFFIX_BYTES).toString('hex')): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_NAME_LENGTH)
    .replace(/^-+|-+$/g, '');
  return `${words || SLUG_FALLBACK}-${ending()}`;
}

/** The map as it will be stored: its name and both descriptions with the listed words masked. */
const masked = (map: MapContent): MapContent => ({
  ...map,
  name: maskWords(map.name),
  description: maskWords(map.description),
  details: maskWords(map.details),
});

/** Stores a new map under a slug nobody has. */
async function createMap(tx: Queryable, userId: string, map: MapContent, now: number, ending?: () => string): Promise<Reply<string>> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = slugFor(map.name, ending);
    if (await insertMap(tx, slug, userId, map, now)) {
      return accept(slug);
    }
  }
  throw new Error('Could not find a free map slug');
}

/**
 * Why the account may not keep this map, or null when it may. A new map is
 * one more map; any map, new or saved over, has to fit in the places the
 * account's maps may hold in all, where the one being saved over counts at
 * its new size and not at the one it had.
 */
function refusalFor(own: Array<{ slug: string; places: number }>, slug: string | undefined, map: MapContent): Reply<never> | null {
  if (slug !== undefined && !own.some((mine) => mine.slug === slug)) {
    return NOT_YOUR_MAP;
  }
  if (slug === undefined && own.length >= MAX_MAPS_PER_ACCOUNT) {
    return TOO_MANY_MAPS;
  }
  const elsewhere = own.filter((mine) => mine.slug !== slug).reduce((places, mine) => places + mine.places, 0);
  return elsewhere + map.locations.length > MAX_PLACES_PER_ACCOUNT ? TOO_MANY_PLACES : null;
}

/** Stores the map, new or saved over, if the account may keep it, and answers with its slug. */
async function storeMap(tx: Queryable, userId: string, slug: string | undefined, map: MapContent, now: number, ending?: () => string): Promise<Reply<string>> {
  // Holding the account makes a player's saves take turns, so neither limit below can be passed by two at once.
  if (!(await lockPlayer(tx, userId))) {
    return refuse(401, 'Sign in first.');
  }
  const refusal = refusalFor(await mapSizesOf(tx, userId), slug, map);
  if (refusal) {
    return refusal;
  }
  if (slug === undefined) {
    return createMap(tx, userId, map, now, ending);
  }
  return (await updateMap(tx, slug, userId, map, now)) ? accept(slug) : NOT_YOUR_MAP;
}

/**
 * Publishes a new map, or saves over one the player made when `slug` names
 * it. Answers with the map as anyone would now be given it.
 */
export async function saveMap(
  db: Db,
  userId: string,
  input: MapContent & { slug?: string | undefined },
  now: number,
  ending?: () => string,
): Promise<Reply<MapDetail>> {
  const map = masked({ name: input.name, description: input.description, details: input.details, locations: input.locations });
  const stored = await db.transaction((tx) => storeMap(tx, userId, input.slug, map, now, ending));
  if (!stored.ok) {
    return stored;
  }
  const saved = await mapBySlug(db, stored.data, userId);
  return saved ? accept(saved) : NOT_YOUR_MAP;
}
