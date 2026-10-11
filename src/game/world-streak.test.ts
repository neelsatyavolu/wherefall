import { describe, expect, it } from 'vitest';
import { MAX_STREAK } from './streak.ts';
import { NO_STREAK, afterRound, answerOf, lengthOf, tidy, withRun, type WorldStreak } from './world-streak.ts';

const find = (point: { lng: number; lat: number }) => (point.lng > 0 ? 'RU' : point.lng < -100 ? null : 'BR');
const right = (id: string) => ({ id, answer: 'RU' });
const wrong = (id: string) => ({ id, answer: 'BR' });
const BEGUN = { run: 'run.1', at: 1000 };
const three: WorldStreak = { rounds: [right('a'), right('b'), right('c')], begun: BEGUN };

describe('answerOf', () => {
  it('is the country the lookup puts a guess in', () => {
    expect(answerOf({ lng: 60, lat: 55 }, find)).toBe('RU');
    expect(answerOf({ lng: -50, lat: -10 }, find)).toBe('BR');
  });

  it('is no answer for a guess in no country, and for no guess at all', () => {
    expect(answerOf({ lng: -150, lat: 0 }, find)).toBeNull();
    expect(answerOf(null, find)).toBeNull();
  });
});

describe('afterRound', () => {
  it('begins a streak on the first right country: one long, with a run to be begun for it', () => {
    expect(afterRound(NO_STREAK, right('a'), 'RU')).toEqual({ state: { rounds: [right('a')], begun: null }, ended: 0, begins: true, finish: null });
  });

  it('adds a round for each right country after it, keeping the run it has', () => {
    const judged = afterRound(three, right('d'), 'RU');
    expect(judged).toEqual({ state: { rounds: [...three.rounds, right('d')], begun: BEGUN }, ended: 0, begins: false, finish: null });
    expect(lengthOf(judged.state)).toBe(4);
  });

  it('starts again on a wrong country, and finishes the run with every round played, the losing one last', () => {
    expect(afterRound(three, wrong('d'), 'RU')).toEqual({ state: NO_STREAK, ended: 3, begins: false, finish: { begun: BEGUN, rounds: [...three.rounds, wrong('d')] } });
  });

  it('counts no answer as a miss', () => {
    const judged = afterRound(three, { id: 'd', answer: null }, 'RU');
    expect(judged.ended).toBe(3);
    expect(judged.finish?.rounds.at(-1)).toEqual({ id: 'd', answer: null });
  });

  it('has no run to finish for a streak that never had one: a visitor’s, or one whose start failed', () => {
    expect(afterRound({ ...three, begun: null }, wrong('d'), 'RU')).toEqual({ state: NO_STREAK, ended: 3, begins: false, finish: null });
  });

  it('ends nothing, and finishes nothing, when there was no streak', () => {
    expect(afterRound(NO_STREAK, wrong('a'), 'RU')).toEqual({ state: NO_STREAK, ended: 0, begins: false, finish: null });
  });

  it('ends a streak at the longest a run can be, unbeaten, with no losing round to send', () => {
    const long: WorldStreak = { rounds: Array.from({ length: MAX_STREAK - 1 }, (_, index) => right(`p${index}`)), begun: BEGUN };
    const judged = afterRound(long, right('last'), 'RU');
    expect(judged.state).toEqual(NO_STREAK);
    expect(judged.ended).toBe(MAX_STREAK);
    expect(judged.finish?.rounds).toHaveLength(MAX_STREAK);
    expect(judged.finish?.rounds.at(-1)).toEqual(right('last'));
  });

  it('leaves the state it was given as it was', () => {
    const before = { rounds: [right('a')], begun: BEGUN };
    afterRound(before, right('b'), 'RU');
    afterRound(before, wrong('b'), 'RU');
    expect(before).toEqual({ rounds: [right('a')], begun: BEGUN });
  });
});

describe('withRun', () => {
  it('gives a streak under way the run that was begun for it', () => {
    expect(withRun({ rounds: [right('a')], begun: null }, BEGUN)).toEqual({ rounds: [right('a')], begun: BEGUN });
  });

  it('leaves alone a streak that has a run, and one that ended while the run was on its way', () => {
    expect(withRun(three, { run: 'run.2', at: 5 })).toEqual(three);
    expect(withRun(NO_STREAK, BEGUN)).toEqual(NO_STREAK);
  });
});

describe('tidy', () => {
  it('keeps what a browser stored when it is a streak', () => {
    expect(tidy(JSON.parse(JSON.stringify(three)))).toEqual(three);
    expect(tidy({ rounds: [{ id: 'a', answer: 'RU' }], begun: null })).toEqual({ rounds: [right('a')], begun: null });
  });

  it('starts from nothing on anything else', () => {
    const long = Array.from({ length: MAX_STREAK + 1 }, (_, index) => right(`p${index}`));
    for (const stored of [null, 'four', 4, [], {}, { rounds: 3 }, { rounds: [{ id: 5, answer: 'RU' }] }, { rounds: [{ id: 'a' }] }, { rounds: [{ id: 'a', answer: 7 }] }, { rounds: long }]) {
      expect(tidy(stored)).toEqual(NO_STREAK);
    }
  });

  it('drops a run it cannot read, and keeps the streak', () => {
    expect(tidy({ rounds: [right('a')], begun: { run: '', at: 1 } })).toEqual({ rounds: [right('a')], begun: null });
    expect(tidy({ rounds: [right('a')], begun: { run: 'run.1', at: 'then' } })).toEqual({ rounds: [right('a')], begun: null });
    expect(tidy({ rounds: [right('a')] })).toEqual({ rounds: [right('a')], begun: null });
  });

  it('has no run without a streak', () => {
    expect(tidy({ rounds: [], begun: BEGUN })).toEqual(NO_STREAK);
  });
});
