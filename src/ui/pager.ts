import './pager.css';
import { formatNumber, t } from '../i18n/index.ts';
import { el } from './dom.ts';

/** How many players a page of a board holds: the daily's leaderboard and the three all-time boards alike. */
export const BOARD_PAGE = 20;

export interface Pager {
  node: HTMLElement;
  /** The page now showing, counting from 1, and whether there is one after it. A board that fits one page has no pager. */
  show: (page: number, more: boolean) => void;
  /** The page asked for did not come: the one showing stays, and both ways are open again. */
  failed: () => void;
}

/**
 * The foot of a list that comes a page at a time: Previous, the page's number, Next. One for every
 * board, so they all turn the same way. `onTurn` is asked for a page; while it is on its way both
 * buttons wait, and when it has come the keyboard stays with the pager.
 */
export function pager(onTurn: (to: number) => void): Pager {
  const name = el('p', { class: 'pager-page', attrs: { role: 'status' } });
  const previous = el('button', { class: 'button ghost', text: t('daily.previous'), attrs: { type: 'button' } });
  const next = el('button', { class: 'button ghost', text: t('daily.nextPage'), attrs: { type: 'button' } });
  const node = el('div', { class: 'pager' }, previous, name, next);
  let page = 1;
  let more = false;
  /** the button that asked for the page on its way */
  let pressed: HTMLButtonElement | null = null;

  const draw = () => {
    name.textContent = t('daily.page', { page: formatNumber(page) });
    previous.disabled = page <= 1;
    next.disabled = !more;
    node.hidden = page <= 1 && !more;
  };
  const ask = (button: HTMLButtonElement, to: number) => {
    pressed = button;
    previous.disabled = true;
    next.disabled = true;
    onTurn(to);
  };
  /** The button just pressed may have nowhere further to go: the focus then moves to the other one. */
  const settle = () => {
    if (pressed) {
      (pressed.disabled ? (pressed === next ? previous : next) : pressed).focus();
      pressed = null;
    }
  };

  previous.addEventListener('click', () => ask(previous, page - 1));
  next.addEventListener('click', () => ask(next, page + 1));
  draw();

  return {
    node,
    show: (shown, hasMore) => {
      page = shown;
      more = hasMore;
      draw();
      settle();
    },
    failed: () => {
      draw();
      settle();
    },
  };
}
