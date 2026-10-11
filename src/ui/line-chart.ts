import './social.css';
import { chartLine, nearestSlot, type ChartLine, type ChartPoint, type ChartSlot } from '../game/chart.ts';
import { language, t } from '../i18n/index.ts';
import type { Profile } from '../social/client.ts';
import { historyTable } from './chart-table.ts';
import { el, formatScore } from './dom.ts';

/** One day of a player's history: XP, rating and the places on both boards, which are null for days before they were kept. */
export type HistoryPoint = Profile['history'][number];

const WIDTH = 320;
const HEIGHT = 96;
const PAD = 8;
/** the side of the square that marks a point */
const MARK = 8;
const SVG = 'http://www.w3.org/2000/svg';

export const shortDay = (day: string) => new Intl.DateTimeFormat(language(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

/** A day written out, which a screen reader and the language check can both tell is a date. */
export const dayLabel = (day: string) => el('time', { text: shortDay(day), attrs: { datetime: day } });

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  return node;
}

const square = (name: string, at: { x: number; y: number }) => svg('rect', { class: name, x: String(at.x - MARK / 2), y: String(at.y - MARK / 2), width: String(MARK), height: String(MARK) });

interface Series {
  name: string;
  points: readonly ChartPoint[];
  /** a place on a board: lower is better, so the chart runs with the best place at the top */
  rank: boolean;
  /**
   * Where the same figure stands now, when the page says so somewhere else too (a stat cell). Null
   * is "on no board now". Left out for a series the page has no second reading of.
   */
  live?: number | null;
}

/**
 * What the page knows of where the player stands at this moment, beside the history. Only the
 * place on the rating board needs it: XP and rating are written into the day's point by the very
 * statement that changes them, so their latest point is the live figure, but a place also moves
 * when other players do, and is only recorded when the player's own rating changes.
 */
export interface LiveFigures {
  /** the place on the all-time rating board, or null when the player is not on it */
  ratingRank: number | null;
}

/**
 * The line under a chart whose latest point is not what the page shows as the figure now: which
 * day the point is of, why it can lag, and the figure now. Null when the two agree.
 */
function lagNote(series: Series, latest: ChartSlot): HTMLElement | null {
  if (series.live === undefined || series.live === latest.value) {
    return null;
  }
  const day = shortDay(latest.day);
  const text = series.live === null ? t('chart.rankLag.off', { day }) : t('chart.rankLag', { day, rank: formatScore(series.live) });
  return el('p', { class: 'fine chart-lag', text });
}

/** What a chart says to someone who cannot see it: the days it covers, its extremes, and where it stands now. */
function summary(series: Series, line: ChartLine, latest: number): string {
  const days = { name: series.name, first: shortDay(line.first), last: shortDay(line.last), now: formatScore(latest) };
  return series.rank
    ? t('chart.summary.rank', { ...days, best: formatScore(line.min), worst: formatScore(line.max) })
    : t('chart.summary', { ...days, min: formatScore(line.min), max: formatScore(line.max) });
}

const STEPS: Record<string, (at: number | null, last: number) => number | null> = {
  ArrowLeft: (at, last) => Math.max(0, (at ?? last + 1) - 1),
  ArrowRight: (at, last) => Math.min(last, (at ?? -1) + 1),
  Home: () => 0,
  End: (_at, last) => last,
  Escape: () => null,
};

/**
 * Lets a pointer, or the arrow keys, read the chart day by day: a hairline snaps to the nearest day
 * and `show` is told which, or null once the pointer or the focus has gone.
 */
function readable(picture: SVGElement, line: ChartLine, show: (slot: ChartSlot | null) => void): void {
  const cross = svg('line', { class: 'chart-cross', y1: '0', y2: String(HEIGHT) });
  const mark = square('chart-mark', { x: 0, y: 0 });
  let at: number | null = null;
  const point = (index: number | null) => {
    at = index;
    const slot = index === null ? null : line.slots[index]!;
    cross.style.display = slot ? '' : 'none';
    mark.style.display = slot && slot.y !== null ? '' : 'none';
    if (slot) {
      cross.setAttribute('x1', String(slot.x));
      cross.setAttribute('x2', String(slot.x));
      mark.setAttribute('x', String(slot.x - MARK / 2));
      mark.setAttribute('y', String((slot.y ?? 0) - MARK / 2));
    }
    show(slot);
  };
  const follow = (event: PointerEvent) => {
    const box = picture.getBoundingClientRect();
    point(nearestSlot(line, ((event.clientX - box.left) / box.width) * WIDTH));
  };
  picture.addEventListener('pointermove', follow as EventListener);
  picture.addEventListener('pointerdown', follow as EventListener);
  picture.addEventListener('pointerleave', () => point(null));
  picture.addEventListener('blur', () => point(null));
  picture.addEventListener('keydown', (event) => {
    const step = STEPS[(event as KeyboardEvent).key];
    if (step) {
      event.preventDefault();
      point(step(at, line.slots.length - 1));
    }
  });
  picture.append(cross, mark);
  point(null);
}

/** The values at the top and the bottom of the chart; one in the middle for a value that never changed. */
function axis(line: ChartLine): HTMLElement {
  const labels = line.top === line.bottom ? [formatScore(line.top)] : [formatScore(line.top), formatScore(line.bottom)];
  return el('div', { class: labels.length === 1 ? 'chart-axis level-line' : 'chart-axis' }, ...labels.map((text) => el('span', { text })));
}

/**
 * One small line chart: its name, the latest value recorded with its day (or the value on the day
 * being read), the two ends of its axis, the line, and the days it covers. The server writes a
 * day's point in the same statement that changes the XP or the rating, so the latest point is where
 * the player stands now; a place on a board can have moved since, and then the chart says so under
 * its line (`lagNote`). A series with nothing recorded says so.
 */
function lineChart(series: Series): HTMLElement {
  const line = chartLine(series.points, { width: WIDTH, height: HEIGHT, pad: PAD }, { inverted: series.rank });
  const name = el('span', { class: 'label', text: series.name });
  if (!line) {
    return el('figure', { class: 'chart' }, el('figcaption', { class: 'chart-head' }, name), el('p', { class: 'fine', text: t('chart.noRanks') }));
  }
  const latest = line.slots.filter((slot) => slot.value !== null).at(-1)!;
  const now = el('span', { class: 'chart-now', text: formatScore(latest.value ?? 0) });
  // the headline always says which day its figure is of: the latest one recorded, until a day is being read
  const when = el('span', { class: 'chart-when' }, dayLabel(latest.day));
  const picture = svg('svg', { class: 'chart-line', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', tabindex: '0', 'aria-label': summary(series, line, latest.value ?? 0) });
  picture.append(
    svg('line', { class: 'chart-rule', x1: '0', x2: String(WIDTH), y1: String(HEIGHT - 0.5), y2: String(HEIGHT - 0.5) }),
    svg('path', { class: 'chart-path', d: line.path }),
    ...line.lone.map((spot) => square('chart-end', spot)),
    square('chart-end', { x: latest.x, y: latest.y ?? 0 }),
  );
  readable(picture, line, (slot) => {
    when.replaceChildren(dayLabel((slot ?? latest).day));
    const value = slot ? slot.value : latest.value;
    now.textContent = value === null ? t('chart.unrecorded') : formatScore(value);
    now.classList.toggle('unrecorded', value === null);
  });
  return el(
    'figure',
    { class: 'chart' },
    el('figcaption', { class: 'chart-head' }, name, el('span', { class: 'chart-read' }, when, now)),
    el('div', { class: 'chart-plot' }, axis(line), picture),
    el('p', { class: 'chart-range' }, dayLabel(line.start), dayLabel(line.end)),
    lagNote(series, latest),
  );
}

/** Says where the rank lines start, when the history reaches back past the day ranks were first kept. */
function gapNote(history: readonly HistoryPoint[]): HTMLElement | null {
  const days = [...history].sort((a, b) => a.day.localeCompare(b.day));
  const first = days.findIndex((point) => point.xpRank !== null || point.ratingRank !== null);
  return first > 0 ? el('p', { class: 'fine', text: t('chart.ranksFrom', { day: shortDay(days[first]!.day) }) }) : null;
}

/**
 * XP, the place on the XP board, rating and the place on the rating board, each as a small chart
 * of its own with its own scale, then the same numbers as a table. With fewer than two days there
 * is no line to draw, and it says so rather than draw empty boxes.
 */
export function chartsBody(history: readonly HistoryPoint[], live?: LiveFigures): HTMLElement[] {
  if (history.length < 2) {
    return [el('p', { class: 'prose', text: t('chart.empty') })];
  }
  const series = (name: string, value: (point: HistoryPoint) => number | null, rank = false): Series => ({ name, rank, points: history.map((point) => ({ day: point.day, value: value(point) })) });
  const ratingRank: Series = { ...series(t('chart.ratingRank'), (point) => point.ratingRank, true), ...(live ? { live: live.ratingRank } : {}) };
  const charts = el(
    'div',
    { class: 'charts four' },
    lineChart(series(t('label.xp'), (point) => point.xp)),
    lineChart(series(t('chart.xpRank'), (point) => point.xpRank, true)),
    lineChart(series(t('label.rating'), (point) => point.rating)),
    lineChart(ratingRank),
  );
  return [charts, gapNote(history), historyTable(history)].filter((node) => node !== null);
}

export interface ProgressFrame {
  node: HTMLElement;
  /** draws a history in place of what is there */
  show: (history: readonly HistoryPoint[]) => void;
  /** dims what is drawn while another range is on its way (`true`), or brings it back when none came */
  hold: (waiting: boolean) => void;
}

/**
 * The frame a player's progress is drawn in: its heading, then `controls` (the choice of how far
 * back to look, which scopes everything under it), then the charts.
 */
export function progressFrame(controls: Node | null = null, live?: LiveFigures): ProgressFrame {
  const body = el('div', { class: 'chart-body' });
  const hold = (waiting: boolean) => {
    body.classList.toggle('stale', waiting);
    body.setAttribute('aria-busy', String(waiting));
  };
  return {
    node: el('section', { class: 'account-section', attrs: { 'aria-label': t('chart.label') } }, el('h3', { class: 'label', text: t('chart.title') }), controls, body),
    show: (history) => {
      hold(false);
      body.replaceChildren(...chartsBody(history, live));
    },
    hold,
  };
}

/** A player's progress over the days of one history, as it came. `live` is what the page around it shows as the figures now. */
export function progressCharts(history: readonly HistoryPoint[], live?: LiveFigures): HTMLElement {
  const frame = progressFrame(null, live);
  frame.show(history);
  return frame.node;
}
