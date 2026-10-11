import './social.css';
import { language, t, tn } from '../i18n/index.ts';
import { friendAction, type FriendStanding, type Profile } from '../social/client.ts';
import { friendOffer, standingAfter } from '../social/friend-offer.ts';
import { teamFigures } from './account-figures.ts';
import { el, formatScore } from './dom.ts';
import { leagueName } from './league.ts';
import { navName } from './nav.ts';
import { errorLine, factLine } from './pane.ts';
import { presenceLine } from './presence-line.ts';
import { sayRefusal } from './session-ended.ts';
import { statGrid } from './stat-grid.ts';

/** The pieces of a public profile that are about the player rather than their games. */

/** The month a player joined, written for the language in use: "March 2025". */
const joinedMonth = (joinedAt: string) => new Intl.DateTimeFormat(language(), { month: 'long', year: 'numeric' }).format(new Date(joinedAt));

/** A whole percent as the language writes one: "60%", "60 %". */
const percent = (whole: number) => new Intl.NumberFormat(language(), { style: 'percent' }).format(whole / 100);

/**
 * What a profile offers about friendship, following how the viewer stands to the player: a button
 * that asks or accepts, a line saying a request is out or that they are friends, or nothing at
 * all. A refusal, such as from a player who takes no requests, is shown in the server's words.
 */
export function friendControl(username: string, standing: FriendStanding): HTMLElement {
  const host = el('div', { class: 'friend-offer' });
  const error = errorLine();

  function draw(now: FriendStanding): void {
    const offer = friendOffer(now);
    if (!offer) {
      host.replaceChildren();
    } else if (offer.kind === 'note') {
      host.replaceChildren(el('p', { class: 'settings-line', text: t(`profile.friend.${offer.standing}`), attrs: { role: 'status' } }));
    } else {
      const { action } = offer;
      const button = el('button', { class: 'button primary', text: t(`profile.friend.${action}`), attrs: { type: 'button' } });
      button.addEventListener('click', async () => {
        button.disabled = true;
        error.textContent = '';
        const result = await friendAction(action, username);
        if (result.ok) {
          draw(standingAfter(action));
        } else {
          button.disabled = false;
          sayRefusal(error, result.error);
        }
      });
      host.replaceChildren(button, error);
    }
  }

  draw(standing);
  return host;
}

/** Under the name: online or last seen, since when they have played, how often the profile was opened, and the friend button. */
export function profileWho(profile: Profile): HTMLElement {
  return el(
    'div',
    { class: 'profile-who' },
    presenceLine(profile),
    el('div', { class: 'profile-facts' }, factLine(t('profile.since', { date: joinedMonth(profile.joinedAt) })), factLine(tn('profile.views', profile.views))),
    friendControl(profile.username, profile.friend),
  );
}

/** The player's figures: league and rating, what they have played and their bests, then their record in ranked duels. */
export function profileStats(profile: Profile): HTMLElement {
  const { duels } = profile;
  return statGrid(
    t('profile.stats', { name: profile.username }),
    [
      [t('label.league'), leagueName(profile.league)],
      [t('label.rating'), formatScore(profile.rating)],
      [t('label.games'), formatScore(profile.gamesPlayed)],
      [t('label.bestStreak'), formatScore(profile.bestStreak)],
      [navName('country'), formatScore(profile.bestCountry)],
      [navName('continent'), formatScore(profile.bestContinent)],
      [t('label.rankedDuels'), formatScore(profile.ratedGames)],
      [t('profile.duelsWon'), formatScore(duels.wins)],
      [t('profile.duelsLost'), formatScore(duels.losses)],
      [t('profile.duelsTied'), formatScore(duels.ties)],
      [t('profile.winRate'), percent(duels.winRate)],
      // the place on the all-time rating board; a player who is not on it has none
      [t('chart.ratingRank'), duels.rank === null ? '—' : formatScore(duels.rank)],
    ],
    6,
  );
}

/** The player's 2v2 matches, under their figures: won, lost, tied and the share won, as the account pane has them. */
export function profileTeams(profile: Profile): HTMLElement {
  return statGrid(t('profile.teams', { name: profile.username }), teamFigures(profile.teams), 4);
}
