import type { GamesPage, HistoryGame } from './games.ts';

/** The pages of the history read so far, as one list: what "Show more" adds to. */
export interface HistoryPages {
  /** newest first */
  readonly games: readonly HistoryGame[];
  /** the last page read; 0 before the first */
  readonly page: number;
  /** whether the server has older games still */
  readonly more: boolean;
}

export const NO_PAGES: HistoryPages = { games: [], page: 0, more: true };

/** The page to ask for next. */
export const nextPage = (pages: HistoryPages): number => pages.page + 1;

/**
 * The list with one more page read. A game finished since the last page was read pushes every
 * older one down a place, so the next page can begin with a game already shown: it is kept once.
 */
export function withPage(pages: HistoryPages, reply: GamesPage): HistoryPages {
  const shown = new Set(pages.games.map((game) => game.id));
  return { games: [...pages.games, ...reply.games.filter((game) => !shown.has(game.id))], page: reply.page, more: reply.more };
}
