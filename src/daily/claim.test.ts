import { describe, expect, it } from 'vitest';
import type { Result, SavedRound } from '../account/client.ts';
import { CLAIM_DAY_ONLY, claimKept, takeClaimNote } from './claim.ts';
import type { StoredDaily } from './client.ts';
import { EMPTY, begun, createVisitorStore, withResult } from './visitor-store.ts';

const round = (score: number): SavedRound => ({ id: `p${score}`, lng: 2, lat: 48, guessLng: 2.1, guessLat: 48.1, country: 'FR', distanceKm: 12, score });
const rounds = [round(5000), round(4000), round(3000)];
const tokenOf = (daily: string) => `token-${daily}`;
const result = (daily: string): StoredDaily => ({ daily, token: tokenOf(daily), rounds });

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

const TODAY = '2026-10-11';

function setUp(days: string[] = ['2026-10-10', TODAY]) {
  const storage = memory();
  const store = createVisitorStore(() => storage);
  // each day begun with a start the server answered, then finished
  store.update(() => days.reduce((all, day) => withResult(begun(all, day, tokenOf(day)), { daily: day, rounds }), EMPTY));
  return store;
}

type Claimed = Result<{ claimed: string[] }>;

function claimer(reply: Claimed) {
  const asked: StoredDaily[][] = [];
  const claim = async (results: readonly StoredDaily[]): Promise<Claimed> => {
    asked.push([...results]);
    return reply;
  };
  return { asked, claim };
}

describe('claimKept', () => {
  it.each(['Sign in first.', 'Guests cannot do that. Make an account first.'])('takes "%s" for what it is, a session that ended, not a claim that failed: nobody is told, and it is asked again', async (error) => {
    const store = setUp();
    const { asked, claim } = claimer({ ok: false, error });
    expect(await claimKept('neel', TODAY, store, claim)).toBe('nothing');
    expect(store.read().claim).toBeNull();
    expect(takeClaimNote('neel', store)).toBe(false);
    expect(await claimKept('neel', TODAY, store, claim)).toBe('nothing');
    expect(asked).toHaveLength(2);
  });

  it('asks for nothing when nothing is kept', async () => {
    const { asked, claim } = claimer({ ok: true, data: { claimed: [] } });
    expect(await claimKept('neel', TODAY, setUp([]), claim)).toBe('nothing');
    expect(asked).toEqual([]);
  });

  it('hands the kept results to the account and clears the days that were taken', async () => {
    const store = setUp();
    const { asked, claim } = claimer({ ok: true, data: { claimed: [TODAY] } });
    expect(await claimKept('neel', TODAY, store, claim)).toBe('claimed');
    expect(asked).toEqual([[result('2026-10-10'), result(TODAY)]]);
    expect(store.read().results.map((each) => each.daily)).toEqual(['2026-10-10']);
  });

  it('does not offer the same account what it has already answered for', async () => {
    const store = setUp();
    const { asked, claim } = claimer({ ok: true, data: { claimed: [TODAY] } });
    await claimKept('neel', TODAY, store, claim);
    expect(await claimKept('neel', TODAY, store, claim)).toBe('nothing');
    expect(asked).toHaveLength(1);
    // another account has not been asked
    expect(await claimKept('ana', TODAY, store, claim)).toBe('claimed');
    expect(asked).toHaveLength(2);
  });

  it('keeps everything and says so once when the account is too old to claim, and does not ask it again', async () => {
    const store = setUp();
    const { asked, claim } = claimer({ ok: false, error: CLAIM_DAY_ONLY });
    expect(await claimKept('neel', TODAY, store, claim)).toBe('failed');
    expect(store.read().results).toHaveLength(2);
    expect(await claimKept('neel', TODAY, store, claim)).toBe('nothing');
    expect(asked).toHaveLength(1);
    expect(takeClaimNote('neel', store)).toBe(true);
    expect(takeClaimNote('neel', store)).toBe(false);
  });

  it('tries again later after a failure that may pass', async () => {
    const store = setUp();
    const down = claimer({ ok: false, error: 'Too many claims in the last hour. Try again later.' });
    expect(await claimKept('neel', TODAY, store, down.claim)).toBe('failed');
    expect(takeClaimNote('neel', store)).toBe(true);
    const up = claimer({ ok: true, data: { claimed: ['2026-10-10', TODAY] } });
    expect(await claimKept('neel', TODAY, store, up.claim)).toBe('claimed');
    expect(store.read().results).toEqual([]);
    expect(takeClaimNote('neel', store)).toBe(false);
  });

  it('offers again once a new result is kept', async () => {
    const store = setUp(['2026-10-10']);
    const { asked, claim } = claimer({ ok: true, data: { claimed: [] } });
    await claimKept('neel', TODAY, store, claim);
    store.update((kept) => withResult(kept, result(TODAY)));
    await claimKept('neel', TODAY, store, claim);
    expect(asked).toHaveLength(2);
  });

  it('sends at most 14, none older than 14 days', async () => {
    const store = setUp(['2026-09-20', '2026-10-01', TODAY]);
    const { asked, claim } = claimer({ ok: true, data: { claimed: [] } });
    await claimKept('neel', TODAY, store, claim);
    expect(asked[0]!.map((each) => each.daily)).toEqual(['2026-10-01', TODAY]);
  });
});
