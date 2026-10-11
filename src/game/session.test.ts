import { describe, expect, it } from 'vitest';
import { createSession, currentRound, hintsUsed, isComplete, replaceRound, submitGuess, totalScore } from './session.ts';
import { WORLD_SCALE_KM } from './scoring.ts';

const rounds = [
  { id: 'a', lng: 2.35, lat: 48.85, country: 'FR' },
  { id: 'b', lng: 13.4, lat: 52.52, country: 'DE' },
];

describe('session', () => {
  it('starts on the first round with nothing scored', () => {
    const session = createSession(rounds, WORLD_SCALE_KM);
    expect(currentRound(session)).toEqual(rounds[0]);
    expect(totalScore(session)).toBe(0);
    expect(isComplete(session)).toBe(false);
  });

  it('refuses to start without rounds', () => {
    expect(() => createSession([], WORLD_SCALE_KM)).toThrow();
  });

  it('scores a guess and moves on without changing the old session', () => {
    const start = createSession(rounds, WORLD_SCALE_KM);
    const next = submitGuess(start, { lng: 2.35, lat: 48.85 });

    expect(start.results).toHaveLength(0);
    expect(next.results[0]).toMatchObject({ distanceKm: 0, score: 5000, location: rounds[0] });
    expect(currentRound(next)).toEqual(rounds[1]);
  });

  it('gives nothing when the round ends without a guess', () => {
    const next = submitGuess(createSession(rounds, WORLD_SCALE_KM), null);
    expect(next.results[0]).toMatchObject({ guess: null, distanceKm: null, score: 0 });
  });

  it('finishes after the last round and adds up the total', () => {
    const one = submitGuess(createSession(rounds, WORLD_SCALE_KM), { lng: 2.35, lat: 48.85 });
    const two = submitGuess(one, { lng: 2.35, lat: 48.85 });

    expect(isComplete(two)).toBe(true);
    expect(currentRound(two)).toBeNull();
    expect(totalScore(two)).toBe(5000 + two.results[1]!.score);
    expect(two.results[1]!.score).toBeLessThan(5000);
  });

  it('refuses a guess once the game is over', () => {
    const done = submitGuess(submitGuess(createSession(rounds, WORLD_SCALE_KM), null), null);
    expect(() => submitGuess(done, null)).toThrow(/complete/);
  });
});

describe('a hinted round', () => {
  it('scores half, rounded down, and says it was hinted', () => {
    const plain = submitGuess(createSession(rounds, WORLD_SCALE_KM), { lng: 2.4, lat: 48.9 });
    const hinted = submitGuess(createSession(rounds, WORLD_SCALE_KM), { lng: 2.4, lat: 48.9 }, true);
    expect(hinted.results[0]?.hinted).toBe(true);
    expect(plain.results[0]?.hinted).toBe(false);
    expect(hinted.results[0]?.score).toBe(Math.floor(plain.results[0]!.score / 2));
    expect(hinted.results[0]?.distanceKm).toBe(plain.results[0]?.distanceKm);
  });

  it('halves a perfect 5,000 to 2,500 and leaves a missed round at 0', () => {
    expect(submitGuess(createSession(rounds, WORLD_SCALE_KM), rounds[0]!, true).results[0]?.score).toBe(2500);
    expect(submitGuess(createSession(rounds, WORLD_SCALE_KM), null, true).results[0]?.score).toBe(0);
  });
});

describe('hintsUsed', () => {
  it('counts the rounds that were hinted', () => {
    const start = createSession([...rounds, rounds[0]!], WORLD_SCALE_KM);
    expect(hintsUsed(start)).toBe(0);
    const one = submitGuess(start, null, true);
    const two = submitGuess(one, null, false);
    const three = submitGuess(two, null, true);
    expect([hintsUsed(one), hintsUsed(two), hintsUsed(three)]).toEqual([1, 1, 2]);
  });
});

describe('the time a round took', () => {
  it('is kept with the round when it is given, and left out when it is not', () => {
    const timed = submitGuess(createSession(rounds, WORLD_SCALE_KM), null, false, 12_400);
    expect(timed.results[0]?.timeMs).toBe(12_400);
    const untimed = submitGuess(createSession(rounds, WORLD_SCALE_KM), null);
    expect(untimed.results[0]).not.toHaveProperty('timeMs');
  });
});

describe('replaceRound', () => {
  const spare = { id: 'z', lng: 10, lat: 20, country: 'IT' };

  it('swaps the place of the round being played and leaves the rest alone', () => {
    const start = createSession(rounds, WORLD_SCALE_KM);
    const swapped = replaceRound(start, 0, spare);
    expect(swapped.rounds).toEqual([spare, rounds[1]]);
    expect(swapped.rounds).toHaveLength(2);
    expect(start.rounds[0]).toEqual(rounds[0]);
    expect(currentRound(swapped)).toEqual(spare);
  });

  it('keeps what was already scored', () => {
    const played = submitGuess(createSession(rounds, WORLD_SCALE_KM), { lng: 2.4, lat: 48.9 });
    const swapped = replaceRound(played, 1, spare);
    expect(swapped.results).toEqual(played.results);
    expect(currentRound(swapped)).toEqual(spare);
  });

  it('refuses a round that is not there or was already played', () => {
    const played = submitGuess(createSession(rounds, WORLD_SCALE_KM), null);
    expect(() => replaceRound(played, 0, spare)).toThrow();
    expect(() => replaceRound(played, 2, spare)).toThrow();
  });
});
