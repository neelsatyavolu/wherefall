import './map-tools.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import type { GuessMap } from './guess-map.ts';
import { mapCredit } from './map-types.ts';
import { MAP_SIZES, MAP_TYPES, prefs, type MapSize, type MapType } from './prefs.ts';

/**
 * The buttons drawn over the guess map: its three sizes, keep-open and full screen, the map type,
 * and zoom. Built here and wired to the map here, so the round screen only has to place them.
 */

/** the letter on each size's button; what it stands for is its label, in the language in use */
const SIZE_LETTERS: Record<MapSize, string> = { small: 'S', medium: 'M', large: 'L' };
const SVG = 'http://www.w3.org/2000/svg';
/** a padlock: the map stays as it is */
const KEEP_ICON = ['M7 11V7.5a5 5 0 0 1 10 0V11', 'M5 11h14v10H5z'];
/** four corners pushed out to the edges */
const FULL_ICON = ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'];

/** A small line drawing for a button: square ends, no fill, in the button's own colour. */
export function icon(paths: readonly string[]): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'square', 'aria-hidden': 'true' }).forEach(
    ([name, value]) => svg.setAttribute(name, value),
  );
  paths.forEach((d) => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

const toolButton = (text: string, label: string, extra = '') =>
  el('button', { class: `map-tool ${extra}`.trim(), text, attrs: { type: 'button', 'aria-label': label, title: label } });

function toggleButton(paths: readonly string[], label: string): HTMLButtonElement {
  const button = toolButton('', label);
  button.setAttribute('aria-pressed', 'false');
  button.append(icon(paths));
  return button;
}

const byName = <T extends string>(names: readonly T[], make: (name: T) => HTMLButtonElement) => Object.fromEntries(names.map((name) => [name, make(name)])) as Record<T, HTMLButtonElement>;

export function buildMapTools() {
  const zoomIn = toolButton('+', t('guessMap.zoomIn'));
  const zoomOut = toolButton('−', t('guessMap.zoomOut'));
  const sizeButtons = byName(MAP_SIZES, (size) => toolButton(SIZE_LETTERS[size], t(`guessMap.size.${size}`)));
  const typeButtons = byName(MAP_TYPES, (type) => el('button', { class: 'map-tool map-type', text: t(`guessMap.type.${type}`), attrs: { type: 'button' } }));
  const keepButton = toggleButton(KEEP_ICON, t('guessMap.keepOpen'));
  const fullButton = toggleButton(FULL_ICON, t('guessMap.fullScreen'));
  const group = (name: string, label: string, buttons: HTMLElement[]) => el('div', { class: name, attrs: { role: 'group', 'aria-label': label } }, ...buttons);
  const tools = el(
    'div',
    { class: 'map-tools' },
    el(
      'div',
      { class: 'map-side' },
      el(
        'div',
        { class: 'map-row' },
        group('map-sizes', t('guessMap.size'), MAP_SIZES.map((size) => sizeButtons[size])),
        el('div', { class: 'map-hold' }, keepButton, fullButton),
      ),
      group('map-types', t('guessMap.type'), MAP_TYPES.map((type) => typeButtons[type])),
    ),
    group('map-zoom', t('guessMap.zoom'), [zoomIn, zoomOut]),
  );
  /** who the satellite or terrain pictures are by, for as long as they are on the map */
  const credit = el('p', { class: 'map-credit' });
  credit.hidden = true;
  return { tools, credit, zoomIn, zoomOut, sizeButtons, typeButtons, keepButton, fullButton };
}

type Tools = ReturnType<typeof buildMapTools>;
const press = (button: HTMLElement, on: boolean) => button.setAttribute('aria-pressed', String(on));

/**
 * Makes the tools work on a map panel and its map, starting from what the player chose before.
 * Returns what the round screen needs: `leaveFull` takes the map out of full screen (a new round,
 * Escape) and says whether it was in it.
 */
export function wireMapTools(panel: HTMLElement, tools: Tools, map: GuessMap): { leaveFull: () => boolean } {
  const setSize = (size: MapSize) => {
    panel.dataset.size = size;
    MAP_SIZES.forEach((each) => press(tools.sizeButtons[each], each === size));
  };
  const setType = (type: MapType) => {
    panel.dataset.type = type;
    MAP_TYPES.forEach((each) => press(tools.typeButtons[each], each === type));
    tools.credit.replaceChildren(...mapCredit(type));
    tools.credit.hidden = type === 'streets';
    void map.setType(type);
  };
  const setKeep = (keep: boolean) => {
    panel.classList.toggle('keep', keep);
    press(tools.keepButton, keep);
  };
  const setFull = (full: boolean) => {
    panel.classList.toggle('full', full);
    press(tools.fullButton, full);
  };

  tools.zoomIn.addEventListener('click', () => map.zoomIn());
  tools.zoomOut.addEventListener('click', () => map.zoomOut());
  MAP_SIZES.forEach((size) =>
    tools.sizeButtons[size].addEventListener('click', () => {
      setSize(size);
      prefs.setMapSize(size);
    }),
  );
  MAP_TYPES.forEach((type) =>
    tools.typeButtons[type].addEventListener('click', () => {
      setType(type);
      prefs.setMapType(type);
    }),
  );
  tools.keepButton.addEventListener('click', () => {
    const keep = !panel.classList.contains('keep');
    setKeep(keep);
    prefs.setMapKeepOpen(keep);
  });
  tools.fullButton.addEventListener('click', () => setFull(!panel.classList.contains('full')));

  setSize(prefs.mapSize());
  setType(prefs.mapType());
  setKeep(prefs.mapKeepOpen());
  return {
    leaveFull: () => {
      const was = panel.classList.contains('full');
      setFull(false);
      return was;
    },
  };
}
