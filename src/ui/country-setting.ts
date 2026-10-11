import { setCountry } from '../account/actions.ts';
import { countryChoices, matchingCountries, type CountryChoice } from '../account/countries.ts';
import { language, t } from '../i18n/index.ts';
import { countryName, el } from './dom.ts';
import { flag } from './flag.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

const NAME = 'account-country';

/** A flag beside the country's own name, which already says what it is: left out of what a screen reader says. */
function silentFlag(country: string): HTMLElement | null {
  const mark = flag(country);
  mark?.setAttribute('aria-hidden', 'true');
  return mark;
}

/** One country of the list, or "No country": a radio drawn as a row. */
function option(choice: CountryChoice | null, checked: boolean, onPick: (country: string | null) => void): HTMLElement {
  const input = el('input', { attrs: { type: 'radio', name: NAME, value: choice?.code ?? '' } });
  input.checked = checked;
  input.addEventListener('change', () => onPick(choice?.code ?? null));
  return el('label', { class: 'country-option' }, input, el('span', {}, choice ? el('span', {}, silentFlag(choice.code), choice.name) : t('account.country.none')));
}

/** The country as it is now: its flag and name, or that there is none. */
const shownAs = (country: string | null): Array<Node | string> => (country === null ? [t('account.country.none')] : [silentFlag(country), countryName(country)].filter((part) => part !== null));

/**
 * The account's country, which is drawn as a flag beside the player's name everywhere. It shows
 * the country as it is and one button; the list opens when that is pressed, so the pane is not
 * a list of countries long for a player who came for something else. Every country is listed under
 * its name in the language in use, narrowed by what is typed; picking one, or "No country", saves
 * it at once and closes the list. `onSaved` is told what the account now has.
 */
export function countrySetting(current: string | null, onSaved: (country: string | null) => void): HTMLElement {
  const choices = countryChoices(countryName, language());
  const now = el('p', { class: 'settings-line country-now' }, ...shownAs(current));
  const search = el('input', {
    class: 'account-input',
    attrs: { id: `${NAME}-search`, type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: t('common.typeToSearch') },
  });
  const list = el('div', { class: 'country-list', attrs: { role: 'radiogroup', 'aria-label': t('picker.countries') } });
  const empty = el('p', { class: 'fine', text: t('account.country.noMatch') });
  const error = errorLine();
  let saved = current;

  /** The list for what is typed. "No country" leads it until something is typed. */
  const draw = () => {
    const shown = matchingCountries(choices, search.value);
    const all = search.value.trim() === '';
    empty.hidden = shown.length > 0;
    list.replaceChildren(...(all ? [option(null, saved === null, pick)] : []), ...shown.map((choice) => option(choice, choice.code === saved, pick)));
  };

  async function pick(country: string | null): Promise<void> {
    // one save at a time: the list is drawn again, and can be used again, when this one is answered
    for (const input of list.querySelectorAll('input')) {
      input.disabled = true;
    }
    error.textContent = '';
    const result = await setCountry(country);
    if (result.ok) {
      saved = result.data.country;
      now.replaceChildren(...shownAs(saved));
      onSaved(saved);
    } else {
      sayRefusal(error, result.error);
    }
    // the list shows what the account has: the new country, or the old one when it could not be saved
    draw();
    if (result.ok) {
      show(false);
    }
  }

  const change = el('button', { class: 'button ghost', text: t('account.country.change'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const close = el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' } });
  const picker = el('div', { class: 'country-picker' }, el('label', { class: 'label', text: t('account.country.find'), attrs: { for: search.id } }), search, list, empty, el('div', { class: 'actions' }, close));
  const opener = el('div', { class: 'actions' }, change);

  /** Opens the list, or closes it and gives the keyboard back to the button that opened it. */
  function show(open: boolean): void {
    picker.hidden = !open;
    opener.hidden = open;
    change.setAttribute('aria-expanded', String(open));
    if (open) {
      search.focus();
    } else {
      search.value = '';
      draw();
      change.focus();
    }
  }

  search.addEventListener('input', draw);
  change.addEventListener('click', () => show(true));
  close.addEventListener('click', () => show(false));
  draw();
  picker.hidden = true;

  return el(
    'section',
    { class: 'account-section settings' },
    el('h3', { class: 'label', text: t('label.country') }),
    now,
    el('p', { class: 'fine', text: t('account.country.note') }),
    opener,
    picker,
    error,
  );
}
