import { mapName, type MapId } from '../game/locations.ts';
import type { Mode } from '../game/settings.ts';
import { t, tn } from '../i18n/index.ts';
import { el } from './dom.ts';

export interface Choice<T> {
  value: T;
  name: string;
}

const MINUTE = 60;

/** A time limit's name, for any number of seconds: "No limit", "30 sec", "2 min", "1 min 30 sec". */
export function timeName(limit: number): string {
  const minutes = Math.floor(limit / MINUTE);
  const seconds = limit % MINUTE;
  if (limit <= 0) {
    return t('time.0');
  }
  if (minutes === 0) {
    return t('time.seconds', { seconds });
  }
  return seconds === 0 ? t('time.minutes', { minutes }) : t('time.minutesSeconds', { minutes, seconds });
}

/** A game's settings in one line, such as "World · 5 rounds · 1 min · move". */
export function describeSettings(settings: { map: MapId; mode: Mode; timeLimit: number; rounds: number }): string {
  return [mapName(settings.map), tn('settings.rounds', settings.rounds), timeName(settings.timeLimit), t(`settings.mode.${settings.mode}`)].join(' · ');
}

/** How many letters of an option's name fit on one line of a phone's cell: three options sit three across, any other number two across. */
const FITS_THREE_ACROSS = 10;
const FITS_TWO_ACROSS = 17;

/**
 * Whether a row of options is better stacked on a phone, one full-width row each: when a name is
 * too long for its cell, where it would wrap to three or four lines. Names differ by language, so
 * this is asked of the names as they are written.
 */
export function stacksOnPhone(names: readonly string[]): boolean {
  const fits = names.length === 3 ? FITS_THREE_ACROSS : FITS_TWO_ACROSS;
  return names.length > 1 && names.some((name) => name.length > fits);
}

/** The class of the cells' box: `stack` where the names are too long to sit side by side on a phone. */
export const choicesClass = (names: readonly string[]) => (stacksOnPhone(names) ? 'choices stack' : 'choices');

/** A row of mutually exclusive options, drawn as hairline cells. */
export function choiceRow<T extends string | number | boolean>(
  legend: string,
  name: string,
  choices: readonly Choice<T>[],
  initial: T,
  onChange: (value: T) => void,
): HTMLElement {
  const cells = choices.map((choice) => {
    const input = el('input', { attrs: { type: 'radio', name, value: String(choice.value) } });
    input.checked = choice.value === initial;
    input.addEventListener('change', () => onChange(choice.value));
    return el('label', { class: 'choice' }, input, el('span', { text: choice.name }));
  });
  const box = choicesClass(choices.map((choice) => choice.name));
  return el('fieldset', { class: 'choice-row' }, el('legend', { class: 'label', text: legend }), el('div', { class: box }, ...cells));
}
