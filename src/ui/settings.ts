import './solo.css';
import type { Units } from '../game/scoring.ts';
import { LANGUAGES, LANGUAGE_NAMES, language, t, type Language } from '../i18n/index.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';
import { MAX_VOLUME, prefs } from './prefs.ts';
import { slider } from './slider.ts';
import { sounds } from './sound.ts';

/** The settings kept in this browser, shown on the account pane to players and visitors alike. */

const VOLUME_STEP = 5;

/**
 * Kilometres or miles. Kept in this browser, so it is there for a visitor too. Until a choice is
 * made it follows the browser: miles where it is set to US or UK English.
 */
function unitsSetting(): HTMLElement {
  return el(
    'section',
    { class: 'account-section settings' },
    choiceRow<Units>(
      t('prefs.units'),
      'units',
      [
        { value: 'km', name: t('prefs.units.km') },
        { value: 'mi', name: t('prefs.units.mi') },
      ],
      prefs.units(),
      (units) => prefs.setUnits(units),
    ),
  );
}

/**
 * The interface's language. The choice is kept in this browser and the page is loaded again in it;
 * a language forced in the address is dropped, or it would win over the choice.
 */
function languageSetting(): HTMLElement {
  const choose = (chosen: Language) => {
    prefs.setLanguage(chosen);
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url);
    if (url.href === location.href) {
      location.reload();
    }
  };
  return el(
    'section',
    { class: 'account-section settings' },
    choiceRow<Language>(t('language.name'), 'language', LANGUAGES.map((code) => ({ value: code, name: LANGUAGE_NAMES[code] })), language(), choose),
  );
}

/** A volume as the language writes a share: 50%, 50 %. */
const percent = (volume: number): string => new Intl.NumberFormat(language(), { style: 'percent' }).format(volume / MAX_VOLUME);

/**
 * Sounds on or off, and how loud. The switch mutes without losing the level; the slider sets the
 * level of every sound and plays one when it is let go, so the new level is heard. Kept in this
 * browser, like the units.
 */
function soundSetting(): HTMLElement {
  const readout = el('output', { class: 'volume-value', text: percent(prefs.volume()) });
  const volume = slider({
    name: 'volume',
    label: t('prefs.volume'),
    min: 0,
    max: MAX_VOLUME,
    step: VOLUME_STEP,
    value: prefs.volume(),
    text: percent,
    onInput: (value) => {
      prefs.setVolume(value);
      readout.textContent = percent(value);
    },
    onChange: () => sounds.play('pin'),
  });
  volume.disabled = !prefs.sound();
  return el(
    'section',
    { class: 'account-section settings' },
    choiceRow<boolean>(
      t('prefs.sound'),
      'sound',
      [
        { value: true, name: t('prefs.sound.on') },
        { value: false, name: t('prefs.sound.off') },
      ],
      prefs.sound(),
      (on) => {
        prefs.setSound(on);
        volume.disabled = !on;
      },
    ),
    el('fieldset', { class: 'choice-row volume-control' }, el('legend', { class: 'label', text: t('prefs.volume') }), el('div', { class: 'volume-row' }, volume, readout)),
  );
}

function tutorialLink(onTutorial: () => void): HTMLElement {
  return el(
    'section',
    { class: 'account-section settings' },
    el('h3', { class: 'label', text: t('tutorial.label') }),
    el('p', { class: 'fine', text: t('account.tutorialNote') }),
    el('div', { class: 'actions' }, el('button', { class: 'button ghost', text: t('common.playTutorial'), attrs: { type: 'button' }, on: { click: onTutorial } })),
  );
}

/** What opens a group of settings: its name, and one line on where they are kept. */
export function groupHead(title: string, note: string): HTMLElement {
  return el('header', { class: 'settings-group' }, el('h3', { class: 'settings-group-title', text: title }), el('p', { class: 'fine', text: note }));
}

/**
 * The settings rows, in the order the account pane shows them: language, units, sound, tutorial.
 * They open with a heading that says they belong to this browser, which sets them apart from the
 * settings saved with the account. `onTutorial` is null for a visitor: the tutorial is a game, and
 * playing takes an account.
 */
export function settingsRows(onTutorial: (() => void) | null): HTMLElement[] {
  return [groupHead(t('account.group.browser'), t('account.group.browser.note')), languageSetting(), unitsSetting(), soundSetting(), ...(onTutorial ? [tutorialLink(onTutorial)] : [])];
}
