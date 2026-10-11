import './versus.css';
import { t } from '../i18n/index.ts';
import type { VersusCard } from '../multiplayer/match-view.ts';
import { el, formatScore } from './dom.ts';
import { plainName } from './guest-parts.ts';
import { leagueName } from './league.ts';
import { statusLine } from './match-status.ts';

/**
 * The screen before a ranked duel's first round: both players by name and flag, each with their
 * rating and league, and "versus" between them. It has no clock of its own: whoever owns it shows
 * it while the server's get-ready runs, hands it the line that counts the get-ready down (which
 * the box would otherwise cover), and takes it away when the round starts. It never takes a click,
 * so nothing under it is blocked.
 */
export function versusIntro() {
  const node = el('aside', { class: 'versus' });
  node.hidden = true;
  // not a live region: a number that changes every second would be read out every second
  const count = statusLine('live', true);
  count.node.classList.add('versus-count');
  let drawn = '';

  const card = (player: VersusCard) =>
    el(
      'div',
      { class: player.isYou ? 'versus-card own' : 'versus-card' },
      plainName(player.username, player.country, 'versus-name'),
      player.rating === null ? null : el('span', { class: 'versus-rating', text: formatScore(player.rating) }),
      player.league === null ? null : el('span', { class: 'versus-league', text: leagueName(player.league) }),
    );

  return {
    node,
    /** The players to show, with the line that says when the round starts under them, or null to take the screen away. */
    show(cards: readonly VersusCard[] | null, starts = ''): void {
      node.hidden = cards === null;
      count.set(starts);
      const key = JSON.stringify(cards);
      if (cards === null || key === drawn) {
        return;
      }
      drawn = key;
      const [first, second] = cards;
      node.setAttribute('aria-label', t('versus.label', { first: first?.username ?? '', second: second?.username ?? '' }));
      // "versus" stands between each player and the next
      const players = cards.flatMap((player, index) => (index === 0 ? [card(player)] : [el('span', { class: 'versus-word', text: t('versus.word') }), card(player)]));
      node.replaceChildren(el('div', { class: 'versus-box' }, ...players, count.node));
    },
  };
}
