import { expect, type Page } from '@playwright/test';
import { de } from '../src/i18n/de.ts';
import { en } from '../src/i18n/en.ts';
import { es } from '../src/i18n/es.ts';
import { fr } from '../src/i18n/fr.ts';
import { ru } from '../src/i18n/ru.ts';
import { scrollsSideways } from './helpers.ts';

// What the language tests ask of a screen: every piece of text on it comes from the language's
// catalog, and nothing is wider than the control it is in or reaches past the edge of the screen.

export type Catalog = Record<keyof typeof en, string> & Record<string, string>;
export const CATALOGS: Record<string, Catalog> = { en, es, fr, de, ru };
/** names that are the same in every language, and the units after a distance */
const SAME_EVERYWHERE = [/^Wherefall$/, /^Panoramax$/, /^OpenFreeMap$/, /^[SML]$/, /^[\d\s.,]+(km|m|mi|ft)$/];

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
/** every two-letter code there could be; one that is no country is named by its own letters, and is left out */
const REGION_CODES = LETTERS.flatMap((first) => LETTERS.map((second) => first + second));

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasLetter = (text: string) => /\p{L}/u.test(text);

/**
 * What may be on screen in a language: a whole catalog string with anything in its `{places}`, a
 * stretch of one between two places (a sentence with a link in it is drawn in pieces), a country's
 * name, or one of the few names that are never translated.
 */
export function accepts(code: string): (text: string) => boolean {
  // a no-break space is a space here: the page's text is read with its spaces tidied too
  const values = Object.values(CATALOGS[code]!).map((value) => value.replace(/\s+/g, ' '));
  const whole = values.filter((value) => hasLetter(value.replace(/\{\w+\}/g, ''))).map((value) => new RegExp(`^${value.split(/\{\w+\}/).map(escaped).join('.+')}$`, 'su'));
  const pieces = new Set(values.flatMap((value) => value.split(/\{\w+\}/)).map((piece) => piece.trim()).filter(hasLetter));
  const regions = new Intl.DisplayNames([code], { type: 'region' });
  const countries = new Set(REGION_CODES.map((country) => regions.of(country)).filter((name) => name && name.length > 2));
  return (text) => !hasLetter(text) || pieces.has(text) || countries.has(text) || SAME_EVERYWHERE.some((same) => same.test(text)) || whole.some((pattern) => pattern.test(text));
}

/** Every text a player can see or a screen reader says, apart from the credit lines of the map and its tile sources, whose wording is theirs. */
export const texts = (page: Page) =>
  page.evaluate(() => {
    const OTHERS = '.maplibregl-ctrl, .map-credit, .flag-code, script, style';
    const found = new Set<string>();
    const add = (text: string | null) => {
      const tidy = (text ?? '').replace(/\s+/g, ' ').trim();
      if (tidy) {
        found.add(tidy);
      }
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && !parent.closest(OTHERS) && parent.checkVisibility({ visibilityProperty: true })) {
        add(node.textContent);
      }
    }
    for (const element of document.body.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
      if (!element.closest(OTHERS) && element.checkVisibility()) {
        ['aria-label', 'title', 'placeholder', 'alt'].forEach((name) => add(element.getAttribute(name)));
      }
    }
    return [...found];
  });

/** Controls and cells whose text is wider than they are, or that reach past the edge of the screen. */
export const spilling = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('button, a, label, legend, th, td, h1, h2, h3, .tag, .hud-cell, .notice')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const shown = element.checkVisibility({ visibilityProperty: true }) && box.width > 1 && box.height > 1;
        const scrolled = element.closest('.map-panel, .nav') !== null && (box.right <= 0 || box.left >= innerWidth);
        return shown && !scrolled && (element.scrollWidth > element.clientWidth + 1 || box.right > innerWidth + 1 || box.left < -1);
      })
      .map((element) => (element.textContent ?? '').trim().slice(0, 60)),
  );

/** `names` are what the players typed themselves: usernames, which no catalog has. */
export async function expectTranslated(page: Page, code: string, names: readonly string[] = []): Promise<void> {
  const accepted = accepts(code);
  expect((await texts(page)).filter((text) => !accepted(text) && !names.includes(text))).toEqual([]);
  expect(await spilling(page)).toEqual([]);
  expect(await scrollsSideways(page)).toBe(false);
}
