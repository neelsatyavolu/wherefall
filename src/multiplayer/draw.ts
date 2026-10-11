import { SPREAD_MIN_ROUNDS } from '../game/spread.ts';
import { placesRefused, type MatchState } from './client.ts';

/** Pure reading of what the client that picks a match's places has to draw, and what it does when the server will not take them. */

/** How many fresh sets the resolver draws by itself after a refusal before it asks the player what to do. */
export const FREE_REDRAWS = 1;

/**
 * Whether a match's places must be on at least three continents: a public game, a ranked duel or a
 * 2v2, which are always on the world map, with three rounds or more. A party is never held to it.
 */
export const needsSpread = (match: Pick<MatchState, 'kind' | 'settings'>): boolean =>
  match.kind !== 'party' && match.settings.map === 'world' && match.settings.rounds >= SPREAD_MIN_ROUNDS;

/**
 * The seed a match's places are drawn with: its own, and another for each set the server has
 * refused. Drawing from the same seed again would give the very places that were refused.
 */
export const drawSeed = (seed: string, refused: number): string => (refused === 0 ? seed : `${seed}~${refused}`);

/**
 * What follows a `places` post that failed, when `refused` sets were refused before it: a fresh
 * draw made at once, a question to the player (the fresh set was refused too), or the same places
 * sent again, for a failure that was not about them (no connection, too many requests).
 */
export function afterFailedPost(error: string, refused: number): 'redraw' | 'ask' | 'resend' {
  if (!placesRefused(error)) {
    return 'resend';
  }
  return refused < FREE_REDRAWS ? 'redraw' : 'ask';
}
