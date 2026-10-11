import { afterEach, describe, expect, it } from 'vitest';
import type { Account, AccountStats } from '../account/client.ts';
import { useLanguage } from '../i18n/index.ts';
import { duelFigures, statFigures, streakDetail, teamFigures } from './account-figures.ts';

const account = (change: Partial<Account> = {}): Account => ({
  username: 'neel',
  country: 'IN',
  rating: 1016,
  xp: 1200,
  level: 3,
  league: 'Voyager',
  bestStreak: 7,
  bestCountry: 9000,
  bestContinent: 10_000,
  loginStreak: 5,
  duels: { wins: 2, losses: 1, ties: 0, winRate: 66, rank: 12 },
  teams: { wins: 0, losses: 0, ties: 0, winRate: 0 },
  moderator: false,
  banned: false,
  allowFriendRequests: true,
  hideChat: false,
  hideLastSeen: false,
  hasRecoveryCode: true,
  ...change,
});

const stats: AccountStats = { gamesPlayed: 4, roundsPlayed: 20, averageRoundScore: 3100, bestRoundScore: 4990, perfectRounds: 0, bestGame: { score: 19_000, maxScore: 25_000 }, ratedGames: 3 };

afterEach(() => useLanguage('en'));

describe('statFigures', () => {
  it('gives a number of figures that fills its rows of four', () => {
    expect(statFigures(account(), stats)).toHaveLength(12);
  });

  it('shows the place on the rating board under the rating', () => {
    expect(statFigures(account(), stats)).toContainEqual(['Rating', '1,016', 'rank 12']);
  });

  it('shows the rating alone for a player who is not on the board', () => {
    expect(statFigures(account({ duels: { wins: 0, losses: 0, ties: 0, winRate: 0, rank: null } }), stats)).toContainEqual(['Rating', '1,016']);
  });

  it('shows the best score of each guesser out of its ten thousand', () => {
    const figures = statFigures(account(), stats);
    expect(figures).toContainEqual(['Country Guesser', '9,000', 'of 10,000']);
    expect(figures).toContainEqual(['Continent Guesser', '10,000', 'of 10,000']);
  });

  it('shows the best game out of its maximum, or a dash before the first game', () => {
    expect(statFigures(account(), stats)).toContainEqual(['Best game', '19,000', 'of 25,000']);
    expect(statFigures(account(), { ...stats, bestGame: null })).toContainEqual(['Best game', '–']);
  });

  it('names the league in the language in use', async () => {
    await useLanguage('de');
    expect(statFigures(account({ league: 'Nomad' }), stats)).toContainEqual(['Liga', 'Nomade']);
  });
});

describe('duelFigures', () => {
  it('gives wins, losses, ties and the win rate as a share', () => {
    expect(duelFigures(account().duels)).toEqual([
      ['Wins', '2'],
      ['Losses', '1'],
      ['Ties', '0'],
      ['Win rate', '66%'],
    ]);
  });

  it('writes the share as the language does', async () => {
    await useLanguage('fr');
    // French puts a no-break space before the sign; which one depends on the platform's locale data
    expect(duelFigures(account().duels).at(-1)).toEqual(['Taux de victoire', expect.stringMatching(/^66\s%$/u)]);
  });
});

describe('teamFigures', () => {
  it('gives the 2v2 matches in the form the duels have: wins, losses, ties and the win rate', () => {
    expect(teamFigures({ wins: 7, losses: 4, ties: 1, winRate: 58 })).toEqual([
      ['Wins', '7'],
      ['Losses', '4'],
      ['Ties', '1'],
      ['Win rate', '58%'],
    ]);
  });

  it('is all noughts for a player who has played none', () => {
    expect(teamFigures(account().teams)).toEqual([
      ['Wins', '0'],
      ['Losses', '0'],
      ['Ties', '0'],
      ['Win rate', '0%'],
    ]);
  });

  it('is written in the language in use', async () => {
    await useLanguage('de');
    expect(teamFigures({ wins: 1200, losses: 4, ties: 1, winRate: 58 }).slice(0, 2)).toEqual([
      ['Siege', '1.200'],
      ['Niederlagen', '4'],
    ]);
  });
});

describe('streakDetail', () => {
  it('counts days in a row in the plural the language has', async () => {
    expect(streakDetail(1)).toBe('day in a row');
    expect(streakDetail(5)).toBe('days in a row');
    await useLanguage('ru');
    expect(streakDetail(1)).toBe('день подряд');
    expect(streakDetail(3)).toBe('дня подряд');
    expect(streakDetail(5)).toBe('дней подряд');
  });
});
