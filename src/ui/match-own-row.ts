import { el } from './dom.ts';

/** the height of a scrolling table's headings, which stay at the top of the box: a row behind them is not in sight */
const HEAD_PX = 28;
/** how much of the row counts as all of it: a rounded-off pixel must not flip the strip */
const IN_SIGHT = 0.98;

/**
 * The player's own row of a match's table, kept in sight however far the table is scrolled, and
 * never by lying on another row. While the row itself is scrolled out of the box, a copy of it
 * stands in a strip of its own under the box (opaque, under a hairline), outside what scrolls; the
 * strip is gone again as soon as the row is back. The copy's cells are as wide as the table's, so
 * its numbers stand under the columns they belong to. It is a copy for the eye only: a screen
 * reader and the Tab key have the row in the table.
 *
 * `scroll` is the box the tables scroll in. The strip goes into the panel right after it.
 */
export function ownRowStrip(scroll: HTMLElement): HTMLElement {
  const strip = el('div', { class: 'own-strip', attrs: { 'aria-hidden': 'true' } });
  strip.hidden = true;
  strip.inert = true;
  const own = scroll.querySelector<HTMLTableRowElement>('.rounds:not(.team-table) tr.own');
  const table = own?.closest('table');
  if (!own || !table || typeof IntersectionObserver === 'undefined') {
    return strip;
  }
  /** the copy, while the strip is shown: the page holds the row twice only for as long as it must */
  let copy: HTMLTableRowElement | null = null;

  /** Gives each cell of the copy the width of the cell it copies. A column a phone leaves out is left out of both. */
  const align = () =>
    [...(copy?.cells ?? [])].forEach((cell, index) => {
      const width = own.cells[index]?.getBoundingClientRect().width ?? 0;
      cell.style.width = width > 0 ? `${width}px` : '';
    });

  /**
   * While the strip is shown, the box ends on the foot of the last row that is whole in it, so the
   * strip never stands under half a row: it follows a whole one, or the headings. The box has its
   * own height back when the strip goes. (A row passing while the table is scrolled is cut by the
   * box's edge like any scrolled row.)
   */
  const settle = () => {
    scroll.style.height = '';
    scroll.style.minHeight = '';
    if (strip.hidden) {
      return;
    }
    const box = scroll.getBoundingClientRect();
    const feet = [...scroll.querySelectorAll('tr')].map((row) => row.getBoundingClientRect().bottom).filter((foot) => foot > box.top && foot <= box.bottom + 0.5);
    if (feet.length > 0) {
      scroll.style.height = `${Math.max(...feet) - box.top}px`;
      // the box's least height is for a box with rows cut at its foot; this one ends on a row
      scroll.style.minHeight = '0';
    }
  };

  const show = (shown: boolean) => {
    if (shown && !copy) {
      copy = own.cloneNode(true) as HTMLTableRowElement;
      strip.replaceChildren(el('table', { class: table.className }, el('tbody', {}, copy)));
    } else if (!shown) {
      copy = null;
      strip.replaceChildren();
    }
    align();
    strip.hidden = !shown;
    settle();
  };

  const watcher = new IntersectionObserver(
    (entries) => {
      // several looks can arrive together: the last is how things stand
      const latest = entries.at(-1);
      if (latest) {
        show(latest.intersectionRatio < IN_SIGHT);
      }
    },
    { root: scroll, rootMargin: `-${HEAD_PX}px 0px 0px 0px`, threshold: [0, IN_SIGHT, 1] },
  );
  // watched from the next frame on: by then the panel is on the page, and the first look at the row is a true one
  requestAnimationFrame(() => {
    watcher.observe(own);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        align();
        settle();
      }).observe(table);
    }
  });
  return strip;
}
