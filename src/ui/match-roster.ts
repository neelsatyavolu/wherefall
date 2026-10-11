import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { guessStatus } from '../multiplayer/state.ts';
import { el } from './dom.ts';
import { plainName } from './guest-parts.ts';
import { countriesOf, softBreaks } from './match-panels.ts';
import { onPhone, statusParts } from './match-status.ts';

/** A player's flag and name, the name with places to break it where the rail is too narrow for it. */
function rosterName(text: string, country: string | null | undefined): HTMLElement {
  const name = plainName('', country, 'roster-name');
  name.append(el('span', {}, ...softBreaks(text)));
  return name;
}

/**
 * Who has guessed this round and who has not, once the player's own guess is in. One line says how
 * many have ("3 / 8 guessed") and opens the list of names: open from the start on a wide screen,
 * where the rail has room for it, and folded to that one line on a phone, where the list would
 * stand on the view for the rest of the round.
 */
export function rosterList() {
  const list = el('ul', { class: 'roster-list' });
  const count = el('span', { class: 'status-inline roster-count' });
  list.hidden = onPhone();
  const toggle = el('button', { class: 'roster-toggle status-note', attrs: { type: 'button', 'data-state': 'live', 'aria-expanded': String(!list.hidden) } }, ...statusParts(count));
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });
  const node = el('aside', { class: 'roster', attrs: { 'aria-label': t('match.roster.label') } }, toggle, list);
  node.hidden = true;
  let drawn = '';
  return {
    node,
    /** Draws everyone in the match as it stands. Null hides the list. */
    show(state: MatchState | null): void {
      node.hidden = state === null;
      if (state === null) {
        return;
      }
      const statuses = guessStatus(state);
      const countries = countriesOf(state);
      const key = JSON.stringify([statuses, [...countries]]);
      if (key === drawn) {
        return;
      }
      drawn = key;
      const guessed = statuses.filter((player) => player.status === 'guessed').length;
      // a player who has left without guessing is not waited for
      const players = statuses.filter((player) => player.status !== 'away').length;
      count.textContent = t('match.roster.count', { guessed, players });
      // blue while the round waits on someone, green once every guess is in
      toggle.dataset.state = guessed < players ? 'live' : 'ok';
      list.replaceChildren(
        ...statuses.map((player) =>
          el(
            'li',
            { class: `roster-row ${player.status}` },
            el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }),
            rosterName(player.isYou ? t('match.nameYou', { name: player.username }) : player.username, countries.get(player.username)),
            el('span', { class: 'roster-status', text: t(`match.status.${player.status}`) }),
          ),
        ),
      );
    },
  };
}
