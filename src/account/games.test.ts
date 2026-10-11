import { describe, expect, it } from 'vitest';
import { getGames, type GamesPage } from './games.ts';
import { UNEXPECTED, failure, fakeFetch, success } from './testing.ts';

const solo = { id: 'g1', kind: 'solo', playedAt: '2026-10-11T10:00:00.000Z', map: 'world', mode: 'move', rounds: 5, score: 19_000, maxScore: 25_000, result: null, ratingChange: null, xpEarned: 380, players: 1 };
const duel = { ...solo, id: 'm7', kind: 'ranked', score: 12_400, result: 'win', ratingChange: 18, xpEarned: 496, players: 2 };
const party = { ...solo, id: 'm8', kind: 'party', map: 'community:paris-walk-x7k2', mode: 'nmpz', rounds: 12, maxScore: 60_000, result: 'draw', xpEarned: 0, players: 14 };

const page = { games: [duel, party, solo], page: 1, more: true } as GamesPage;

describe('getGames', () => {
  it('asks for a page of the history and reads every kind of game in it', async () => {
    const { fetchFn, calls } = fakeFetch(success(page));
    expect(await getGames(1, fetchFn)).toEqual({ ok: true, data: page });
    expect(calls[0]?.url).toBe('/api/games?page=1');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('asks for a later page', async () => {
    const { fetchFn, calls } = fakeFetch(success({ games: [], page: 3, more: false }));
    expect(await getGames(3, fetchFn)).toEqual({ ok: true, data: { games: [], page: 3, more: false } });
    expect(calls[0]?.url).toBe('/api/games?page=3');
  });

  it.each([
    ['a game is of a kind that is not one', { ...page, games: [{ ...solo, kind: 'coop' }] }],
    ['a game has a result that is not one', { ...page, games: [{ ...duel, result: 'won' }] }],
    ['a game has no XP', { ...page, games: [{ ...solo, xpEarned: undefined }] }],
    ['a game does not say how many played', { ...page, games: [{ ...solo, players: undefined }] }],
    ['a game is on a map that is not one', { ...page, games: [{ ...solo, map: 'mars' }] }],
    ['it does not say whether there is more', { games: [], page: 1 }],
  ])('refuses a page where %s', async (_name, data) => {
    expect(await getGames(1, fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it.each([
    ['Ask for your games by page.', 400],
    ['Sign in first.', 401],
    ['Guests cannot do that. Make an account first.', 403],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await getGames(0, fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });
});
