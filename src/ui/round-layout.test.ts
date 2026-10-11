import { describe, expect, it } from 'vitest';
import { changedSides, paddingFor } from './round-layout.ts';

const DESKTOP = { width: 1360, height: 840 };
const PHONE = { width: 390, height: 800 };
/** where the HUD ends on each */
const HUD_FOOT = { desktop: 72, phone: 60 };

describe('paddingFor', () => {
  it('keeps pins beside a panel in the rail of a wide screen, and a margin in from the other edges', () => {
    const rail = { left: 16, top: 88, right: 456, bottom: 500 };
    expect(paddingFor(rail, HUD_FOOT.desktop, DESKTOP)).toEqual({ top: 64, right: 64, bottom: 64, left: 488 });
  });

  it('keeps pins above a panel that stands in the middle of the foot of a wide screen', () => {
    const buttons = { left: 320, top: 600, right: 1040, bottom: 816 };
    expect(paddingFor(buttons, HUD_FOOT.desktop, DESKTOP)).toEqual({ top: 64, right: 64, bottom: 272, left: 64 });
  });

  it('keeps pins beside a panel that stands at the right of a wide screen, where the guess map is in other games', () => {
    const answers = { left: 1024, top: 420, right: 1344, bottom: 824 };
    expect(paddingFor(answers, HUD_FOOT.desktop, DESKTOP)).toEqual({ top: 64, right: 368, bottom: 64, left: 64 });
  });

  it('leaves room for the map beside a panel at the right, however wide the panel', () => {
    const wide = { left: 560, top: 420, right: 1344, bottom: 824 };
    expect(paddingFor(wide, HUD_FOOT.desktop, DESKTOP).right).toBe(DESKTOP.width * 0.6);
  });

  it('clears a sheet that runs from edge to edge of a phone, as the guessers’ buttons do', () => {
    const docked = { left: 0, top: 560, right: 390, bottom: 800 };
    expect(paddingFor(docked, HUD_FOOT.phone, PHONE)).toEqual({ top: 84, right: 64, bottom: 272, left: 64 });
  });

  it("keeps pins above a phone's sheet and under its HUD, which runs the width of the screen", () => {
    const sheet = { left: 16, top: 424, right: 374, bottom: 784 };
    expect(paddingFor(sheet, HUD_FOOT.phone, PHONE)).toEqual({ top: 84, right: 64, bottom: 408, left: 64 });
  });

  it('clears the whole of a sheet as tall as a sheet gets: the map is fitted to what is left, however little', () => {
    const tall = { left: 16, top: 304, right: 374, bottom: 784 };
    const padding = paddingFor(tall, HUD_FOOT.phone, PHONE);
    expect(PHONE.height - padding.bottom).toBeLessThan(tall.top);
  });
});

describe('changedSides', () => {
  const before = { top: 84, right: 64, bottom: 408, left: 64 };

  it('is empty when nothing moved', () => {
    expect(changedSides(before, { ...before })).toEqual({});
  });

  it('is the sides that moved, and no others: what a match adds to the top stays as it was set', () => {
    expect(changedSides(before, { ...before, bottom: 448 })).toEqual({ bottom: 448 });
    expect(changedSides(before, { top: 64, right: 64, bottom: 64, left: 488 })).toEqual({ top: 64, bottom: 64, left: 488 });
  });
});
