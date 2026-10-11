import './match-extras.css';
import { t } from '../i18n/index.ts';
import type { MatchState } from '../multiplayer/client.ts';
import { xpForRound } from '../multiplayer/match-view.ts';
import { healthRows, isLastRound, roundTable, type RoundRow } from '../multiplayer/state.ts';
import { el, formatScore } from './dom.ts';
import { plainName } from './guest-parts.ts';
import { ownRowStrip } from './match-own-row.ts';
import { statusLine, statusNote } from './match-status.ts';
import { figure, placeLink } from './panels.ts';
import { showDistance } from './prefs.ts';
import { playerName } from './profile-link.ts';
import { countryLabel, scoreMark } from './result-parts.ts';
import { teamNumber } from './team-names.ts';
import { teamLines } from './team-table.ts';

/**
 * The panels a match puts over the round screen while it is played: a duel's health and the round
 * table. Who has guessed is in `match-roster.ts`, the final standing and its actions in
 * `match-standing.ts`, the teams' own table and health in `team-table.ts` and `team-health.ts`.
 */

export { teamName, teamNumber } from './team-names.ts';

const distanceText = (km: number | null) => (km === null ? t('label.noGuess') : showDistance(km));
/** "neel (you)", for a screen reader: on screen the accent of the player's own bar says it, and the name keeps its room */
const nameYou = (username: string, isYou: boolean) => (isYou ? t('match.nameYou', { name: username }) : username);

/** Each player's country by their name, for the flag beside it. */
export const countriesOf = (state: MatchState): ReadonlyMap<string, string | null> => new Map(state.players.map((player) => [player.username, player.country]));

/** A column's heading: its words, whether it holds numbers, and a class of its own when it has one. */
export type HeadCell = [text: string, numeric: boolean, extra?: string];

const classes = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

export const tableHead = (...cells: HeadCell[]) =>
  el('thead', {}, el('tr', {}, ...cells.map(([text, numeric, extra]) => el('th', { class: classes(numeric && 'num', extra), text, attrs: { scope: 'col' } }))));

/**
 * A player in a table: their flag and their name, which leads to their profile in a new tab (the
 * match is not left) unless they are a guest, then the small notes about them.
 */
export function nameCell(username: string, country: string | null | undefined, ...notes: Array<HTMLElement | null>): HTMLElement {
  const player = playerName(username, { country, newTab: true });
  // the name itself is the last thing in it: the link, or a guest's plain name
  player.lastElementChild?.replaceChildren(...softBreaks(username));
  return el('td', { class: 'player-name' }, player, ...notes);
}

/**
 * A name with places to break it: after each underscore, hyphen and full stop. A name too long for
 * its cell then goes onto a second line at one of those, before it is broken in the middle of a word.
 */
export function softBreaks(name: string): Array<string | HTMLElement> {
  return name.split(/(?<=[_.-])(?=.)/).flatMap((part, index) => (index === 0 ? [part] : [el('wbr'), part]));
}

export const youTag = (isYou: boolean) => (isYou ? el('span', { class: 'tag', text: t('tag.you') }) : null);

/**
 * Health in a ranked duel: a bar and a number for each player, and what the last round cost.
 * Empty, and hidden, for every other kind of match.
 */
export function healthStrip() {
  const node = el('aside', { class: 'health', attrs: { 'aria-label': t('match.health') } });
  node.hidden = true;
  let drawn = '';
  return {
    node,
    /** `round` is the revealed round whose damage to show, or null between reveals. */
    update(state: MatchState, round: number | null): void {
      const rows = healthRows(state, round);
      const countries = countriesOf(state);
      const key = JSON.stringify([rows, [...countries]]);
      node.hidden = rows.length === 0;
      if (key === drawn) {
        return;
      }
      drawn = key;
      node.replaceChildren(
        ...rows.map((row) => {
          const fill = el('div', { class: 'bar-fill' });
          fill.style.width = `${row.share * 100}%`;
          return el(
            'div',
            { class: row.isYou ? 'health-row own' : 'health-row' },
            plainName(row.username, countries.get(row.username), 'health-name'),
            el('span', { class: 'health-value', text: formatScore(row.health) }),
            el('span', { class: 'health-lost', text: row.lost > 0 ? `−${formatScore(row.lost)}` : '' }),
            el('div', { class: 'bar', attrs: { role: 'meter', 'aria-label': t('match.healthOf', { name: nameYou(row.username, row.isYou) }), 'aria-valuemin': '0', 'aria-valuemax': '5000', 'aria-valuenow': String(row.health) } }, fill),
          );
        }),
      );
    },
  };
}

