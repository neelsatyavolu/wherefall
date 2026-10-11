import { describe, expect, it } from 'vitest';
import { chartLine, nearestSlot } from './chart.ts';

const box = { width: 300, height: 100, pad: 10 };

describe('chartLine', () => {
  it('has nothing to draw for fewer than two points', () => {
    expect(chartLine([], box)).toBeNull();
    expect(chartLine([{ day: '2026-10-01', value: 5 }], box)).toBeNull();
  });

  it('runs from the first day at the left to the last at the right, low values at the bottom', () => {
    const line = chartLine(
      [
        { day: '2026-10-01', value: 100 },
        { day: '2026-10-02', value: 300 },
        { day: '2026-10-03', value: 200 },
      ],
      box,
    )!;
    expect(line.points).toEqual([
      { x: 10, y: 90 },
      { x: 150, y: 10 },
      { x: 290, y: 50 },
    ]);
    expect(line.path).toBe('M10 90 L150 10 L290 50');
    expect(line).toMatchObject({ min: 100, max: 300, first: '2026-10-01', last: '2026-10-03' });
  });

  it('places points by date, so a gap of days is a gap on the line', () => {
    const line = chartLine(
      [
        { day: '2026-10-01', value: 0 },
        { day: '2026-10-02', value: 10 },
        { day: '2026-10-11', value: 20 },
      ],
      box,
    )!;
    expect(line.points.map((point) => point.x)).toEqual([10, 38, 290]);
  });

  it('draws a level line through the middle when the value never changed', () => {
    const line = chartLine(
      [
        { day: '2026-10-01', value: 1000 },
        { day: '2026-10-05', value: 1000 },
      ],
      box,
    )!;
    expect(line.points.map((point) => point.y)).toEqual([50, 50]);
  });

  it('puts the days in order whatever order they came in', () => {
    const line = chartLine(
      [
        { day: '2026-10-03', value: 3 },
        { day: '2026-10-01', value: 1 },
      ],
      box,
    )!;
    expect(line.first).toBe('2026-10-01');
    expect(line.points[0]).toEqual({ x: 10, y: 90 });
  });
});

describe('chartLine with days that have no value', () => {
  const ranks = [
    { day: '2026-10-01', value: null },
    { day: '2026-10-02', value: null },
    { day: '2026-10-03', value: 3 },
    { day: '2026-10-04', value: 1 },
    { day: '2026-10-05', value: 2 },
  ];

  it('keeps a place for every day and draws only the recorded ones', () => {
    const line = chartLine(ranks, box)!;
    expect(line.slots.map((slot) => slot.x)).toEqual([10, 80, 150, 220, 290]);
    expect(line.slots.map((slot) => slot.value)).toEqual([null, null, 3, 1, 2]);
    expect(line.slots.slice(0, 2).map((slot) => slot.y)).toEqual([null, null]);
    expect(line.points).toHaveLength(3);
    // the line starts where the values start: nothing is drawn across the days before
    expect(line.path).toBe('M150 10 L220 90 L290 50');
    expect(line).toMatchObject({ start: '2026-10-01', end: '2026-10-05', first: '2026-10-03', last: '2026-10-05' });
  });

  it('breaks the line at a gap in the middle, and marks a day that stands alone', () => {
    const line = chartLine(
      [
        { day: '2026-10-01', value: 10 },
        { day: '2026-10-02', value: 20 },
        { day: '2026-10-03', value: null },
        { day: '2026-10-04', value: 30 },
        { day: '2026-10-05', value: null },
        { day: '2026-10-06', value: 10 },
        { day: '2026-10-07', value: 30 },
      ],
      box,
    )!;
    expect(line.path).toBe('M10 90 L56.7 50 M243.3 90 L290 10');
    expect(line.lone).toEqual([{ x: 150, y: 10 }]);
  });

  it('has nothing to draw when no day has a value', () => {
    expect(chartLine([{ day: '2026-10-01', value: null }, { day: '2026-10-02', value: null }], box)).toBeNull();
  });

  it('draws one recorded day among several as a point with no line', () => {
    const line = chartLine([{ day: '2026-10-01', value: null }, { day: '2026-10-02', value: 7 }], box)!;
    expect(line.path).toBe('');
    expect(line.lone).toEqual([{ x: 290, y: 50 }]);
  });
});

describe('chartLine for a rank', () => {
  const ranks = [
    { day: '2026-10-01', value: 5 },
    { day: '2026-10-02', value: 1 },
    { day: '2026-10-03', value: 3 },
  ];

  it('puts the best place, the lowest number, at the top', () => {
    const line = chartLine(ranks, box, { inverted: true })!;
    expect(line.points.map((point) => point.y)).toEqual([90, 10, 50]);
    expect(line).toMatchObject({ top: 1, bottom: 5, min: 1, max: 5 });
  });

  it('puts the highest value at the top of any other chart', () => {
    expect(chartLine(ranks, box)).toMatchObject({ top: 5, bottom: 1 });
  });
});

describe('nearestSlot', () => {
  const line = chartLine(
    [
      { day: '2026-10-01', value: 1 },
      { day: '2026-10-02', value: null },
      { day: '2026-10-03', value: 3 },
    ],
    box,
  )!;

  it('finds the day closest to a place across the chart, recorded or not', () => {
    expect(nearestSlot(line, 0)).toBe(0);
    expect(nearestSlot(line, 79)).toBe(0);
    expect(nearestSlot(line, 81)).toBe(1);
    expect(nearestSlot(line, 160)).toBe(1);
    expect(nearestSlot(line, 400)).toBe(2);
  });
});
