import { describe, expect, it } from 'vitest';
import type { GamesPage, HistoryGame } from './games.ts';
import { NO_PAGES, nextPage, withPage } from './history-pages.ts';

const game = (id: string): HistoryGame => ({ id, kind: 'solo', playedAt: '2026-10-10T12:00:00.000Z', map: 'world', mode: 'move', rounds: 5, score: 19_000, maxScore: 25_000, result: null, ratingChange: null, xpEarned: 380, players: 1 });
const reply = (page: number, ids: string[], more: boolean): GamesPage => ({ games: ids.map(game), page, more });
const ids = (games: readonly HistoryGame[]) => games.map((each) => each.id);

describe('the pages of the history', () => {
  it('starts with nothing, asking for the first page', () => {
    expect(NO_PAGES.games).toEqual([]);
    expect(nextPage(NO_PAGES)).toBe(1);
  });

  it('takes the first page and asks for the second next', () => {
    const pages = withPage(NO_PAGES, reply(1, ['a', 'b'], true));
    expect(ids(pages.games)).toEqual(['a', 'b']);
    expect(pages.more).toBe(true);
    expect(nextPage(pages)).toBe(2);
  });

  it('adds a later page after the games it has', () => {
    const pages = withPage(withPage(NO_PAGES, reply(1, ['a', 'b'], true)), reply(2, ['c'], false));
    expect(ids(pages.games)).toEqual(['a', 'b', 'c']);
    expect(pages.more).toBe(false);
    expect(nextPage(pages)).toBe(3);
  });

  it('shows a game once when a new game has pushed it onto the next page', () => {
    const pages = withPage(withPage(NO_PAGES, reply(1, ['a', 'b'], true)), reply(2, ['b', 'c'], false));
    expect(ids(pages.games)).toEqual(['a', 'b', 'c']);
  });

  it('holds an empty history', () => {
    const pages = withPage(NO_PAGES, reply(1, [], false));
    expect(pages).toEqual({ games: [], page: 1, more: false });
  });

  it('leaves the pages it was given as they were', () => {
    const first = withPage(NO_PAGES, reply(1, ['a'], true));
    withPage(first, reply(2, ['b'], false));
    expect(ids(first.games)).toEqual(['a']);
    expect(NO_PAGES).toEqual({ games: [], page: 0, more: true });
  });
});
