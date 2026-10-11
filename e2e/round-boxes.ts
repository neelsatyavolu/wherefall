import type { Page } from '@playwright/test';

// What the wave 6 round specs share: the sizes and languages a layout is measured at, and the
// measuring itself (where things are on the page, and which of them lie on one another).

export const PHONE = { width: 390, height: 800 };
export const DESKTOPS = [
  { width: 1360, height: 840 },
  { width: 1440, height: 900 },
] as const;
export const LANGUAGES = ['en', 'es', 'fr', 'de', 'ru'] as const;
export const EDGE = 16;

/** Smallest PNG there is (one pixel): stands in for every satellite tile. */
export const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const SATELLITE_TILES = 'https://tiles.maps.eox.at/**';

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

/** Every pair of boxes that lie on one another, and every box that reaches past the screen. Empty when the layout holds. */
export async function clashes(page: Page, selectors: readonly string[]): Promise<string[]> {
  const boxes = await boxesOf(page, selectors);
  const screen = page.viewportSize()!;
  const slack = 0.5;
  const outside = boxes.filter((box) => box.left < -slack || box.top < -slack || box.right > screen.width + slack || box.bottom > screen.height + slack).map((box) => `${box.name} leaves the screen`);
  const pairs = boxes.flatMap((one, index) =>
    boxes
      .slice(index + 1)
      .filter((other) => one.left < other.right - slack && other.left < one.right - slack && one.top < other.bottom - slack && other.top < one.bottom - slack)
      .map((other) => `${one.name} lies on ${other.name}`),
  );
  return [...outside, ...pairs];
}

export const box = async (page: Page, selector: string): Promise<Box> => (await boxesOf(page, [selector]))[0]!;
export const useLanguage = (page: Page, code: string) => page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
export const stored = (page: Page, key: string) => page.evaluate((name) => localStorage.getItem(name), key);
