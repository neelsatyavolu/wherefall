import './daily.css';
import { againstAverage, type RoundAgainstAverage, type Standing } from '../daily/view.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { averageWords } from './daily-words.ts';
import { el, formatScore } from './dom.ts';
import { statusBox } from './status-box.ts';

/**
 * What a finished daily says beyond its score: a personal best, each round beside the day's
 * average for it, and, for a game the server could not take because the site was updated under
 * it, what happened and the way on. Shown on the daily pane and on the game's own summary.
 */

/** The mark of a total higher than every earlier daily of the account. */
export const personalBestMark = (): HTMLElement => el('span', { class: 'tag perfect daily-best', text: t('daily.personalBest') });

/** Which side of the average a round fell on: for the stylesheet and for a test, never the only sign of it. */
const sideOf = (diff: number): string => (diff > 0 ? 'above' : diff < 0 ? 'below' : 'level');

function averageRow({ round, score, diff }: RoundAgainstAverage): HTMLElement {
  return el(
    'li',
    { class: 'daily-average-row', attrs: { 'data-side': sideOf(diff) } },
    // the word and the number are two pieces of text: the word is the catalog's, the number nobody's
    el('span', { class: 'daily-average-round' }, t('label.round'), ' ', el('span', { text: formatNumber(round) })),
    el('span', { class: 'daily-average-score', text: formatScore(score) }),
    el('span', { class: 'daily-average-diff', text: averageWords(diff) }),
  );
}

/**
 * Each round beside the day's average for it: the round, its score, and how far above or below the
 * average that was, in words. Null until five players have finished: nothing is drawn then, not
 * even a heading over an empty list.
 */
export function averagesList(standing: Pick<Standing, 'rounds' | 'averages'>): HTMLElement | null {
  const rounds = againstAverage(standing);
  if (rounds === null) {
    return null;
  }
  return el(
    'section',
    { class: 'daily-averages', attrs: { 'aria-label': t('daily.average.title') } },
    el('h3', { class: 'label', text: t('daily.average.title') }),
    el('ol', { class: 'daily-average-rounds' }, ...rounds.map(averageRow)),
  );
}

/**
 * For a daily the server would not take because its places are no longer the day's: the site was
 * updated while the game was being played. Says so, says what the player will find (the attempt is
 * used), and offers the reload that brings the new version.
 */
export function staleNotice(reload: () => void): HTMLElement {
  const button = el('button', { class: 'button primary', text: t('daily.stale.reload'), attrs: { type: 'button' }, on: { click: reload } });
  // the line above it has already said, as a failure, that the result was not saved: this is what follows from it
  const box = statusBox('idle', t('status.note'), t('daily.stale.explain'), button);
  box.classList.add('daily-stale');
  return box;
}

/** The part of the daily's summary that fills in once the server has answered the save. */
export interface SummaryExtras {
  node: HTMLElement;
  /** The saved result's own standing: a personal best, and the rounds against the day's average where there is one. */
  showStanding: (standing: Pick<Standing, 'rounds' | 'averages' | 'personalBest'>) => void;
  /** The result could not be saved because the site was updated under the game. */
  showStale: () => void;
}

export function summaryExtras(reload: () => void = () => location.reload()): SummaryExtras {
  const node = el('div', { class: 'daily-extras' });
  node.hidden = true;
  const show = (...children: Array<HTMLElement | null>): void => {
    const shown = children.filter((child) => child !== null);
    node.replaceChildren(...shown);
    node.hidden = shown.length === 0;
  };
  return {
    node,
    showStanding: (standing) => show(standing.personalBest ? el('p', { class: 'daily-best-line' }, personalBestMark()) : null, averagesList(standing)),
    showStale: () => show(staleNotice(reload)),
  };
}
