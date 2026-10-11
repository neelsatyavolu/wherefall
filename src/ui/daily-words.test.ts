import { describe, expect, it } from 'vitest';
import { distributionBars, historyCells } from '../daily/view.ts';
import { averageWords, barLabel, cellLabel, countdownText, dailyShareText, dayName, streakWords } from './daily-words.ts';

const streak = (current: number, best: number, atRisk: boolean) => ({ current, best, atRisk });

describe('streakWords', () => {
  it('counts the days, singular and plural, and names the best', () => {
    expect(streakWords(streak(1, 12, false), 'done')).toMatchObject({ current: '1 day', best: 'Best: 12 days' });
    expect(streakWords(streak(5, 5, false), 'done')).toMatchObject({ current: '5 days', best: 'Best: 5 days' });
  });

  it('says a streak is at risk until today is played, and how to keep it', () => {
    expect(streakWords(streak(4, 9, true), 'open')).toMatchObject({ atRisk: true, note: 'Play today to keep it.' });
  });

  it('is kind about a day that can no longer be played', () => {
    expect(streakWords(streak(4, 9, true), 'started')).toMatchObject({ atRisk: true, note: 'Today will not count. One missed day in seven is forgiven.' });
  });

  it('says a streak is safe once today is played', () => {
    expect(streakWords(streak(5, 9, false), 'done')).toMatchObject({ atRisk: false, note: 'Safe for today.' });
  });

  it('invites a player with no streak to start one, while today can still be played', () => {
    expect(streakWords(streak(0, 3, false), 'open')).toMatchObject({ current: '0 days', atRisk: false, note: 'Play today to start one.' });
    expect(streakWords(streak(0, 3, true), 'started')).toMatchObject({ atRisk: false, note: '' });
  });
});

describe('countdownText', () => {
  it('writes hours, minutes and seconds, two digits each', () => {
    expect(countdownText(6 * 3_600_000)).toBe('06:00:00');
    expect(countdownText(3_723_400)).toBe('01:02:04');
    expect(countdownText(0)).toBe('00:00:00');
  });
});

describe('barLabel', () => {
  it('names the stretch of scores and how many players are in it', () => {
    const bars = distributionBars([0, 1, 0, 4, 8, 2, 0, 0, 1, 0], null);
    expect(barLabel(bars[1]!)).toBe('1,500 to 2,999: 1 player');
    expect(barLabel(bars[4]!)).toBe('6,000 to 7,499: 8 players');
    expect(barLabel(bars[9]!)).toBe('13,500 to 15,000: 0 players');
  });
});

describe('cellLabel', () => {
  const cells = historyCells(
    [
      { date: '2026-10-09', score: 9000 },
      { date: '2026-10-10', score: null },
      { date: '2026-10-11', score: null },
    ],
    '2026-10-11',
  );

  it('says what happened on a day: its score, or that it was missed', () => {
    expect(cellLabel(cells[0]!)).toBe('October 9: score 9,000');
    expect(cellLabel(cells[1]!)).toBe('October 10: not played');
  });

  it('says today is today, played or not', () => {
    expect(cellLabel(cells[2]!)).toBe('Today: not played yet');
    expect(cellLabel({ ...cells[2]!, score: 11_250, state: 'played' })).toBe('Today: score 11,250');
  });
});

describe('averageWords', () => {
  it('says how far above the average a round was, with its sign', () => {
    expect(averageWords(320)).toBe('+320 above average');
    expect(averageWords(1)).toBe('+1 above average');
  });

  it('says how far below, with its sign and its thousands', () => {
    expect(averageWords(-180)).toBe('-180 below average');
    expect(averageWords(-2450)).toBe('-2,450 below average');
  });

  it('says a round on the average is level with it, with no number to misread', () => {
    expect(averageWords(0)).toBe('Level with the average');
  });
});

describe('dayName', () => {
  it('writes a UTC day in words, and leaves alone what is no day', () => {
    expect(dayName('2026-10-11')).toBe('October 11, 2026');
    expect(dayName('soon')).toBe('soon');
  });
});

describe('dailyShareText', () => {
  const result = { date: '2026-10-11', score: 11_250, maxScore: 15_000, rounds: [4800, 3950, 2500] };
  const URL = 'https://plonk.test/#daily';

  it('has the date, the score out of 15,000, the share beaten, a square a round and the link', () => {
    expect(dailyShareText({ ...result, beat: 50 }, URL)).toBe(['Wherefall daily challenge · October 11, 2026', '11,250 / 15,000', 'Beat 50% of players', '🟩🟨🟨', URL].join('\n'));
  });

  it('colours each round by how it went', () => {
    expect(dailyShareText({ ...result, rounds: [5000, 900, 0], beat: 12 }, URL).split('\n')[3]).toBe('🟩🟥🟥');
    expect(dailyShareText({ ...result, rounds: [2500, 1000, 4000], beat: 12 }, URL).split('\n')[3]).toBe('🟨🟧🟩');
  });

  it('leaves the line out where nobody was beaten, or nobody knows (a visitor)', () => {
    expect(dailyShareText({ ...result, beat: 0 }, URL).split('\n')).toHaveLength(4);
    expect(dailyShareText({ ...result, beat: null }, URL)).toBe(['Wherefall daily challenge · October 11, 2026', '11,250 / 15,000', '🟩🟨🟨', URL].join('\n'));
  });
});