function roundRows(state: MatchState, rows: readonly RoundRow[]): HTMLElement {
  // 2v2, and a party whose host has turned teams on
  const teams = state.teams !== null;
  const countries = countriesOf(state);
  const head: HeadCell[] = [[t('label.player'), false], ...(teams ? [[t('team.heading'), false] as HeadCell] : []), [t('label.distance'), true], [t('label.points'), true], [t('match.total'), true, 'col-total']];
  // a phone leaves the running total out (`.col-total`): the name needs the room
  return el(
    'table',
    { class: 'rounds', attrs: { 'aria-label': t('match.players') } },
    tableHead(...head),
    el(
      'tbody',
      {},
      ...rows.map((row) =>
        el(
          'tr',
          row.isYou ? { class: 'own' } : {},
          nameCell(row.username, countries.get(row.username), youTag(row.isYou)),
          teams ? el('td', { text: teamNumber(row.team) }) : null,
          el('td', { class: 'num', text: distanceText(row.distanceKm) }),
          // the player's own full score is marked as it is in a game alone
          el('td', { class: 'num' }, formatScore(row.score), row.isYou ? scoreMark(row.score) : null),
          el('td', { class: 'num col-total', text: formatScore(row.total) }),
        ),
      ),
    ),
  );
}

/** What the player's own round earned, where rounds earn XP at all and this one earned some. */
function xpLine(state: MatchState, own: RoundRow | undefined): HTMLElement | null {
  const xp = own ? xpForRound(state, own.score) : null;
  if (xp === null || xp === 0) {
    return null;
  }
  const line = statusNote('ok', t('save.xp', { xp: formatScore(xp) }), true);
  line.classList.add('round-xp');
  return line;
}

/**
 * One revealed round: where it was, then every player's distance, points and running total. It
 * moves on by itself, so where another panel has the button that moves play on, this one has the
 * countdown; the way out of the match is beside it.
 */
export function revealPanel(state: MatchState, round: number, onLeave: () => void) {
  const rows = roundTable(state, round);
  const own = rows.find((row) => row.isYou);
  const place = state.places?.[round];
  // a ranked duel and a 2v2 also end as soon as someone's health is gone
  const ending = isLastRound(state, round);
  // not a live region: a number that changes every second would be read out every second
  const countdown = statusLine('live', true);
  countdown.node.classList.add('countdown');

  // the tables scroll between the round's name and the panel's foot; what the round earned and the way to the place come after them
  const scroll = el('div', { class: 'match-scroll' }, teamLines(state, round), roundRows(state, rows), el('div', { class: 'match-meta' }, xpLine(state, own), place ? placeLink(place) : null));
  const node = el(
    'section',
    { class: 'panel result-panel match-panel match-result', attrs: { 'aria-label': t('match.roundResult') } },
    figure(t('match.roundOf', { round: round + 1, rounds: state.settings.rounds }), place ? countryLabel(place.country) : ''),
    scroll,
    // the player's own row, while it is scrolled out of the tables
    ownRowStrip(scroll),
    el('div', { class: 'actions panel-actions match-foot' }, countdown.node, el('button', { class: 'button danger', text: t('common.leaveMatch'), attrs: { type: 'button' }, on: { click: onLeave } })),
  );

  return {
    node,
    rows,
    /** the player's own row, when they are in the table */
    own,
    /** The reveal moves on by itself; this says when. */
    setCountdown(seconds: number): void {
      countdown.set(t(ending ? 'match.finalIn' : 'match.nextRoundIn', { seconds }));
    },
  };
}
