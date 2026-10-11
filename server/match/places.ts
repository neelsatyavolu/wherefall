import { communitySlugOf } from '../account/input.js';
import type { Queryable } from '../db/client.js';
import { locationsOf } from '../db/maps.js';
import { checkPlaces, type SentPlace } from '../places/check.js';
import { continentsOf } from '../places/continents.js';
import type { Place } from './input.js';
import { accept, refuse, type MatchRecord, type Reply } from './types.js';

/** What a match is played on: its places, as the server knows them, and the scale they are scored on. */
export interface Ground {
  places: Place[];
  scaleKm: number;
}

/** A game on the world map made by a queue, of this many rounds or more, is spread over this many continents. */
export const SPREAD_FROM_ROUNDS = 3;
export const SPREAD_CONTINENTS = 3;

const NOT_ON_MAP = refuse(400, "Those places are not on this match's map.");
const NOT_SPREAD = refuse(400, 'A world game needs places on at least three continents.');

/**
 * The places a resolver's browser posted, as the match will be played on
 * them. The browser's word is taken for which places it drew and nothing
 * more: each must be a place of the match's map, where the server has it,
 * and the scale is the server's. A game made by a queue is always on the
 * world map and has to send its players around it; a party is its host's
 * business.
 */
export async function groundFor(tx: Queryable, match: MatchRecord, sent: readonly SentPlace[]): Promise<Reply<Ground>> {
  const slug = communitySlugOf(match.settings.map);
  const checked = checkPlaces(match.settings.map, sent, slug === null ? null : await locationsOf(tx, slug));
  if (!checked) {
    return NOT_ON_MAP;
  }
  const mustSpread = match.kind !== 'party' && match.settings.rounds >= SPREAD_FROM_ROUNDS;
  if (mustSpread && continentsOf(checked.places) < SPREAD_CONTINENTS) {
    return NOT_SPREAD;
  }
  return accept({ places: checked.places, scaleKm: checked.scaleKm });
}
