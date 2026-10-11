import { describe, expect, it } from 'vitest';
import { createRng } from '../game/rng.ts';
import { confettiPieces } from './confetti.ts';

describe('confettiPieces', () => {
  const pieces = confettiPieces(40, createRng('party'));

  it('makes as many pieces as asked for', () => {
    expect(pieces).toHaveLength(40);
    expect(confettiPieces(0, createRng('party'))).toEqual([]);
  });

  it('throws them up and out to both sides, then lets them fall below where they began', () => {
    expect(pieces.every((piece) => piece.rise < 0 && piece.fall > 0)).toBe(true);
    expect(pieces.some((piece) => piece.drift < 0)).toBe(true);
    expect(pieces.some((piece) => piece.drift > 0)).toBe(true);
  });

  it('keeps every piece short-lived and in one of the three tones', () => {
    expect(pieces.every((piece) => piece.delay >= 0 && piece.delay <= 200)).toBe(true);
    expect(pieces.every((piece) => [0, 1, 2].includes(piece.tone))).toBe(true);
  });

  it('is the same burst for the same seed', () => {
    expect(confettiPieces(5, createRng('a'))).toEqual(confettiPieces(5, createRng('a')));
  });
});
