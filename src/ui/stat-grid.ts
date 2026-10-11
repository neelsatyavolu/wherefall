import type { RecentGame } from '../account/client.ts';
import { communitySlugOf, mapName, type MapId } from '../game/locations.ts';
import { levelProgress } from '../game/progress.ts';
import { language, t, tn } from '../i18n/index.ts';
import { el, formatScore } from './dom.ts';
import { figure } from './panels.ts';
import { mapLink } from './profile-link.ts';

/** Pieces the account pane and a public profile both show: figures in a hairline grid, the level bar, the games table. */

export type Stat = [label: string, value: string, detail?: string];

/**
 * Marks a block of a pane as one that takes the wide measure (880) rather than the narrow one (640):
 * a chart, a table of many columns, the figures of an account. See `.pane-column` in shell.css.
 */
export function wide<T extends HTMLElement>(node: T): T {
  node.classList.add('wide');
  return node;
}

export const shortDay = (iso: string) => new Intl.DateTimeFormat(language(), { month: 'short', day: 'numeric' }).format(new Date(iso));

/** A day in full, written for the language in use: the day a game was played, the day an account can be restored until. */
export const longDay = (iso: string) => new Intl.DateTimeFormat(language(), { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));

/** A game's map by name. A community map's name is not in the game, so it is a link to the map's page instead. */
export function mapCell(map: MapId): HTMLElement {
  const slug = communitySlugOf(map);
  return slug === null ? el('td', { class: 'account-map', text: mapName(map) }) : el('td', { class: 'account-map' }, mapLink(slug, mapName(map)));
}

/**
 * Figures as cells that share hairlines rather than sitting in separate boxes. `columns` is how
 * many sit across on a wide screen: one that divides the count, so no row is left ragged.
 */
export function statGrid(label: string, stats: readonly Stat[], columns: number): HTMLElement {
  const grid = el('section', { class: 'account-stats', attrs: { 'aria-label': label } }, ...stats.map(([name, value, detail]) => figure(name, value, detail)));
  grid.style.setProperty('--stat-columns', String(columns));
  // a handful of figures keeps its one row on a narrow screen, where a longer grid goes two across
  grid.classList.toggle('few', stats.length <= 3);
  return grid;
}

/** The level, and a bar showing how far the XP has got towards the next one. */
export function levelBar(xp: number, level: number): HTMLElement {
  const progress = levelProgress(xp);
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${progress.fraction * 100}%`;
  return el(
    'section',
    { class: 'level', attrs: { 'aria-label': t('label.level') } },
    el(
      'div',
      { class: 'level-head' },
      figure(t('label.level'), String(level)),
      el('p', { class: 'settings-line', text: [t('stats.xp', { xp: formatScore(xp) }), t('stats.toLevel', { xp: formatScore(progress.toNext), level: level + 1 })].join(' · ') }),
    ),
    el('div', { class: 'bar', attrs: { role: 'progressbar', 'aria-label': t('stats.levelProgress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress.fraction * 100)) } }, fill),
  );
}

/** Recent games, newest first. `onOpen` adds a button to each row that opens the game round by round. */
export function gamesTable(games: readonly RecentGame[], onOpen?: (game: RecentGame) => void): HTMLElement {
  const rows = games.map((game) =>
    el(
      'tr',
      {},
      el('td', {}, el('time', { text: shortDay(game.playedAt), attrs: { datetime: game.playedAt } })),
      mapCell(game.map),
      el('td', { class: 'account-mode', text: t(`stats.mode.${game.mode}`) }),
      el('td', { class: 'num' }, formatScore(game.score), el('span', { class: 'account-of', text: ` / ${formatScore(game.maxScore)}` })),
      onOpen
        ? el(
            'td',
            { class: 'num' },
            el('button', {
              class: 'link-button',
              text: t('label.rounds'),
              attrs: { type: 'button', 'aria-label': tn('stats.openRounds', game.score, { day: shortDay(game.playedAt) }) },
              on: { click: () => onOpen(game) },
            }),
          )
        : null,
    ),
  );
  return el(
    'div',
    { class: 'account-table' },
    el(
      'table',
      { class: 'rounds' },
      el(
        'thead',
        {},
        el('tr', {}, el('th', { text: t('stats.date') }), el('th', { text: t('label.map') }), el('th', { class: 'account-mode', text: t('label.mode') }), el('th', { class: 'num', text: t('label.points') }), onOpen ? el('th', { class: 'num', text: '' }) : null),
      ),
      el('tbody', {}, ...rows),
    ),
  );
}
