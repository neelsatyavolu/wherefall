import { z } from 'zod';
import { mapIdSchema } from '../game/locations.ts';
import { MODES } from '../game/settings.ts';
import { call, gameOutcomeFields, type Result } from './client.ts';

/** The player's history, a page at a time. Runs of the streak and the guessers are in `runs.ts`. */

const GAMES = '/api/games';

/** Games on one page of the history. */
export const GAMES_PER_PAGE = 20;

const gameSchema = z.object({
  /** for `getGame` */
  id: z.string(),
  /** ISO 8601 */
  playedAt: z.string(),
  map: mapIdSchema,
  mode: z.enum(MODES),
  rounds: z.number(),
  score: z.number(),
  maxScore: z.number(),
  ...gameOutcomeFields,
  xpEarned: z.number(),
});

const gamesPageSchema = z.object({ games: z.array(gameSchema), page: z.number(), more: z.boolean() });

export type HistoryGame = z.infer<typeof gameSchema>;
export type GamesPage = z.infer<typeof gamesPageSchema>;

type Reply<T> = Promise<Result<T>>;

/** One page of the signed-in player's games, newest first, every mode in one list. Pages count from 1. */
export function getGames(page: number, fetchFn: typeof fetch = fetch): Reply<GamesPage> {
  return call(fetchFn, `${GAMES}?page=${encodeURIComponent(String(page))}`, gamesPageSchema);
}
