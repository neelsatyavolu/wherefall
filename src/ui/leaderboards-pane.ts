import './social.css';
import { language, t } from '../i18n/index.ts';
import { BOARDS, PERIODS, getLeaderboard, type Board, type Leaderboard, type Period } from '../social/client.ts';
import { choiceRow } from './choice-row.ts';
import { el, formatScore } from './dom.ts';
import { leagueName } from './league.ts';
import { navName } from './nav.ts';
import { factLine, pane, statusLine, type Pane } from './pane.ts';
import { BOARD_PAGE, pager } from './pager.ts';
import { playerName } from './profile-link.ts';
import { errorBox } from './status-box.ts';

/** how many places get a medal */
const MEDALS = 3;

/** Today's rating and XP are gains, which a streak run is not: they are written with their sign and headed as a gain. */
const isGain = (board: Leaderboard) => board.period === 'day' && board.board !== 'streak';

const valueText = (board: Leaderboard, value: number) => (isGain(board) ? new Intl.NumberFormat(language(), { signDisplay: 'exceptZero' }).format(value) : formatScore(value));

/**
 * A place on the board. The top three wear a medal: a filled square, an inverted one and an
 * outlined one, each with the place written in it and named for a screen reader.
 */
function place(rank: number): HTMLElement {
  const text = String(rank);
  if (rank > MEDALS) {
    return el('td', { class: 'num', text });
  }
  const name = t(`leaderboards.medal.${rank as 1 | 2 | 3}`);
  return el('td', { class: 'num' }, el('span', { class: `medal medal-${rank}`, text, attrs: { role: 'img', 'aria-label': name, title: name } }));
}

type Entry = Leaderboard['entries'][number];

function boardRow(board: Leaderboard, entry: Entry): HTMLElement {
  const own = entry.rank === board.you?.rank;
  return el(
    'tr',
    own ? { class: 'own' } : {},
    place(entry.rank),
    // the player's own row says so in a word, not by its fill alone
    el('td', { class: 'player-name' }, playerName(entry.username, { country: entry.country }), own ? el('span', { class: 'tag', text: t('tag.you') }) : null),
    el('td', { class: 'board-extra', text: leagueName(entry.league) }),
    el('td', { class: 'num board-extra', text: String(entry.level) }),
    el('td', { class: 'num', text: valueText(board, entry.value) }),
  );
}

/** One page of a board, and under it the player's own row when that page does not have it. */
function pageTable(board: Leaderboard, entries: readonly Entry[], outside: Entry | null): HTMLElement {
  return el(
    'table',
    { class: 'rounds' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { class: 'num', text: '#' }),
        el('th', { text: t('label.player') }),
        el('th', { class: 'board-extra', text: t('label.league') }),
        el('th', { class: 'num board-extra', text: t('label.level') }),
        el('th', { class: 'num', text: isGain(board) ? t('leaderboards.column.gain') : t(`leaderboards.column.${board.board}`) }),
      ),
    ),
    el('tbody', {}, ...entries.map((entry) => boardRow(board, entry))),
    outside ? el('tbody', { class: 'board-own-row' }, boardRow(board, outside)) : null,
  );
}

/**
 * The hundred the server sends, twenty to a page as the daily's leaderboard is, with the same
 * pager. The links are followed by the one listener the home screen has.
 */
function boardTable(board: Leaderboard): HTMLElement {
  if (board.entries.length === 0) {
    return el('p', { class: 'prose', text: t(board.period === 'day' ? 'leaderboards.empty.day' : 'leaderboards.empty') });
  }
  const host = el('div', { class: 'account-table board' });
  const own = board.entries.find((entry) => entry.rank === board.you?.rank) ?? null;
  const show = (page: number) => {
    const first = (page - 1) * BOARD_PAGE;
    const entries = board.entries.slice(first, first + BOARD_PAGE);
    host.replaceChildren(pageTable(board, entries, own && !entries.includes(own) ? own : null));
    pages.show(page, first + BOARD_PAGE < board.entries.length);
  };
  const pages = pager(show);
  show(1);
  return el('div', { class: 'account-section' }, host, pages.node);
}

/** Where the signed-in player stands, when that is outside the hundred shown. */
function yourPlace(board: Leaderboard): HTMLElement | null {
  const { you } = board;
  if (!you || board.entries.some((entry) => entry.rank === you.rank)) {
    return null;
  }
  return factLine(t('leaderboards.yourPlace', { rank: formatScore(you.rank), value: valueText(board, you.value) }));
}

/**
 * What the board counts and whom it leaves out, so an empty one or a missing player is no puzzle.
 * An all-time board says what "inactive" means (not seen for 14 days) and whether those players
 * are on it, by what the server says it applied.
 */
function about(board: Leaderboard): HTMLElement {
  const text = board.period === 'day' ? t(`leaderboards.about.day.${board.board}`) : t(board.inactive ? 'leaderboards.about.all.inactive' : 'leaderboards.about.all');
  return el('p', { class: 'fine', text });
}

interface Shown {
  board: Board;
  period: Period;
  /** players not seen for 14 days are ranked too; only the all-time boards have any */
  inactive: boolean;
}

const sameBoard = (one: Shown, other: Shown) => one.board === other.board && one.period === other.period && one.inactive === other.inactive;

/**
 * The top hundred by rating, XP or best streak, twenty to a page, over all time or by what was
 * gained today. "Show inactive players" is off to begin with, and asks for the board again with
 * them on it. Open to visitors.
 */
export function leaderboardsPane(): Pane {
  const body = el('div', { class: 'pane-stack' });
  let shown: Shown = { board: 'rating', period: 'all', inactive: false };
  let disposed = false;

  const inactive = choiceRow<boolean>(
    t('leaderboards.inactive'),
    'inactive',
    [
      { value: true, name: t('account.switch.yes') },
      { value: false, name: t('account.switch.no') },
    ],
    shown.inactive,
    (value) => void load({ ...shown, inactive: value }),
  );

  async function load(next: Shown): Promise<void> {
    shown = next;
    // today's board lists only who played today: nobody on it is inactive, and the server ignores the switch
    inactive.hidden = next.period === 'day';
    body.replaceChildren(statusLine(t('leaderboards.loading')));
    const result = await getLeaderboard(next.board, next.period, next.period === 'all' && next.inactive);
    if (disposed || !sameBoard(shown, next)) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load(next)));
      return;
    }
    const lines = el('div', { class: 'board-about' }, about(result.data), yourPlace(result.data));
    body.replaceChildren(lines, boardTable(result.data));
  }

  void load(shown);

  return {
    node: pane(
      navName('leaderboards'),
      t('leaderboards.lede'),
      choiceRow<Board>(t('leaderboards.board'), 'board', BOARDS.map((board) => ({ value: board, name: t(`leaderboards.tab.${board}`) })), shown.board, (board) => void load({ ...shown, board })),
      choiceRow<Period>(t('social.period'), 'period', PERIODS.map((period) => ({ value: period, name: period === 'all' ? t('social.allTime') : t('leaderboards.period.day') })), shown.period, (period) => void load({ ...shown, period })),
      inactive,
      body,
    ),
    dispose: () => {
      disposed = true;
    },
  };
}
