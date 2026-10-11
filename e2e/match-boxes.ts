import type { Page } from '@playwright/test';

/** Measuring a match's screens: where things are, what lies on what, and what does not fit the panel it is in. */

export interface Box {
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The boxes of everything on the page that matches and can be seen. A walk arrow off the edge of the view is not on screen at all. */
export const boxesOf = (page: Page, selectors: readonly string[]): Promise<Box[]> =>
  page.evaluate(
    (list) =>
      list.flatMap((name) =>
        [...document.querySelectorAll(name)]
          .filter((node) => node.checkVisibility({ visibilityProperty: true }))
          .map((node) => node.getBoundingClientRect())
          .filter((box) => box.width > 1 && box.height > 1)
          .filter((box) => name !== '.move-arrow' || (box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight))
          .map((box) => ({ name, left: box.left, top: box.top, right: box.right, bottom: box.bottom })),
      ),
    [...selectors],
  );

export const boxOf = async (page: Page, selector: string): Promise<Box> => (await boxesOf(page, [selector]))[0]!;

const SLACK = 0.5;
const overlap = (one: Box, other: Box) => one.left < other.right - SLACK && other.left < one.right - SLACK && one.top < other.bottom - SLACK && other.top < one.bottom - SLACK;

/** Every pair of boxes that lie on one another, and every box that reaches past the screen. Empty when the layout holds. */
export async function clashes(page: Page, selectors: readonly string[]): Promise<string[]> {
  const boxes = await boxesOf(page, selectors);
  const screen = page.viewportSize()!;
  const outside = boxes.filter((box) => box.left < -SLACK || box.top < -SLACK || box.right > screen.width + SLACK || box.bottom > screen.height + SLACK).map((box) => `${box.name} leaves the screen`);
  const pairs = boxes.flatMap((one, index) =>
    boxes
      .slice(index + 1)
      .filter((other) => overlap(one, other))
      .map((other) => `${one.name} lies on ${other.name}`),
  );
  return [...outside, ...pairs];
}

/** Which of `pins` are off the screen or under one of `covers`. Empty when every pin is in the part of the map left open. */
export async function hiddenPins(page: Page, pins: readonly string[], covers: readonly string[]): Promise<string[]> {
  const [marks, over] = [await boxesOf(page, pins), await boxesOf(page, covers)];
  const screen = page.viewportSize()!;
  const missing = pins.filter((pin) => !marks.some((mark) => mark.name === pin)).map((pin) => `${pin} is not drawn`);
  const off = marks.filter((mark) => mark.left < 0 || mark.top < 0 || mark.right > screen.width || mark.bottom > screen.height).map((mark) => `${mark.name} is off the screen`);
  const under = marks.flatMap((mark) => over.filter((cover) => overlap(mark, cover)).map((cover) => `${mark.name} is under ${cover.name}`));
  return [...missing, ...off, ...under];
}

/**
 * What does not fit the panel in the slot. Nothing may scroll sideways, reach past the panel's
 * edge or be cut off; a heading and a number stay on one line; and no word is broken across two
 * lines, except a player's own name (`names`), which can be longer than any cell.
 */
export const misfits = (page: Page, names: readonly string[]): Promise<string[]> =>
  page.evaluate((typed) => {
    const panel = document.querySelector('.panel-host > *');
    if (!panel) {
      return ['there is no panel'];
    }
    const found: string[] = [];
    const say = (node: Element, what: string) => found.push(`"${(node.textContent ?? '').trim().slice(0, 40)}" ${what}`);
    const seen = (node: Element) => node.checkVisibility({ visibilityProperty: true }) && node.getBoundingClientRect().width > 0;
    const edge = panel.getBoundingClientRect();
    [panel, ...panel.querySelectorAll('.match-scroll')].filter((box) => box.scrollWidth > box.clientWidth + 1).forEach((box) => say(box, 'scrolls sideways'));
    for (const node of [...panel.querySelectorAll('th, td, button, a, .tag, .figure-value, .label, .status-note')].filter(seen)) {
      const box = node.getBoundingClientRect();
      if (box.left < edge.left - 0.5 || box.right > edge.right + 0.5) {
        say(node, 'reaches past the panel');
      }
      if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).display !== 'inline') {
        say(node, 'is cut off');
      }
    }
    const lines = (range: Range) => new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top))).size;
    for (const cell of [...panel.querySelectorAll('th, td.num')].filter((node) => seen(node) && node.children.length === 0)) {
      const range = document.createRange();
      range.selectNodeContents(cell);
      if (lines(range) > 1) {
        say(cell, 'is on more than one line');
      }
    }
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = node.textContent ?? '';
      if (!parent || !seen(parent)) {
        continue;
      }
      for (const word of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        // a name: in its own cell, or in a sentence, where a full stop or a bracket can follow it
        const bare = word[0].replace(/^[(«"]+|[).,:;»"]+$/g, '');
        const isName = parent.closest('.player') !== null || typed.some((name) => name.split(' ').includes(bare));
        if (!isName && lines(range) > 1) {
          say(parent, `breaks the word "${word[0]}"`);
        }
      }
    }
    return found;
  }, [...names]);

/** Controls a finger cannot hit: anything to press inside `root` that is under 44px either way. The map library's own credit button is its own business. */
export const smallTargets = (page: Page, root = '.play'): Promise<string[]> =>
  page.evaluate((scope) => {
    const MIN = 44 - 0.5;
    return [...document.querySelectorAll(`${scope} button, ${scope} a[href], ${scope} summary, ${scope} label.choice, ${scope} input[type='text']`)]
      .filter((node) => !node.closest('.maplibregl-ctrl, .pano') && node.checkVisibility({ visibilityProperty: true }))
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < MIN || box.height < MIN))
      .map(({ node, box }) => `${node.className || node.tagName} "${(node.textContent ?? '').trim().slice(0, 24)}" is ${Math.round(box.width)}x${Math.round(box.height)}`);
  }, root);

/** A colour token as the browser computes it, to compare a drawn colour with. */
export const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((variable) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = `var(${variable})`;
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
