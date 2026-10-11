/** Nobody's rating falls below this. */
export const MIN_RATING = 100;
/** What a new account starts at. The database default says the same. */
export const START_RATING = 500;

const SPREAD = 340;
/** One side of a duel: its rating, and how many rated games it had played before this one. */
export interface Rated {
  rating: number;
  games: number;
}

/** The share of points `a` is expected to take from `b`. */
export const expectedScore = (a: number, b: number): number => 1 / (1 + 10 ** ((b - a) / SPREAD));

/**
 * How fast a rating moves: quickly for a newcomer, slowly for a regular, and
 * never quickly near the top, where a few lucky games should not count for much.
 */
export function kFor({ rating, games }: Rated): number {
  const byGames = games < 30 ? 40 : games < 100 ? 20 : 10;
  const cap = rating >= 1000 ? 10 : rating >= 900 ? 20 : 40;
  return Math.min(byGames, cap);
}

/** A win over a player this far below, or further, is not owed the least change of 1. */
const HEAVY_FAVOURITE = 400;

/**
 * How much of its usual change the winner's nth win over the same opponent
 * on one day is worth: the first three in full, then less, and nothing from
 * the seventh.
 */
export function repeatFactor(nthWin: number): number {
  return [1, 1, 1, 0.75, 0.5, 0.25][nthWin - 1] ?? 0;
}

/**
 * What one result moves one player by, at `factor` of its usual size. A win
 * or a loss moves at least 1, unless it is worth nothing at all, or the
 * winner was rated so far above the loser that the result says nothing: then
 * what the sum rounds to stands, which may be 0. A draw between equals moves
 * nothing.
 */
function change(own: Rated, opponent: Rated, score: 0 | 0.5 | 1, factor: number): number {
  const moved = Math.round(kFor(own) * (score - expectedScore(own.rating, opponent.rating)) * factor);
  const [winner, loser] = score === 1 ? [own, opponent] : [opponent, own];
  if (score === 0.5 || factor === 0 || winner.rating - loser.rating >= HEAVY_FAVOURITE) {
    return moved;
  }
  return score === 1 ? Math.max(1, moved) : Math.min(-1, moved);
}

/**
 * Both ratings after one duel. `score` is the first player's result: 1 for a
 * win, 0.5 for a draw, 0 for a loss. Each moves by their own K. `nthWin` is
 * which win over this opponent today the winner's is (1 for the first): it
 * trims the winner's gain and the loser's loss alike. A draw is not trimmed.
 */
export function rate(a: Rated, b: Rated, score: 0 | 0.5 | 1, nthWin = 1): [number, number] {
  const other = (1 - score) as 0 | 0.5 | 1;
  const factor = score === 0.5 ? 1 : repeatFactor(nthWin);
  return [Math.max(MIN_RATING, a.rating + change(a, b, score, factor)), Math.max(MIN_RATING, b.rating + change(b, a, other, factor))];
}
