import { formatNumber, t } from '../i18n/index.ts';
import type { MatchState, QueueKind } from '../multiplayer/client.ts';
import { afterMatch, xpEarned } from '../multiplayer/match-view.ts';
import { isCoop, outcomeLine, standing, type StandingRow } from '../multiplayer/state.ts';
import { el, formatScore } from './dom.ts';
import { icon } from './map-tools.ts';
import { ownRowStrip } from './match-own-row.ts';
import { countriesOf, nameCell, tableHead, teamNumber, youTag, type HeadCell } from './match-panels.ts';
import { statusLine, statusNote } from './match-status.ts';
import { panelActions } from './panels.ts';
import { isGuestName } from './profile-link.ts';
import { teamStanding } from './team-table.ts';

/** Where a match stands: the final table with what comes after it, and the table a late joiner waits on. */

/** What became of a report: the player thought better of it, it was sent, or the server would not take it. */
export type ReportResult = 'cancelled' | 'sent' | { error: string };
type OnReport = (username: string) => Promise<ReportResult>;

export interface FinalHandlers {
  onHome: () => void;
  onReport: OnReport;
  /** joins the queue for the same kind of match again */
  onAgain: (kind: QueueKind) => void;
  /** the host takes the party back to its lobby; resolves to an error to show, or null */
  onLobby: () => Promise<string | null>;
}

/** a flag on its pole: reporting a player */
const REPORT_ICON = ['M5 21V4', 'M5 4h13l-3 4.5 3 4.5H5'];

/** How far a rating moved, always with its sign: the colour it is drawn in is not the only thing that says which way. */
const signed = (change: number) => (change > 0 ? `+${formatNumber(change)}` : change < 0 ? `−${formatNumber(-change)}` : '0');

/** A rating after the match and, in a cell of its own, how far it moved: green and "+" for up, red and "−" for down. */
function ratingCells(rating: StandingRow['rating']): HTMLElement[] {
  if (!rating) {
    return [el('td', { class: 'num' }), el('td', { class: 'num delta' })];
  }
  const change = rating.after - rating.before;
  const direction = change > 0 ? ' up' : change < 0 ? ' down' : '';
  return [el('td', { class: 'num', text: formatNumber(rating.after) }), el('td', { class: `num delta${direction}`, text: signed(change) })];
}

/** Where a report from the standing says what became of it. */
type Say = ReturnType<typeof statusLine>;

/**
 * Reporting another player, at the end of their row: a small button with a flag on it, named for a
 * screen reader and on hover. It asks first (`onReport` does), and stays off once the report is in.
 */
function reportCell(username: string, onReport: OnReport, say: Say): HTMLElement {
  const label = t('common.reportPlayer', { name: username });
  const button = el('button', { class: 'button ghost report-button', attrs: { type: 'button', 'aria-label': label, title: label } });
  button.append(icon(REPORT_ICON));
  button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await onReport(username);
    if (result === 'sent') {
      say.set(t('match.reportSent', { name: username }), 'ok');
      return;
    }
    button.disabled = false;
    if (result !== 'cancelled') {
      say.set(result.error, 'error');
    }
  });
  return el('td', { class: 'row-end' }, button);
}

/**
 * Every player, best first. A duel's health is not a column: its bars stay at the top of the
 * screen. `report` adds a last column with a button for each player who can be reported: nobody
 * can report themselves, and a guest has no account to report. Co-op has nobody ahead of anybody:
 * its table is who played, with no places and no points of their own.
 */
function standingRows(state: MatchState, report?: { onReport: OnReport; say: Say }): HTMLElement {
  const rows = standing(state);
  const countries = countriesOf(state);
  // 2v2, and a party whose host has turned teams on
  const teams = state.teams !== null;
  const rated = rows.some((row) => row.rating !== null);
  const reportable = (row: StandingRow) => report !== undefined && !row.isYou && !isGuestName(row.username);
  const reports = rows.some(reportable);
  const ranked = !isCoop(state);
  const cells: HeadCell[] = [
    ...(ranked ? [['#', true] as HeadCell] : []),
    [t('label.player'), false],
    ...(teams ? [[t('team.heading'), false] as HeadCell] : []),
    ...(ranked ? [[t('match.total'), true, 'col-total'] as HeadCell] : []),
    ...(rated ? [[t('label.rating'), true, 'col-rating'] as HeadCell] : []),
    ...(reports ? [['', false, 'row-end'] as HeadCell] : []),
  ];
  const head = tableHead(...cells);
  // the rating and how far it moved are two cells under the one heading
  head.querySelectorAll<HTMLTableCellElement>('.col-rating').forEach((cell) => cell.setAttribute('colspan', '2'));
  return el(
    'table',
    // a duel's table has the rating and its change to show: a phone leaves the points out of it (`.col-total`), for the names' sake
    { class: rated ? 'rounds rated' : 'rounds', attrs: { 'aria-label': t('match.players') } },
    head,
    el(
      'tbody',
      {},
      ...rows.map((row, index) =>
        el(
          'tr',
          row.isYou ? { class: 'own' } : {},
          ranked ? el('td', { class: 'num', text: String(index + 1) }) : null,
          nameCell(
            row.username,
            countries.get(row.username),
            youTag(row.isYou),
            row.won ? el('span', { class: 'tag', text: t('tag.won') }) : null,
            row.active ? null : el('span', { class: 'tag', text: t('match.tag.left') }),
          ),
          teams ? el('td', { text: teamNumber(row.team) }) : null,
          ranked ? el('td', { class: 'num col-total', text: formatScore(row.total) }) : null,
          ...(rated ? ratingCells(row.rating) : []),
          reports ? (report && reportable(row) ? reportCell(row.username, report.onReport, report.say) : el('td', { class: 'row-end' })) : null,
        ),
      ),
    ),
  );
}

