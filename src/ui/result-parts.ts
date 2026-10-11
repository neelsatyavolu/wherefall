import './result.css';
import { isPerfect, type Stars } from '../game/marks.ts';
import { t, tn } from '../i18n/index.ts';
import { countryName, el } from './dom.ts';
import { flag } from './flag.ts';

/** Small pieces a result is built from, on a local game's panels and a match's alike. */

const STAR_COUNT = 3;
const STAR_EARNED = '★';
const STAR_MISSED = '☆';

/**
 * A country as its flag and its name. Where the place has no country, the name alone, whatever it
 * is. Its two letters go with it (`data-code`) for a table too narrow for the name, where a flag
 * alone would leave a reader to know every flag: the stylesheet shows them there (`result.css`).
 */
export function countryLabel(country: string): HTMLElement {
  const drawn = flag(country);
  // where the platform draws no flags, the flag already is the two letters
  const code: Record<string, string> = drawn && !drawn.classList.contains('flag-code') ? { 'data-code': country.toUpperCase() } : {};
  return el('span', { class: 'country', attrs: code }, drawn, drawn ? ' ' : null, el('span', { class: 'country-name', text: countryName(country) }));
}

/** The mark a full 5,000 gets. */
export const perfectMark = (): HTMLElement => el('span', { class: 'tag perfect', text: t('result.perfect') });

/** The Perfect mark for a round's score, or nothing below 5,000. */
export const scoreMark = (score: number): HTMLElement | null => (isPerfect(score) ? perfectMark() : null);

/** One to three stars out of three, read out as a count. */
export function starRow(stars: Stars): HTMLElement {
  return el(
    'div',
    { class: 'stars', attrs: { role: 'img', 'aria-label': tn('summary.stars', stars), 'data-stars': String(stars) } },
    ...Array.from({ length: STAR_COUNT }, (_, index) => (index < stars ? el('span', { class: 'earned', text: STAR_EARNED }) : el('span', { text: STAR_MISSED }))),
  );
}
