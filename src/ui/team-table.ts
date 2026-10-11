import './team.css';
import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { teamHealthRows, teamRows } from '../multiplayer/team-view.ts';
import { el, formatScore } from './dom.ts';
import { teamName, teamNameFor } from './team-names.ts';

/** The two teams in a match's results: a table over a revealed round, and two figures over the final standing. */

const head = (...cells: Array<[string, boolean]>) => el('thead', {}, el('tr', {}, ...cells.map(([text, numeric]) => el('th', numeric ? { class: 'num', text } : { text }))));

/**
 * What each team made of one revealed round, and its points so far. The round's column is headed
 * by how the match scores a team: its best guess, or the average of its guesses. Null in a match
 * without teams.
 */
export function teamLines(state: MatchState, round: number): HTMLElement | null {
  const rows = teamRows(state, round);
  if (rows.length === 0) {
    return null;
  }
  const scoredBy = t(state.settings.teams === 'average' ? 'party.teams.average' : 'party.teams.best');
  return el(
    'table',
    { class: 'rounds team-table', attrs: { 'aria-label': t('team.tableLabel') } },
    head([t('team.heading'), false], [scoredBy, true], [t('match.total'), true]),
    el(
      'tbody',
      {},
      ...rows.map((row) =>
        el(
          'tr',
          row.isYours ? { class: 'own' } : {},
          el('td', { class: 'player-name' }, teamName(row.team), row.isYours ? el('span', { class: 'tag', text: t('team.yours') }) : null),
          el('td', { class: 'num', text: formatScore(row.round ?? 0) }),
          el('td', { class: 'num', text: formatScore(row.total) }),
        ),
      ),
    ),
  );
}

/**
 * Where the two teams ended: each one's points, the health it has left in a 2v2, and which of
 * them won. Null in a match without teams.
 */
export function teamStanding(state: MatchState): HTMLElement | null {
  const rows = teamRows(state, null);
  if (rows.length === 0) {
    return null;
  }
  const health = new Map(teamHealthRows(state, null).map((row) => [row.team, row.health]));
  return el(
    'div',
    { class: 'figures team-figures' },
    ...rows.map((row) => {
      const left = health.get(row.team);
      return el(
        'div',
        { class: 'figure' },
        // the name, and beside it that the team won; then its points, and under them the health it has left
        el('span', { class: 'label' }, teamNameFor(row.team, row.isYours), row.won ? el('span', { class: 'tag', text: t('tag.won') }) : null),
        el('span', { class: 'figure-value', text: formatScore(row.total) }),
        left === undefined ? null : el('span', { class: 'figure-detail', text: t('team.healthLeft', { health: formatScore(left) }) }),
      );
    }),
  );
}
