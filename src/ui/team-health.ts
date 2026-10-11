import './team.css';
import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { START_HEALTH } from '../multiplayer/state.ts';
import { teamHealthRows } from '../multiplayer/team-view.ts';
import { el, formatScore } from './dom.ts';
import { teamName, teamNameFor } from './team-names.ts';

/**
 * Health in a 2v2: a bar and a number for each of the two teams, and what the last round cost the
 * team that lost it. Drawn like a duel's health, which it stands in the place of. Empty, and
 * hidden, in every match whose teams have no health.
 */
export function teamHealthStrip() {
  const node = el('aside', { class: 'health team-health', attrs: { 'aria-label': t('team.health') } });
  node.hidden = true;
  let drawn = '';
  return {
    node,
    /** `round` is the revealed round whose damage to show, or null between reveals. */
    update(state: MatchState, round: number | null): void {
      const rows = teamHealthRows(state, round);
      const key = JSON.stringify(rows);
      node.hidden = rows.length === 0;
      if (key === drawn) {
        return;
      }
      drawn = key;
      node.replaceChildren(
        ...rows.map((row) => {
          const fill = el('div', { class: 'bar-fill' });
          fill.style.width = `${row.share * 100}%`;
          const meter = { role: 'meter', 'aria-label': t('match.healthOf', { name: teamName(row.team) }), 'aria-valuemin': '0', 'aria-valuemax': String(START_HEALTH), 'aria-valuenow': String(row.health) };
          return el(
            'div',
            { class: row.isYours ? 'health-row own' : 'health-row' },
            el('span', { class: 'health-name', text: teamNameFor(row.team, row.isYours) }),
            el('span', { class: 'health-value', text: formatScore(row.health) }),
            el('span', { class: 'health-lost', text: row.lost > 0 ? `−${formatScore(row.lost)}` : '' }),
            el('div', { class: 'bar', attrs: meter }, fill),
          );
        }),
      );
    },
  };
}