/** The box a standing's tables scroll in and, after it, the strip that keeps the player's own row in sight while it is scrolled out of the box. */
function scrolling(...tables: Array<HTMLElement | null>): HTMLElement[] {
  const scroll = el('div', { class: 'match-scroll' }, ...tables);
  return [scroll, ownRowStrip(scroll)];
}

/**
 * For a player who comes into a game that is already under way (dropped in by the public queue, or
 * joining a party by its code): where it stands, and the round they come in on. The rounds before
 * it are blanks for them.
 */
export function joinPanel(state: MatchState, joinRound: number, onLeave: () => void): HTMLElement {
  return el(
    'section',
    { class: 'panel summary-panel match-panel', attrs: { 'aria-label': t('match.join.label') } },
    el('div', { class: 'figure' }, el('span', { class: 'label', text: t('match.join.title') }), el('span', { class: 'figure-value outcome', text: t('match.join.round', { round: joinRound + 1 }) })),
    el('p', { class: 'prose story', text: t('match.join.story') }),
    ...scrolling(teamStanding(state), standingRows(state)),
    el('div', { class: 'actions' }, el('button', { class: 'button danger', text: t('common.leaveMatch'), attrs: { type: 'button' }, on: { click: onLeave } })),
  );
}

/** What the match earned the player, where it earned anything: a ranked duel says that it paid double. */
function xpNote(state: MatchState): HTMLElement | null {
  const xp = xpEarned(state);
  if (xp === null || xp === 0) {
    return null;
  }
  const line = statusNote('ok', t(state.kind === 'ranked' ? 'match.xpEarnedRanked' : 'match.xpEarned', { xp: formatScore(xp) }));
  line.classList.add('match-xp');
  return line;
}

const button = (className: string, text: string, click?: () => void) => el('button', { class: className, text, attrs: { type: 'button' }, on: click ? { click } : {} });

/**
 * What comes after the standing: the notes over the panel's foot, and the buttons in it. The first
 * button is the one that goes on playing, in the accent: the same queue again after a matchmade
 * game, back to the lobby for a party's host. The way home is a ghost beside it. A party's other
 * players have no way on of their own (they wait for the host), so theirs is the way home alone.
 */
function afterStanding(state: MatchState, handlers: FinalHandlers): { notes: HTMLElement[]; buttons: HTMLElement[] } {
  const { again, lobby, party } = afterMatch(state);
  const home = button('button ghost', t('common.home'), handlers.onHome);
  if (again !== null) {
    return { notes: [], buttons: [button('button accent', t('play.again'), () => handlers.onAgain(again)), home] };
  }
  if (!lobby) {
    return { notes: party ? [statusNote('note', t('match.stayForLobby'))] : [], buttons: [home] };
  }
  const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  const back = button('button accent', t('match.backToLobby'));
  back.addEventListener('click', async () => {
    back.disabled = true;
    error.textContent = '';
    const problem = await handlers.onLobby();
    if (problem !== null) {
      back.disabled = false;
      error.textContent = problem;
    }
  });
  return { notes: [statusNote('note', t('match.hostLobby')), error], buttons: [back, home] };
}

/**
 * The end of a match: who won, the final table, rating changes for a ranked duel, what it earned,
 * and what comes next. `update` follows the match while the standing is on screen, since a party
 * can change hands there.
 */
export function finalPanel(first: MatchState, handlers: FinalHandlers) {
  const notes = el('div', { class: 'final-notes' });
  const foot = panelActions();
  // what became of a report made from the table
  const reported = statusLine('ok');
  reported.node.setAttribute('role', 'status');
  let drawn = '';
  const update = (state: MatchState) => {
    const key = JSON.stringify(afterMatch(state));
    if (key !== drawn) {
      drawn = key;
      const after = afterStanding(state, handlers);
      notes.replaceChildren(...after.notes);
      foot.replaceChildren(...after.buttons);
    }
  };
  update(first);
  const node = el(
    'section',
    { class: 'panel summary-panel match-panel match-standing', attrs: { 'aria-label': t('match.finalStanding') } },
    el('div', { class: 'figure' }, el('span', { class: 'label', text: t('match.finalStanding') }), el('span', { class: 'figure-value outcome', text: outcomeLine(first) })),
    // the table scrolls between the outcome and the panel's foot; what the match earned comes after it
    // a guest cannot report anyone: the server would refuse it
    ...scrolling(teamStanding(first), standingRows(first, first.you.guest ? undefined : { onReport: handlers.onReport, say: reported }), xpNote(first)),
    reported.node,
    notes,
    foot,
  );
  return { node, update };
}
