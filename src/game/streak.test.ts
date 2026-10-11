import { describe, expect, it } from 'vitest';
import { MAX_STREAK, judge, newRun } from './streak.ts';

describe('a country streak', () => {
  it('starts at nothing', () => {
    expect(newRun()).toEqual({ streak: 0, over: false, answer: null, guessed: null });
  });

  it('grows by one for the right country', () => {
    const run = judge(judge(newRun(), 'FR', 'FR'), 'JP', 'JP');
    expect(run).toEqual({ streak: 2, over: false, answer: 'JP', guessed: 'JP' });
  });

  it('ends on the wrong country and keeps both for showing', () => {
    const run = judge(judge(newRun(), 'FR', 'FR'), 'JP', 'KR');
    expect(run).toEqual({ streak: 1, over: true, answer: 'JP', guessed: 'KR' });
  });

  it('ends when no country was picked, such as the sea or a timeout', () => {
    expect(judge(newRun(), 'FR', null)).toEqual({ streak: 0, over: true, answer: 'FR', guessed: null });
  });

  it('does not change the run it was given, and a finished run stays finished', () => {
    const start = newRun();
    judge(start, 'FR', 'FR');
    expect(start.streak).toBe(0);
    const over = judge(start, 'FR', 'DE');
    expect(judge(over, 'FR', 'FR')).toBe(over);
  });

  it('stops at the longest streak the server takes', () => {
    const nearly = { streak: MAX_STREAK - 1, over: false, answer: null, guessed: null };
    expect(judge(nearly, 'FR', 'FR')).toEqual({ streak: MAX_STREAK, over: true, answer: 'FR', guessed: 'FR' });
    expect(MAX_STREAK).toBe(500);
  });
});
