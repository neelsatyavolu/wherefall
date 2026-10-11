import { describe, expect, it } from 'vitest';
import { shareSquare, shareSquares, shareText } from './share.ts';

describe('shareSquare', () => {
  it('colours a round by its share of the most it could score', () => {
    expect(shareSquare(5000, 5000)).toBe('🟩');
    expect(shareSquare(4000, 5000)).toBe('🟩');
    expect(shareSquare(3999, 5000)).toBe('🟨');
    expect(shareSquare(2500, 5000)).toBe('🟨');
    expect(shareSquare(2499, 5000)).toBe('🟧');
    expect(shareSquare(1000, 5000)).toBe('🟧');
    expect(shareSquare(999, 5000)).toBe('🟥');
    expect(shareSquare(0, 5000)).toBe('🟥');
  });

  it('works for rounds scored out of something else', () => {
    expect(shareSquare(1000, 1000)).toBe('🟩');
    expect(shareSquare(0, 1000)).toBe('🟥');
  });
});

describe('shareSquares', () => {
  it('is one square a round, in order', () => {
    expect(shareSquares([5000, 3000, 1200, 0], 5000)).toBe('🟩🟨🟧🟥');
  });
});

describe('shareText', () => {
  const game = { title: 'Wherefall · World', score: 18_450, maxScore: 25_000, roundScores: [5000, 4700, 3900, 2850, 2000], url: 'https://plonk.test/?map=world&seed=abc' };

  it('has the title, the score out of the most, a square a round, and the link', () => {
    expect(shareText(game)).toBe(['Wherefall · World', '18450 / 25000', '🟩🟩🟨🟨🟧', 'https://plonk.test/?map=world&seed=abc'].join('\n'));
  });

  it('writes numbers the way it is told to', () => {
    const text = shareText({ ...game, formatNumber: (value) => value.toLocaleString('en-US') });
    expect(text.split('\n')[1]).toBe('18,450 / 25,000');
  });

  it('puts extra lines after the score, and leaves empty ones out', () => {
    const text = shareText({ ...game, extra: ['Beat 62% of players', ''] });
    expect(text.split('\n')).toEqual(['Wherefall · World', '18450 / 25000', 'Beat 62% of players', '🟩🟩🟨🟨🟧', 'https://plonk.test/?map=world&seed=abc']);
  });

  it('goes by each round out of 5,000 unless told otherwise', () => {
    expect(shareText({ ...game, roundScores: [1000, 0], roundMax: 1000 }).split('\n')[2]).toBe('🟩🟥');
  });
});
