import './team.css';
import { t } from '../i18n/index.ts';
import type { MatchPlayer, MatchState, Team } from '../multiplayer/client.ts';
import type { Seating } from '../multiplayer/party-view.ts';
import { el } from './dom.ts';
import { requestButton, type Report } from './host-controls.ts';
import { teamName } from './team-names.ts';

/** Picking a team in the lobby of a party with teams: the two teams side by side, each with a way in, and who has none yet. */

type Rows = (players: readonly MatchPlayer[]) => HTMLElement[];

function teamBox(state: MatchState, team: Team, members: readonly MatchPlayer[], rows: Rows, onTeam: (team: Team) => Promise<string | null>, report: Report): HTMLElement {
  const name = teamName(team);
  const yours = state.you.team === team;
  // a seat can be changed for as long as the party is in its lobby
  const join = yours ? null : requestButton('button ghost', t('party.team.join'), t('party.team.joinLabel', { team: name }), () => onTeam(team), report);
  return el(
    'section',
    { class: yours ? 'team-box own' : 'team-box', attrs: { 'aria-label': name } },
    el('div', { class: 'team-head' }, el('h3', { class: 'label', text: name }), yours ? el('span', { class: 'tag', text: t('team.yours') }) : null, join),
    members.length === 0 ? el('p', { class: 'fine', text: t('party.team.empty') }) : el('ul', { class: 'player-list' }, ...rows(members)),
  );
}

/**
 * The two teams and, under them, the players who have none. `rows` draws the players, so a team's
 * rows are the lobby's own, host actions included.
 */
export function teamBoxes(state: MatchState, seats: Seating, rows: Rows, onTeam: (team: Team) => Promise<string | null>, report: Report): HTMLElement {
  const unseated =
    seats.unseated.length === 0
      ? null
      : el('section', { class: 'team-box unseated', attrs: { 'aria-label': t('party.team.unseated') } }, el('h3', { class: 'label', text: t('party.team.unseated') }), el('ul', { class: 'player-list' }, ...rows(seats.unseated)));
  return el(
    'div',
    { class: 'team-picker' },
    el('div', { class: 'team-columns' }, ...([0, 1] as const).map((team) => teamBox(state, team, seats.teams[team], rows, onTeam, report))),
    unseated,
    el('p', { class: 'fine', text: t('party.team.hint') }),
  );
}
