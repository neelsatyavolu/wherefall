import './daily.css';
import { DAILY_MAX_SCORE } from '../daily/client.ts';
import { distributionBars, type DistributionBar } from '../daily/view.ts';
import { t } from '../i18n/index.ts';
import { barLabel } from './daily-words.ts';
import { el, formatScore } from './dom.ts';

/** How tall the tallest bar is drawn. */
const PLOT_HEIGHT_PX = 88;
/** A bar with anyone in it is never drawn thinner than this, so one player among hundreds still shows. */
const MIN_BAR_PX = 2;

function barNode(bar: DistributionBar): HTMLElement {
  const fill = el('div', { class: 'daily-bar-fill' });
  fill.style.height = `${bar.count === 0 ? 0 : Math.max(MIN_BAR_PX, Math.round(bar.share * PLOT_HEIGHT_PX))}px`;
  const label = barLabel(bar);
  return el(
    'li',
    // the label is what a pointer resting on the bar shows, and what a screen reader says for it
    { class: bar.own ? 'daily-bar own' : 'daily-bar', attrs: { title: label } },
    bar.own ? el('span', { class: 'tag daily-bar-you', text: t('tag.you') }) : null,
    fill,
    el('span', { class: 'daily-sr', text: label }),
  );
}

/**
 * Today's scores as ten bars, lowest to highest, with the player's own bar in the accent and the
 * word "you" over it. Nothing while nobody has played.
 */
export function distributionChart(counts: readonly number[], ownScore: number | null): HTMLElement | null {
  const bars = distributionBars(counts, ownScore);
  if (bars.every((each) => each.count === 0)) {
    return null;
  }
  return el(
    'section',
    { class: 'daily-chart', attrs: { 'aria-label': t('daily.distribution') } },
    el('h3', { class: 'label', text: t('daily.distribution') }),
    el(
      'div',
      { class: 'daily-plot' },
      el('ol', { class: 'daily-bars' }, ...bars.map(barNode)),
      el('div', { class: 'daily-axis', attrs: { 'aria-hidden': 'true' } }, el('span', { text: formatScore(0) }), el('span', { text: formatScore(DAILY_MAX_SCORE) })),
    ),
  );
}
