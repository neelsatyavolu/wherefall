import './maps.css';
import { countryName } from '../game/locations.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { lastPage, placesOnPage } from '../social/map-editor.ts';
import { MAP_LIMITS, type MapRow } from '../social/maps.ts';
import { el } from './dom.ts';

const COORDINATE_DIGITS = 4;

function placeRow(place: MapRow, index: number, onRemove: (id: string) => void): HTMLElement {
  const [id, lng, lat, country] = place;
  const remove = el('button', {
    class: 'button ghost',
    text: t('common.remove'),
    attrs: { type: 'button', 'aria-label': t('editor.removePlace', { number: formatNumber(index + 1), country: countryName(country) }) },
    on: { click: () => onRemove(id) },
  });
  return el(
    'li',
    { class: 'player-row' },
    el('span', { class: 'tag', text: formatNumber(index + 1) }),
    el('span', { class: 'player-name', text: countryName(country) }),
    el('span', { class: 'tag', text: `${lat.toFixed(COORDINATE_DIGITS)}, ${lng.toFixed(COORDINATE_DIGITS)}` }),
    el('div', { class: 'row-actions' }, remove),
  );
}

/**
 * The places of the map being made, a page at a time: a map may have five thousand, and a list of
 * that many rows could be neither scrolled nor drawn. The pager appears once there is more than a
 * page.
 */
export function placesList(onRemove: (id: string) => void) {
  const count = el('h3', { class: 'label' });
  const list = el('ul', { class: 'player-list' });
  const range = el('p', { class: 'settings-line', attrs: { role: 'status' } });
  const earlier = el('button', { class: 'button ghost', text: t('editor.earlier'), attrs: { type: 'button' }, on: { click: () => turn(-1) } });
  const later = el('button', { class: 'button ghost', text: t('editor.later'), attrs: { type: 'button' }, on: { click: () => turn(1) } });
  const pager = el('div', { class: 'places-pager' }, earlier, range, later);
  let places: readonly MapRow[] = [];
  let page = 0;

  function draw(): void {
    const shown = placesOnPage(places, page);
    page = shown.page;
    count.textContent = [t('label.places'), t('editor.placesOf', { placed: formatNumber(shown.total), max: formatNumber(MAP_LIMITS.maxPlaces) })].join(' · ');
    list.replaceChildren(...shown.rows.map((place, index) => placeRow(place, shown.first + index, onRemove)));
    range.textContent = t('editor.showing', { from: formatNumber(shown.first + 1), to: formatNumber(shown.first + shown.rows.length) });
    pager.hidden = lastPage(shown.total) === 0;
    earlier.disabled = page === 0;
    later.disabled = page === lastPage(shown.total);
  }
  function turn(by: number): void {
    page += by;
    draw();
  }

  draw();
  return {
    node: el('section', { class: 'account-section', attrs: { 'aria-label': t('label.places') } }, count, list, pager),
    /** Shows the places as they now are. `toEnd` turns to the last page, where a place just added is. */
    show(next: readonly MapRow[], toEnd: boolean): void {
      places = next;
      page = toEnd ? lastPage(next.length) : page;
      draw();
    },
  };
}
