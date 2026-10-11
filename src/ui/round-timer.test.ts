import { describe, expect, it } from 'vitest';
import { clock, timerState } from './round-timer.ts';

describe('timerState', () => {
  it('is calm with ten seconds or more', () => {
    expect(timerState(120)).toBe('calm');
    expect(timerState(10)).toBe('calm');
  });

  it('warns under ten seconds', () => {
    expect(timerState(9)).toBe('warn');
    expect(timerState(5)).toBe('warn');
  });

  it('is urgent under five, down to nothing', () => {
    expect(timerState(4)).toBe('urgent');
    expect(timerState(1)).toBe('urgent');
    expect(timerState(0)).toBe('urgent');
  });

  it('is calm when there is no clock to show', () => {
    expect(timerState(null)).toBe('calm');
  });
});

describe('clock', () => {
  it('writes seconds as minutes and two-digit seconds', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(75)).toBe('1:15');
    expect(clock(300)).toBe('5:00');
  });
});
