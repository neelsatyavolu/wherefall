import type { Account, AccountStats, Duels, Teams } from '../account/client.ts';
import { formatNumber, language, t, tn } from '../i18n/index.ts';
import { leagueName } from './league.ts';
import type { Stat } from './stat-grid.ts';

/** The figures of the account pane, as words: the stats, the duel record, the login streak. */

const NONE = '–';
/** the most a Country Guesser or Continent Guesser game can score */
const GUESSER_MAX = 10_000;

const outOf = (max: number) => t('account.ofMax', { max: formatNumber(max) });

/** A whole percent as the language writes a share: 66%, 66 %. */
const percent = (share: number): string => new Intl.NumberFormat(language(), { style: 'percent' }).format(share / 100);

/** The player's figures, twelve of them: three rows of four on a wide screen, six of two on a phone. */
export function statFigures(account: Account, stats: AccountStats): Stat[] {
  const best = stats.bestGame;
  const rank = account.duels.rank;
  return [
    [t('label.league'), leagueName(account.league)],
    rank === null ? [t('label.rating'), formatNumber(account.rating)] : [t('label.rating'), formatNumber(account.rating), t('account.rank', { rank: formatNumber(rank) })],
    [t('label.rankedDuels'), formatNumber(stats.ratedGames)],
    [t('label.bestStreak'), formatNumber(account.bestStreak)],
    [t('label.games'), formatNumber(stats.gamesPlayed)],
    [t('label.rounds'), formatNumber(stats.roundsPlayed)],
    [t('account.averageRound'), formatNumber(stats.averageRoundScore)],
    [t('account.bestRound'), formatNumber(stats.bestRoundScore)],
    [t('account.perfectRounds'), formatNumber(stats.perfectRounds)],
    best ? [t('account.bestGame'), formatNumber(best.score), outOf(best.maxScore)] : [t('account.bestGame'), NONE],
    [t('nav.item.country'), formatNumber(account.bestCountry), outOf(GUESSER_MAX)],
    [t('nav.item.continent'), formatNumber(account.bestContinent), outOf(GUESSER_MAX)],
  ];
}

/** A record of matches: won, lost, tied, and the share won. The duels and the 2v2 matches are both written so. */
function recordFigures(record: Teams): Stat[] {
  return [
    [t('account.duels.wins'), formatNumber(record.wins)],
    [t('account.duels.losses'), formatNumber(record.losses)],
    [t('account.duels.ties'), formatNumber(record.ties)],
    [t('account.duels.winRate'), percent(record.winRate)],
  ];
}

/** The ranked duels as a record: won, lost, tied, and the share won. */
export const duelFigures = (duels: Duels): Stat[] => recordFigures(duels);

/** The 2v2 matches as a record, in the form the duels have. */
export const teamFigures = (teams: Teams): Stat[] => recordFigures(teams);

/** What follows the login streak's number: "days in a row". */
export const streakDetail = (days: number): string => tn('account.daysInARow', days);
