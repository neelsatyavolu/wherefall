/** The geometry of a small line chart: where each point of a daily series falls in a box. No DOM in here. */

export interface ChartPoint {
  /** YYYY-MM-DD */
  day: string;
  /** null for a day nothing was recorded on: it keeps its place across the chart and the line stops there */
  value: number | null;
}

export interface ChartBox {
  width: number;
  height: number;
  /** room kept clear inside every edge */
  pad: number;
}

export interface ChartOptions {
  /** for a place on a board, where lower is better: the lowest number is drawn at the top */
  inverted?: boolean;
}

export interface Spot {
  x: number;
  y: number;
}

/** One day of the series: where it falls across the chart and, when it has a value, how high. */
export interface ChartSlot {
  day: string;
  x: number;
  y: number | null;
  value: number | null;
}

export interface ChartLine {
  /** every day of the series, oldest first, recorded or not */
  slots: ChartSlot[];
  /** the recorded days only */
  points: Spot[];
  /** the line as an SVG path: one stretch for each run of recorded days, nothing across a gap */
  path: string;
  /** recorded days with no recorded neighbour: a run of one, which no line shows */
  lone: Spot[];
  min: number;
  max: number;
  /** the values at the top and at the bottom of the chart */
  top: number;
  bottom: number;
  /** the first and the last day with a value */
  first: string;
  last: string;
  /** the first and the last day of the series */
  start: string;
  end: string;
}

const round = (value: number) => Math.round(value * 10) / 10;
const time = (day: string) => Date.parse(`${day}T00:00:00Z`);
const recorded = (slot: ChartSlot): slot is ChartSlot & { y: number; value: number } => slot.value !== null;

/** Splits the days into runs of recorded ones: a day with no value ends a run. */
function runs(slots: readonly ChartSlot[]): Spot[][] {
  const found: Spot[][] = [[]];
  for (const slot of slots) {
    if (recorded(slot)) {
      found[found.length - 1]!.push({ x: slot.x, y: slot.y });
    } else {
      found.push([]);
    }
  }
  return found.filter((run) => run.length > 0);
}

const pathOf = (run: readonly Spot[]) => run.map((spot, index) => `${index === 0 ? 'M' : 'L'}${spot.x} ${spot.y}`).join(' ');

/**
 * Places a series in a box: days run left to right by date, values bottom to top between the
 * lowest and the highest (top to bottom when `inverted`). A day with no value is a gap in the line,
 * never a point made up. Null when there are fewer than two days or no value at all, which is no
 * line to draw.
 */
export function chartLine(series: readonly ChartPoint[], box: ChartBox, options: ChartOptions = {}): ChartLine | null {
  const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
  const values = sorted.map((point) => point.value).filter((value) => value !== null);
  if (sorted.length < 2 || values.length === 0) {
    return null;
  }
  const [start, end] = [time(sorted[0]!.day), time(sorted[sorted.length - 1]!.day)];
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const innerWidth = box.width - box.pad * 2;
  const innerHeight = box.height - box.pad * 2;
  /** how far down the box a value sits, 0 at the top to 1 at the bottom; a value that never changed is a level line through the middle */
  const depth = (value: number) => (max === min ? 0.5 : options.inverted ? (value - min) / (max - min) : 1 - (value - min) / (max - min));
  const slots = sorted.map((point) => ({
    day: point.day,
    x: round(box.pad + (end === start ? 0.5 : (time(point.day) - start) / (end - start)) * innerWidth),
    y: point.value === null ? null : round(box.pad + depth(point.value) * innerHeight),
    value: point.value,
  }));
  const stretches = runs(slots);
  const known = slots.filter(recorded);
  return {
    slots,
    points: known.map(({ x, y }) => ({ x, y })),
    path: stretches.filter((run) => run.length > 1).map(pathOf).join(' '),
    lone: stretches.filter((run) => run.length === 1).map((run) => run[0]!),
    min,
    max,
    top: options.inverted ? min : max,
    bottom: options.inverted ? max : min,
    first: known[0]!.day,
    last: known[known.length - 1]!.day,
    start: sorted[0]!.day,
    end: sorted[sorted.length - 1]!.day,
  };
}

/** The day nearest to a place across the chart, as its index in `slots`: what a pointer over the chart is reading. */
export function nearestSlot(line: ChartLine, x: number): number {
  return line.slots.reduce((best, slot, index) => (Math.abs(slot.x - x) < Math.abs(line.slots[best]!.x - x) ? index : best), 0);
}
