import type { RecentGame } from '../account/client.ts';
import { getGames, type HistoryGame } from '../account/games.ts';
import { NO_PAGES, nextPage, withPage, type HistoryPages } from '../account/history-pages.ts';
import { t, tn } from '../i18n/index.ts';
import { el } from './dom.ts';
import { historyRow } from './history-rows.ts';
import { statusLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';
import { gamesTable, mapCell, shortDay } from './stat-grid.ts';

const numHead = (text: string, className = 'num') => el('th', { class: className, text });
const numCell = (text: string, className = 'num') => el('td', { class: className, text });

/** A column a phone has no room for: the list gives it up there rather than scroll sideways. */
const WIDE_ONLY = 'num history-wide';

function row(game: HistoryGame, onOpen: (id: string) => void): HTMLElement {
  const words = historyRow(game);
  const day = shortDay(game.playedAt);
  return el(
    'tr',
    {},
    el('td', {}, el('time', { text: day, attrs: { datetime: game.playedAt } })),
    el('td', { class: 'history-kind' }, words.kind, words.result ? el('span', { class: 'tag', text: words.result }) : null),
    mapCell(game.map),
    el('td', { class: 'num' }, words.score, el('span', { class: 'account-of', text: ` / ${words.maxScore}` })),
    numCell(words.rating, WIDE_ONLY),
    numCell(words.xp, WIDE_ONLY),
    numCell(words.players, WIDE_ONLY),
    el(
      'td',
      { class: 'num' },
      el('button', { class: 'link-button', text: t('label.rounds'), attrs: { type: 'button', 'aria-label': tn('stats.openRounds', game.score, { day }) }, on: { click: () => onOpen(game.id) } }),
    ),
  );
}

/** Every game read so far, newest first: when, what kind and how it went, where, the score, and what it earned. */
function historyTable(games: readonly HistoryGame[], onOpen: (id: string) => void): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', { text: t('stats.date') }),
    el('th', { text: t('history.column.kind') }),
    el('th', { class: 'account-map', text: t('label.map') }),
    numHead(t('label.points')),
    numHead(t('leaderboards.column.rating'), WIDE_ONLY),
    numHead(t('label.xp'), WIDE_ONLY),
    numHead(t('history.column.players'), WIDE_ONLY),
    numHead(''),
  );
  return el('div', { class: 'account-table' }, el('table', { class: 'rounds history' }, el('thead', {}, head), el('tbody', {}, ...games.map((game) => row(game, onOpen)))));
}

/**
 * The player's games, every mode in one list, read a page at a time: "Show more" adds the next
 * page under the ones already shown. `recent` is the handful of games that came with the account,
 * which stand in when the first page cannot be read. `onOpen` opens a game round by round.
 */
export function historyList(recent: readonly RecentGame[], onOpen: (id: string) => void): HTMLElement {
  const host = el('div', { class: 'history-host' });
  const more = el('button', { class: 'button ghost', attrs: { type: 'button' } });
  const foot = el('div', { class: 'actions' }, more);
  // The first page is asked for by the pane, not by the player, and the rest of the pane stands
  // without it: a failure is said in turn, as a status, rather than announced over everything else.
  const error = el('p', { class: 'account-error', attrs: { role: 'status' } });
  let pages: HistoryPages = NO_PAGES;

  /** What stands where the list goes before any page has been read: that it is being read, or the recent games if that failed. */
  const unread = (busy: boolean): HTMLElement[] => {
    if (busy) {
      return [statusLine(t('history.loadingList'))];
    }
    return recent.length > 0 ? [gamesTable(recent, (game) => onOpen(game.id))] : [];
  };

  const draw = (busy: boolean) => {
    const read = pages.page > 0;
    // the one button asks for the next page, which before the first has been read is asking again
    more.textContent = busy ? t('history.more.busy') : read ? t('history.more') : t('common.tryAgain');
    more.disabled = busy;
    foot.hidden = !pages.more || (busy && !read);
    if (!read) {
      host.replaceChildren(...unread(busy));
    } else {
      host.replaceChildren(pages.games.length > 0 ? historyTable(pages.games, onOpen) : el('p', { class: 'prose', text: t('account.noGames') }));
    }
  };

  async function load(): Promise<void> {
    error.textContent = '';
    draw(true);
    const result = await getGames(nextPage(pages));
    if (result.ok) {
      pages = withPage(pages, result.data);
    } else {
      sayRefusal(error, result.error);
    }
    draw(false);
  }

  more.addEventListener('click', () => void load());
  void load();

  return el('section', { class: 'account-section' }, el('h3', { class: 'label', text: t('history.yours') }), host, error, foot);
}
