import { countryMaps, mapName, regionMaps, type CountryMap, type LocationSet, type MapId } from '../game/locations.ts';
import { t, tn } from '../i18n/index.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';
import type { MapPreset } from './map-preset.ts';

const COUNTRY = 'country';
type Scope = MapId | typeof COUNTRY;

/** "1234 places": the count is written as it is, without grouping, in the plural form the language has for it. */
const placeCount = (places: number) => tn('picker.places', places, { count: String(places) });

/** The countries whose name contains what was typed, in any case. */
function matching(countries: readonly CountryMap[], query: string): CountryMap[] {
  const wanted = query.trim().toLowerCase();
  return wanted === '' ? [...countries] : countries.filter((country) => country.name.toLowerCase().includes(wanted));
}

function countryList(name: string, countries: readonly CountryMap[], initial: MapId | null, onPick: (map: MapId) => void) {
  const search = el('input', {
    class: 'account-input',
    attrs: { id: `${name}-country-search`, type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: t('common.typeToSearch') },
  });
  const list = el('div', { class: 'country-list', attrs: { role: 'radiogroup', 'aria-label': t('picker.countries') } });
  const empty = el('p', { class: 'fine', text: t('picker.noCountry') });
  let picked: MapId | null = initial;

  const draw = () => {
    const shown = matching(countries, search.value);
    empty.hidden = shown.length > 0;
    // a country is always picked while this list is in use: the first one shown, until the player picks another
    if (!shown.some((country) => country.map === picked) && shown[0]) {
      picked = shown[0].map;
      onPick(picked);
    }
    list.replaceChildren(
      ...shown.map((country) => {
        const input = el('input', { attrs: { type: 'radio', name: `${name}-country`, value: country.code } });
        input.checked = country.map === picked;
        input.addEventListener('change', () => {
          picked = country.map;
          onPick(country.map);
        });
        return el('label', { class: 'country-option' }, input, el('span', {}, country.name, el('span', { class: 'country-count', text: placeCount(country.places) })));
      }),
    );
  };
  search.addEventListener('input', draw);

  const node = el('div', { class: 'country-picker' }, el('label', { class: 'label', text: t('label.country'), attrs: { for: search.id } }), search, list, empty);
  return {
    node,
    /** Shows the list and makes sure a country is picked. */
    open(): void {
      node.hidden = false;
      draw();
    },
    close(): void {
      node.hidden = true;
    },
  };
}

/**
 * The map choice: the world, the regions, or one country found by searching. Regions and
 * countries come from the list of places in use, so only maps that can be played are offered.
 * Until that list has loaded the world is the one choice. `preset` is a map chosen somewhere else
 * (the Maps pane, a community map's page): the picker opens on it, and a map that is not an
 * official one gets a cell of its own.
 */
export function mapPicker(name: string, loadPlaces: () => Promise<LocationSet>, onChange: (map: MapId) => void, preset: MapPreset | null = null): HTMLElement {
  const host = el('div', { class: 'map-picker' });
  const note = el('p', { class: 'fine', text: t('picker.loading'), attrs: { role: 'status' } });
  let scope: Scope = preset?.map ?? 'world';

  function draw(set: LocationSet | null): void {
    const countries = set ? countryMaps(set) : [];
    const presetCountry = preset !== null && countries.some((country) => country.map === preset.map);
    if (presetCountry && scope === preset?.map) {
      scope = COUNTRY;
    }
    const picker = countryList(name, countries, presetCountry ? (preset?.map ?? null) : null, onChange);
    picker.close();
    const offered: Array<{ value: Scope; name: string }> = [
      { value: 'world', name: mapName('world') },
      ...(set ? regionMaps(set) : []).map((region) => ({ value: region as Scope, name: mapName(region) })),
      ...(countries.length > 0 ? [{ value: COUNTRY as Scope, name: t('picker.aCountry') }] : []),
    ];
    // a preset that is not among them (a community map, or any map before the list loads) has its own cell
    const own = preset !== null && !presetCountry && !offered.some((choice) => choice.value === preset.map) ? [{ value: preset.map as Scope, name: preset.name }] : [];
    const row = choiceRow<Scope>(t('label.map'), name, [...offered, ...own], scope, (next) => {
      scope = next;
      if (next === COUNTRY) {
        picker.open();
      } else {
        picker.close();
        onChange(next);
      }
    });
    host.replaceChildren(...[row, picker.node, set ? null : note].filter((node) => node !== null));
    if (scope === COUNTRY) {
      picker.open();
    }
  }

  draw(null);
  if (preset) {
    onChange(preset.map);
  }
  void loadPlaces().then(
    (set) => draw(set),
    () => {
      note.textContent = t('picker.failed');
    },
  );
  return host;
}
