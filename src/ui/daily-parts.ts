import './daily.css';
import './status.css';
import type { DailyState } from '../daily/client.ts';
import { historyCells, remainingMs, type HistoryCell, type Standing } from '../daily/view.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { describeSettings } from './choice-row.ts';
import { averagesList, personalBestMark } from './daily-extras.ts';
import { beatLine, cellLabel, countdownText, dayInDigits, dayName, streakWords, type StreakWords } from './daily-words.ts';
import { el, formatScore } from './dom.ts';
import { factLine } from './pane.ts';
import { figure } from './panels.ts';

/** The pieces of the daily pane that only show what they are given. */

const TICK_MS = 1000;
/** After the countdown ends the pane waits this long before asking for the new day, so the server's day has turned too. */
const REOPEN_MS = 1500;

interface Countdown {
  node: HTMLElement;
  stop: () => void;
}

/**
 * The time left until the next daily, counted from the server's clock and ticking by this browser's.
 * `onOpen` is called once when it runs out. Null when the server's times cannot be read.
 */
export function countdown(daily: DailyState, onOpen: () => void): Countdown | null {
  const began = performance.now();
  const left = () => remainingMs(daily.nextAt, daily.serverNow, performance.now() - began);
  const first = left();
  if (first === null) {
    return null;
  }
  const node = el('span', { class: 'daily-clock', text: countdownText(first), attrs: { role: 'timer' } });
  let ticker: number | undefined;
  let reopen: number | undefined;
  const stop = () => {
    clearInterval(ticker);
    clearTimeout(reopen);
  };
  if (first > 0) {
    ticker = window.setInterval(() => {
      const ms = left() ?? 0;
      node.textContent = countdownText(ms);
      if (ms === 0) {
        clearInterval(ticker);
        reopen = window.setTimeout(onOpen, REOPEN_MS);
      }
    }, TICK_MS);
  }
  return { node, stop };
}

/** The day, its fixed settings, and the wait for the next one. */
export function headFacts(daily: DailyState, clock: HTMLElement | null): HTMLElement {
  return el(
    'div',
    { class: 'daily-head' },
    el('div', { class: 'daily-facts' }, figure(t('daily.today'), dayName(daily.date)), factLine(describeSettings(daily.settings)), factLine(t('daily.rule'))),
    clock ? figure(t('daily.next'), clock) : null,
  );
}

/**
 * The viewer's result: the score out of the most, marked when it is the account's best yet, the
 * rank where there is one, how many players it beat, and each round against the day's average once
 * there is one.
 */
export function resultFigures(standing: Standing): HTMLElement[] {
  const beat = beatLine(standing.beat);
  const averages = averagesList(standing);
  return [
    el(
      'div',
      { class: 'figures' },
      figure(t('daily.yourResult'), formatScore(standing.score), ` / ${formatScore(standing.maxScore)}`, standing.personalBest ? personalBestMark() : null),
      standing.rank === null ? null : figure(t('daily.rank'), formatNumber(standing.rank)),
    ),
    ...(beat ? [el('p', { class: 'prose daily-beat', text: beat })] : []),
    ...(averages ? [averages] : []),
  ];
}

/**
 * Where the streak stands, in a sentence under the figures. While today can still break it the
 * sentence is a status, as DESIGN.md has one: a dot, "at risk" in mono, then what to do about it.
 */
function streakNote(words: StreakWords): HTMLElement | null {
  if (words.note === '') {
    return null;
  }
  if (!words.atRisk) {
    return el('p', { class: 'fine daily-streak-note', text: words.note });
  }
  return el(
    'p',
    { class: 'status-note daily-streak-note', attrs: { 'data-state': 'live' } },
    el('span', { class: 'status-dot', attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: 'status-body' }, el('span', { class: 'status-word daily-streak-risk', text: t('daily.streak.risk') }), words.note),
  );
}

/** An account's streak and records as figures sharing hairlines. Null for a visitor or a guest, who has neither. */
export function recordGrid(daily: DailyState, state: DailyState['state']): HTMLElement | null {
  if (!daily.records) {
    return null;
  }
  const words = streakWords(daily.streak, state);
  // two lines in every language: the streak, then the best one. That it is at risk is said under the grid, where there is room for it
  const streak = figure(t('label.streak'), el('span', { class: 'daily-streak-count', text: words.current }), words.best);
  const grid = el(
    'div',
    { class: 'account-stats' },
    streak,
    figure(t('daily.played'), formatNumber(daily.records.played)),
    figure(t('daily.best'), formatScore(daily.records.best)),
    figure(t('daily.average'), formatScore(daily.records.average)),
  );
  grid.style.setProperty('--stat-columns', '4');
  return el(
    'section',
    { class: 'daily-record', attrs: { 'aria-label': t('daily.record') } },
    el('h3', { class: 'label', text: t('daily.record') }),
    grid,
    streakNote(words),
  );
}

const MISSED = '–';
const OPEN = '·';

function dayCell(cell: HistoryCell): HTMLElement {
  const label = cellLabel(cell);
  const shown = cell.score !== null ? formatScore(cell.score) : cell.state === 'open' ? OPEN : MISSED;
  return el(
    'li',
    { class: `daily-day ${cell.state}${cell.today ? ' today' : ''}`, attrs: { title: label } },
    el('span', { class: 'daily-day-date', text: dayInDigits(cell.date), attrs: { 'aria-hidden': 'true' } }),
    // on a phone the score is written without its thousands separator, which the cell has no room for (see daily.css)
    el('span', { class: 'daily-day-score', text: shown, attrs: { 'aria-hidden': 'true', ...(cell.score !== null ? { 'data-short': String(cell.score) } : {}) } }),
    el('span', { class: 'daily-sr', text: label }),
  );
}

/** The last 14 days, a cell a day: played with its score, missed, and today. Null when there is no history to show. */
export function historyStrip(history: DailyState['history'], today: string): HTMLElement | null {
  const cells = historyCells(history, today);
  if (cells.length === 0) {
    return null;
  }
  return el(
    'section',
    { class: 'daily-days-section', attrs: { 'aria-label': t('daily.history') } },
    el('h3', { class: 'label', text: t('daily.history') }),
    el('ol', { class: 'daily-days' }, ...cells.map(dayCell)),
  );
}
