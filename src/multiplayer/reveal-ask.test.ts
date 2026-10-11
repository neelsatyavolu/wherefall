import { describe, expect, it } from 'vitest';
import { POLL_MS, pollInterval } from './poll.ts';
import { REVEAL_ASK, askAfterReveal, revealKey } from './reveal-ask.ts';
import { NOW, PLACES, at, matchState } from './testing.ts';

const now = Date.parse(NOW);
const reveal = (change = {}) => matchState({ phase: 'reveal', places: PLACES, round: 1, revealEndsAt: at(6), ...change });

describe('askAfterReveal', () => {
  it('is a window that opens just after the reveal ends, on the server clock', () => {
    expect(askAfterReveal(reveal(), now, 0)).toEqual({ fromMs: 6150, byMs: 6150 });
    expect(askAfterReveal(reveal(), now + 2500, 0)).toEqual({ fromMs: 3650, byMs: 3650 });
  });

  it('closes up to a second after the end, by this browser’s share of the spread', () => {
    expect(askAfterReveal(reveal(), now, 0.5)).toEqual({ fromMs: 6150, byMs: 6575 });
    expect(askAfterReveal(reveal(), now, 1)).toEqual({ fromMs: 6150, byMs: 7000 });
    expect(REVEAL_ASK).toEqual({ graceMs: 150, withinMs: 1000 });
  });

  it('holds a share that is out of range inside the second', () => {
    expect(askAfterReveal(reveal(), now, 7)?.byMs).toBe(7000);
    expect(askAfterReveal(reveal(), now, -1)?.byMs).toBe(6150);
    expect(askAfterReveal(reveal(), now, Number.NaN)?.byMs).toBe(6150);
  });

  it('opens at once for a reveal whose end has passed', () => {
    expect(askAfterReveal(reveal(), now + 9000, 1)).toEqual({ fromMs: 150, byMs: 1000 });
  });

  it('is nothing outside a reveal, and for a reveal with no end', () => {
    expect(askAfterReveal(matchState({ phase: 'playing', places: PLACES, roundStartsAt: at(1), roundEndsAt: at(31), revealEndsAt: at(6) }), now, 0.5)).toBeNull();
    expect(askAfterReveal(matchState({ phase: 'finished', revealEndsAt: at(6) }), now, 0.5)).toBeNull();
    expect(askAfterReveal(reveal({ revealEndsAt: null }), now, 0.5)).toBeNull();
    expect(askAfterReveal(matchState(), now, 0.5)).toBeNull();
  });

  it('lands inside the five seconds of get-ready at every pace, which the pace alone does not', () => {
    const latest = askAfterReveal(reveal(), now, 1)!.byMs - 6000;
    expect(latest).toBeLessThanOrEqual(1000);
    // the slowest pace alone can leave a second of the get-ready; the quickest is never the problem
    expect(pollInterval(40)).toBe(4000);
    expect(POLL_MS).toBeGreaterThan(latest);
  });
});

describe('revealKey', () => {
  it('names one reveal: the same for every reply about it, another for the next round', () => {
    expect(revealKey(reveal())).toBe(revealKey(reveal({ serverNow: at(3) })));
    expect(revealKey(reveal())).not.toBe(revealKey(reveal({ round: 2, revealEndsAt: at(40) })));
    expect(revealKey(reveal())).not.toBe(revealKey(reveal({ revealEndsAt: at(7) })));
  });

  it('is nothing outside a reveal', () => {
    expect(revealKey(matchState())).toBeNull();
    expect(revealKey(reveal({ revealEndsAt: null }))).toBeNull();
  });
});
