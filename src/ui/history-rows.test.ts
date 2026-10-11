import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryGame } from '../account/games.ts';
import { useLanguage } from '../i18n/index.ts';
import { historyRow, kindName, matchFacts, ratingChangeText, resultName } from './history-rows.ts';

const game = (change: Partial<HistoryGame> = {}): HistoryGame => ({
  id: 'g1',
  kind: 'solo',
  playedAt: '2026-10-10T12:00:00.000Z',
  map: 'world',
  mode: 'move',
  rounds: 5,
  score: 19_000,
  maxScore: 25_000,
  result: null,
  ratingChange: null,
  xpEarned: 380,
  players: 1,
  ...change,
});

afterEach(() => useLanguage('en'));

describe('kindName', () => {
  it.each([
    ['solo', 'Solo'],
    ['daily', 'Daily'],
    ['party', 'Party'],
    ['unranked', 'Unranked'],
    ['ranked', 'Ranked'],
    ['team', '2v2'],
  ] as const)('names a %s game %s', (kind, name) => {
    expect(kindName(kind)).toBe(name);
  });

  it('names a kind in the language in use', async () => {
    await useLanguage('de');
    expect(kindName('unranked')).toBe('Ohne Wertung');
    await useLanguage('ru');
    expect(kindName('party')).toBe('Комната');
  });
});

describe('resultName', () => {
  it.each([
    ['win', 'win'],
    ['loss', 'loss'],
    ['draw', 'draw'],
  ] as const)('says a %s as %s', (result, name) => {
    expect(resultName(result)).toBe(name);
  });

  it('says nothing for a game with no result', () => {
    expect(resultName(null)).toBe('');
  });
});

describe('ratingChangeText', () => {
  it('writes a gain with its plus and a loss with its minus', () => {
    expect(ratingChangeText(18)).toBe('+18');
    expect(ratingChangeText(-12)).toBe('-12');
  });

  it('writes no change as a plain nought, and nothing where rating is not at stake', () => {
    expect(ratingChangeText(0)).toBe('0');
    expect(ratingChangeText(null)).toBe('');
  });
});

describe('historyRow', () => {
  it('words a solo game: no result, no rating, one player', () => {
    expect(historyRow(game())).toEqual({ kind: 'Solo', map: 'World', score: '19,000', maxScore: '25,000', result: '', rating: '', xp: '380', players: '1' });
  });

  it('words a won ranked duel with its rating change', () => {
    expect(historyRow(game({ kind: 'ranked', score: 12_400, result: 'win', ratingChange: 18, xpEarned: 496, players: 2 }))).toEqual({
      kind: 'Ranked',
      map: 'World',
      score: '12,400',
      maxScore: '25,000',
      result: 'win',
      rating: '+18',
      xp: '496',
      players: '2',
    });
  });

  it('words a lost ranked duel', () => {
    expect(historyRow(game({ kind: 'ranked', result: 'loss', ratingChange: -17, players: 2 }))).toMatchObject({ result: 'loss', rating: '-17' });
  });

  it('words a lost 2v2 and a drawn unranked match, which move no rating', () => {
    expect(historyRow(game({ kind: 'team', result: 'loss', players: 4 }))).toMatchObject({ kind: '2v2', result: 'loss', rating: '', players: '4' });
    expect(historyRow(game({ kind: 'unranked', result: 'draw', players: 7 }))).toMatchObject({ kind: 'Unranked', result: 'draw', rating: '', players: '7' });
  });

  it('words a party on a community map that earned no XP', () => {
    expect(historyRow(game({ kind: 'party', map: 'community:paris-walk-x7k2', maxScore: 60_000, result: 'win', xpEarned: 0, players: 14 }))).toMatchObject({
      kind: 'Party',
      map: 'Community map',
      maxScore: '60,000',
      result: 'win',
      xp: '0',
      players: '14',
    });
  });

  it('words a daily, and a cancelled match, with no result', () => {
    expect(historyRow(game({ kind: 'daily', rounds: 3, score: 11_250, maxScore: 15_000 }))).toMatchObject({ kind: 'Daily', score: '11,250', maxScore: '15,000', result: '' });
    expect(historyRow(game({ kind: 'ranked', result: null, ratingChange: null, players: 2 }))).toMatchObject({ kind: 'Ranked', result: '', rating: '' });
  });

  it('writes numbers as the language does', async () => {
    await useLanguage('de');
    expect(historyRow(game({ kind: 'ranked', result: 'win', ratingChange: 18 }))).toMatchObject({ kind: 'Mit Wertung', score: '19.000', result: 'Sieg', rating: '+18' });
  });
});

describe('matchFacts', () => {
  it('says nothing more about a game played alone', () => {
    expect(matchFacts({ kind: 'solo', result: null, ratingChange: null, players: 1 })).toBeNull();
    expect(matchFacts({ kind: 'daily', result: null, ratingChange: null, players: 1 })).toBeNull();
  });

  it('gives the kind, result, rating change and players of a ranked duel', () => {
    expect(matchFacts({ kind: 'ranked', result: 'win', ratingChange: 18, players: 2 })).toBe('Ranked · win · rating +18 · 2 players');
  });

  it('leaves out what a match does not have', () => {
    expect(matchFacts({ kind: 'party', result: 'draw', ratingChange: null, players: 14 })).toBe('Party · draw · 14 players');
    expect(matchFacts({ kind: 'unranked', result: null, ratingChange: null, players: 1 })).toBe('Unranked · 1 player');
  });
});
