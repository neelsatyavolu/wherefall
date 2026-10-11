import { describe, expect, it } from 'vitest';
import type { SavedRound } from '../account/client.ts';
import { EMPTY, KEPT_DAYS, attemptOn, begun, claimable, createVisitorStore, historyOf, resultOn, scoreOf, withResult, withoutDays } from './visitor-store.ts';

const round = (score: number): SavedRound => ({ id: `p${score}`, country: 'FR', distanceKm: 12, score, lng: 2, lat: 48, guessLng: 2.1, guessLat: 48.1, hinted: false });
const result = (daily: string, scores: number[] = [5000, 4000, 3000]) => ({ daily, rounds: scores.map(round) });

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const TODAY = '2026-10-11';

describe("a visitor's dailies", () => {
  it('start with nothing begun and nothing played', () => {
    expect(attemptOn(EMPTY, TODAY)).toBe('open');
    expect(resultOn(EMPTY, TODAY)).toBeNull();
  });

  it('are begun for the day only, and never by changing what was there', () => {
    const kept = begun(EMPTY, TODAY);
    expect(EMPTY.started).toBeNull();
    expect(attemptOn(kept, TODAY)).toBe('started');
    // yesterday's unfinished attempt says nothing about today
    expect(attemptOn(kept, '2026-10-12')).toBe('open');
  });

  it('are done once the result is in, with the score of its rounds', () => {
    const kept = withResult(begun(EMPTY, TODAY), result(TODAY));
    expect(attemptOn(kept, TODAY)).toBe('done');
    expect(scoreOf(resultOn(kept, TODAY)!)).toBe(12_000);
  });

  it('keep the first result of a day', () => {
    const kept = withResult(withResult(EMPTY, result(TODAY, [1000, 1000, 1000])), result(TODAY, [5000, 5000, 5000]));
    expect(kept.results).toHaveLength(1);
    expect(scoreOf(resultOn(kept, TODAY)!)).toBe(3000);
  });

  it('keep the last 14 days, oldest first', () => {
    const days = Array.from({ length: 20 }, (_, i) => `2026-09-${String(i + 11).padStart(2, '0')}`);
    const kept = days.reduce((all, day) => withResult(all, result(day)), EMPTY);
    expect(KEPT_DAYS).toBe(14);
    expect(kept.results.map((each) => each.daily)).toEqual(days.slice(-14));
  });

  it('drop the days an account took and keep the rest', () => {
    const kept = withResult(withResult(EMPTY, result('2026-10-10')), result(TODAY));
    expect(withoutDays(kept, [TODAY]).results.map((each) => each.daily)).toEqual(['2026-10-10']);
    expect(kept.results).toHaveLength(2);
  });

  /** a day begun with a start the server answered, then finished */
  const playedOn = (kept: typeof EMPTY, day: string) => withResult(begun(kept, day, `token-${day}`), result(day));

  it('keep the token of the start with the result it began', () => {
    const kept = playedOn(EMPTY, TODAY);
    expect(kept.results[0]).toEqual({ ...result(TODAY), token: `token-${TODAY}` });
    // a result on another day than the one begun has no token of its own
    expect(withResult(begun(EMPTY, '2026-10-10', 'token-x'), result(TODAY)).results[0]?.token).toBeNull();
  });

  it('offer for claiming only what is no older than 14 days, each with its token', () => {
    const kept = playedOn(playedOn(EMPTY, '2026-09-20'), '2026-09-28');
    expect(claimable(kept, TODAY)).toEqual([{ ...result('2026-09-28'), token: 'token-2026-09-28' }]);
    expect(claimable(kept, '2026-10-30')).toEqual([]);
  });

  it('do not offer a result begun without a token, which the server would not take', () => {
    const kept = withResult(begun(playedOn(EMPTY, '2026-10-10'), TODAY), result(TODAY));
    expect(claimable(kept, TODAY).map((each) => each.daily)).toEqual(['2026-10-10']);
    // it is still this browser's result of the day
    expect(scoreOf(resultOn(kept, TODAY)!)).toBe(12_000);
  });

  it('make a history of 14 days ending today, a missed day having no score', () => {
    const kept = withResult(withResult(EMPTY, result('2026-10-09', [1000, 2000, 3000])), result(TODAY));
    const history = historyOf(kept, TODAY);
    expect(history).toHaveLength(14);
    expect(history[0]).toEqual({ date: '2026-09-28', score: null });
    expect(history.slice(-3)).toEqual([
      { date: '2026-10-09', score: 6000 },
      { date: '2026-10-10', score: null },
      { date: TODAY, score: 12_000 },
    ]);
  });
});

describe('the store', () => {
  it('reads nothing as empty, and anything unreadable too', () => {
    expect(createVisitorStore(() => memory()).read()).toEqual(EMPTY);
    expect(createVisitorStore(() => memory({ 'plonk.daily': '{"started":3}' })).read()).toEqual(EMPTY);
    expect(createVisitorStore(() => memory({ 'plonk.daily': 'not json' })).read()).toEqual(EMPTY);
  });

  it('keeps a change across pages, the rounds as a claim sends them', () => {
    const storage = memory();
    createVisitorStore(() => storage).update((kept) => withResult(begun(kept, TODAY), result(TODAY)));
    const kept = createVisitorStore(() => storage).read();
    expect(attemptOn(kept, TODAY)).toBe('done');
    expect(kept.results[0]).toEqual({ ...result(TODAY), token: null });
  });

  it('reads what a browser kept before rounds named their place and starts had tokens: shown, and never offered', () => {
    const old = { started: TODAY, results: [{ daily: TODAY, rounds: [{ country: 'FR', distanceKm: 12, score: 4000 }, { country: 'JP', distanceKm: null, score: 0, lng: 139, lat: 35 }] }], claim: null };
    const kept = createVisitorStore(() => memory({ 'plonk.daily': JSON.stringify(old) })).read();
    expect(kept.token).toBeNull();
    expect(attemptOn(kept, TODAY)).toBe('done');
    expect(scoreOf(resultOn(kept, TODAY)!)).toBe(4000);
    expect(claimable(kept, TODAY)).toEqual([]);
    // nor with a token, while a round does not name its place
    expect(claimable({ ...kept, results: kept.results.map((each) => ({ ...each, token: 'token' })) }, TODAY)).toEqual([]);
  });

  it('works without storage: nothing is kept and nothing breaks', () => {
    const blocked = createVisitorStore(() => {
      throw new Error('blocked');
    });
    expect(blocked.update((kept) => begun(kept, TODAY))).toEqual(begun(EMPTY, TODAY));
    expect(blocked.read()).toEqual(EMPTY);
  });
});
