import { language, t } from '../i18n/index.ts';
import type { Profile } from '../social/client.ts';
import { el, formatScore } from './dom.ts';

type HistoryPoint = Profile['history'][number];

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * How to write the days of a history: month and day while it covers under a year, which is every
 * range but a long "all time"; with the year, in the short all-number form, once a day and month
 * alone could mean two different days.
 */
function dayWriter(history: readonly HistoryPoint[]): (day: string) => string {
  const times = history.map((point) => utc(point.day).getTime());
  const overAYear = Math.max(...times) - Math.min(...times) >= YEAR_DAYS * DAY_MS;
  const format = new Intl.DateTimeFormat(language(), overAYear ? { dateStyle: 'short', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (day) => format.format(utc(day));
}

/** A day with nothing recorded is a dash, never a number made up. */
const cell = (value: number | null) => el('td', { class: 'num', text: value === null ? '—' : formatScore(value) });

function table(history: readonly HistoryPoint[]): HTMLElement {
  const written = dayWriter(history);
  // newest first: the day a reader looks for is most often a recent one
  const rows = [...history]
    .sort((a, b) => b.day.localeCompare(a.day))
    .map((point) => el('tr', {}, el('td', {}, el('time', { text: written(point.day), attrs: { datetime: point.day } })), cell(point.xp), cell(point.xpRank), cell(point.rating), cell(point.ratingRank)));
  // five columns have to fit a phone in every language: a place is headed "#", as on the boards, and named in full for a screen reader
  const place = (name: string) => el('th', { class: 'num', text: '#', attrs: { 'aria-label': name, title: name } });
  const head = el(
    'tr',
    {},
    el('th', { text: t('stats.date') }),
    el('th', { class: 'num', text: t('label.xp') }),
    place(t('chart.xpRank')),
    el('th', { class: 'num', text: t('leaderboards.column.rating') }),
    place(t('chart.ratingRank')),
  );
  return el('div', { class: 'account-table' }, el('table', { class: 'rounds' }, el('thead', {}, head), el('tbody', {}, ...rows)));
}

/**
 * The numbers behind the charts, day by day, for anyone who would rather read than look. Folded
 * away, and only built when it is first opened: all time is a year of rows.
 */
export function historyTable(history: readonly HistoryPoint[]): HTMLElement {
  const details = el('details', { class: 'chart-table' }, el('summary', { text: t('chart.table.show') }));
  details.addEventListener('toggle', () => {
    if (details.open && details.childElementCount === 1) {
      details.append(table(history));
    }
  });
  return details;
}
