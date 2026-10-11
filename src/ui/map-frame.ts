import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import type { GuessMap } from './guess-map.ts';

/**
 * A place on a page for a map, with plus and minus buttons over its corner. The map itself is
 * made by the caller once the frame is on the page (a map measures its box), and handed to `attach`.
 */
export function mapFrame(className: string, label: string) {
  const host = el('div', { class: `history-map ${className}`.trim(), attrs: { 'aria-label': label } });
  const zoomIn = el('button', { class: 'map-tool', text: '+', attrs: { type: 'button', 'aria-label': t('guessMap.zoomIn') } });
  const zoomOut = el('button', { class: 'map-tool', text: '−', attrs: { type: 'button', 'aria-label': t('guessMap.zoomOut') } });
  const node = el('div', { class: 'map-frame' }, host, el('div', { class: 'map-tools' }, el('span', {}), el('div', { class: 'map-zoom', attrs: { role: 'group', 'aria-label': t('guessMap.zoom') } }, zoomIn, zoomOut)));
  return {
    node,
    host,
    attach(map: GuessMap): void {
      // a map on a page lets the page scroll past it; one that then takes pins (the editor's) takes every gesture again
      map.yieldToPage();
      zoomIn.addEventListener('click', () => map.zoomIn());
      zoomOut.addEventListener('click', () => map.zoomOut());
    },
  };
}
