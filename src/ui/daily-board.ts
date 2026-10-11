import './daily.css';
import { getDaily, type DailyEntry, type DailyState } from '../daily/client.ts';
import { ownRowOutside } from '../daily/view.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { el, formatScore } from './dom.ts';
import { errorLine } from './pane.ts';
import { pager } from './pager.ts';
import { playerName } from './profile-link.ts';

/** The account looking at the board, so its own row can be told from the rest. */
export interface Viewer {
  username: string;
  country: string | null;
}

interface Board {
  node: HTMLElement;
  dispose: () => void;
}

function row(entry: DailyEntry, own: boolean): HTMLElement {
  return el(
    'tr',
    own ? { class: 'own' } : {},
    el('td', { class: 'num', text: formatNumber(entry.rank) }),
    // the player's own row says so in a word, not by its fill alone
    el('td', {}, playerName(entry.username, { country: entry.country }), own ? el('span', { class: 'tag', text: t('tag.you') }) : null),
    el('td', { class: 'num', text: formatScore(entry.score) }),
  );
}

/** One page of the day's results, and under it the viewer's own row when that page does not have it. */
function table(daily: DailyState, viewer: Viewer | null): HTMLElement {
  const { entries } = daily.leaderboard;
  if (entries.length === 0) {
    return el('p', { class: 'prose', text: t('daily.empty') });
  }
  const outside = ownRowOutside(entries, viewer, daily.yours);
  return el(
    'table',
    { class: 'rounds' },
    el('thead', {}, el('tr', {}, el('th', { class: 'num', text: '#' }), el('th', { text: t('label.player') }), el('th', { class: 'num', text: t('label.points') }))),
    el('tbody', {}, ...entries.map((entry) => row(entry, entry.username === viewer?.username))),
    outside ? el('tbody', { class: 'daily-own-row' }, row(outside, true)) : null,
  );
}

/**
 * Today's leaderboard: the top hundred, twenty to a page, with flags beside the names. It fetches
 * its own later pages; a page that will not load leaves the one showing and says why.
 */
export function dailyBoard(first: DailyState, viewer: Viewer | null): Board {
  const tableHost = el('div', { class: 'account-table' });
  const error = errorLine();
  const pages = pager((to) => void turn(to));
  let disposed = false;

  function show(daily: DailyState): void {
    tableHost.replaceChildren(table(daily, viewer));
    pages.show(daily.leaderboard.page, daily.leaderboard.more);
  }

  async function turn(to: number): Promise<void> {
    error.textContent = '';
    const daily = await getDaily(to);
    if (disposed) {
      return;
    }
    if (!daily.ok) {
      error.textContent = daily.error;
      pages.failed();
      return;
    }
    show(daily.data);
  }

  show(first);

  return {
    node: el(
      'section',
      { class: 'account-section daily-board', attrs: { 'aria-label': t('daily.leaderboard') } },
      el('h3', { class: 'label', text: t('daily.todaysLeaderboard') }),
      tableHost,
      pages.node,
      error,
    ),
    dispose: () => {
      disposed = true;
    },
  };
}
