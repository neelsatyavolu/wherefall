import { describe, expect, it } from 'vitest';
import type { Result, SavedRound } from '../account/client.ts';
import { beginDaily } from './begin.ts';
import type { DailyStart } from './client.ts';
import { attemptOn, claimable, createVisitorStore, withResult } from './visitor-store.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

const TODAY = '2026-10-11';
const answers = (reply: Result<DailyStart>) => async () => reply;
const round = (id: string): SavedRound => ({ id, lng: 2, lat: 48, guessLng: null, guessLat: null, country: 'FR', distanceKm: null, score: 0 });

describe('beginDaily', () => {
  it("plays an account's daily, which the server has marked as begun, and keeps nothing here", async () => {
    const storage = memory();
    const store = createVisitorStore(() => storage);
    expect(await beginDaily(TODAY, store, answers({ ok: true, data: { state: 'started', token: null } }))).toBe('play');
    expect(attemptOn(store.read(), TODAY)).toBe('open');
  });

  it('says so when the account already has a result today', async () => {
    const store = createVisitorStore(memory);
    expect(await beginDaily(TODAY, store, answers({ ok: true, data: { state: 'done', token: null } }))).toBe('done');
  });

  it("marks a visitor's attempt in this browser with the server's token, so the result can be claimed", async () => {
    const storage = memory();
    const store = createVisitorStore(() => storage);
    expect(await beginDaily(TODAY, store, answers({ ok: true, data: { state: 'started', token: 'daily.token' } }))).toBe('play');
    expect(attemptOn(store.read(), TODAY)).toBe('started');
    const finished = store.update((kept) => withResult(kept, { daily: TODAY, rounds: [round('a'), round('b'), round('c')] }));
    expect(claimable(finished, TODAY)).toEqual([{ daily: TODAY, token: 'daily.token', rounds: [round('a'), round('b'), round('c')] }]);
  });

  it('begins nothing when the server refuses or cannot be reached, and passes on why', async () => {
    const storage = memory();
    const store = createVisitorStore(() => storage);
    const error = 'Too many dailies started in the last hour. Try again later.';
    expect(await beginDaily(TODAY, store, answers({ ok: false, error }))).toEqual({ error });
    expect(attemptOn(store.read(), TODAY)).toBe('open');
  });
});
