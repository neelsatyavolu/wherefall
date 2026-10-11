import { describe, expect, it } from 'vitest';
import type { RoundResult } from '../game/session.ts';
import type { BegunStreak, StreakRound } from '../game/world-streak.ts';
import { createUnsentStore } from './world-streak-unsent.ts';
import { createStreakStore, trackWorldStreak, type FinishOutcome, type StreakNews } from './world-streak.ts';

const KEY = 'plonk.world-streak';

function memory(start: Record<string, string> = {}) {
  const items = new Map(Object.entries(start));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

const find = (point: { lng: number; lat: number }) => (point.lng > 0 ? 'RU' : 'BR');
const round = (id: string, guess: { lng: number; lat: number } | null): RoundResult => ({ location: { id, lng: 60, lat: 55, country: 'RU' }, guess, distanceKm: guess ? 1 : null, score: 0, hinted: false });
const right = (id: string) => round(id, { lng: 61, lat: 56 });
const wrong = (id: string) => round(id, { lng: -50, lat: -10 });
const three = JSON.stringify({ rounds: ['a', 'b', 'c'].map((id) => ({ id, answer: 'RU' })), begun: { run: 'run.9', at: 5 } });
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A tracker over a store in memory. Every run begun is `run.1`, `run.2`…, unless `account` is false;
 * every finish is noted. `fails`: the server cannot be reached. `busy`: it answers, and asks to be
 * sent the finish again later.
 */
function tracker(
  start: Record<string, string> = {},
  account: boolean | 'fails' | 'busy' = true,
  finder: () => Promise<typeof find> = async () => find,
  storage: ReturnType<typeof memory> = memory(start),
) {
  const begun: BegunStreak[] = [];
  const finished: Array<{ run: string; rounds: readonly StreakRound[] }> = [];
  const runs = {
    begin: async () => {
      if (account === 'fails') {
        throw new Error('offline');
      }
      if (!account) {
        return null;
      }
      begun.push({ run: `run.${begun.length + 1}`, at: 1000 * (begun.length + 1) });
      return begun.at(-1)!;
    },
    finish: async (run: BegunStreak, rounds: readonly StreakRound[]): Promise<FinishOutcome> => {
      finished.push({ run: run.run, rounds });
      if (account === 'fails') {
        throw new Error('offline');
      }
      return account === 'busy' ? 'later' : 'done';
    },
  };
  const unsent = createUnsentStore(() => storage);
  const tracked = trackWorldStreak(runs, createStreakStore(() => storage), finder, unsent);
  const stored = () => JSON.parse(storage.items.get(KEY) ?? 'null') as { rounds: StreakRound[]; begun: BegunStreak | null } | null;
  return { tracked, begun, finished, stored, storage, unsent };
}

describe('createStreakStore', () => {
  it('starts from no streak, and from no streak again on anything it cannot read', () => {
    expect(createStreakStore(() => memory()).read()).toEqual({ rounds: [], begun: null });
    expect(createStreakStore(() => memory({ [KEY]: 'not json' })).read()).toEqual({ rounds: [], begun: null });
    expect(createStreakStore(() => memory({ [KEY]: '{"streak":3}' })).read()).toEqual({ rounds: [], begun: null });
  });

  it('keeps a streak, with its run, for the next game', () => {
    const storage = memory();
    const state = { rounds: [{ id: 'a', answer: 'RU' }], begun: { run: 'run.1', at: 7 } };
    createStreakStore(() => storage).write(state);
    expect(createStreakStore(() => storage).read()).toEqual(state);
  });

  it('counts for the page only where storage is blocked', () => {
    const blocked = createStreakStore(() => {
      throw new Error('blocked');
    });
    expect(() => blocked.write({ rounds: [{ id: 'a', answer: 'RU' }], begun: null })).not.toThrow();
    expect(blocked.read()).toEqual({ rounds: [], begun: null });
  });
});

describe('trackWorldStreak', () => {
  it('adds one for each round whose guess is in the right country, and says the streak', async () => {
    const { tracked, stored } = tracker();
    expect(await tracked.round(right('a'))).toEqual<StreakNews>({ streak: 1, ended: 0 });
    expect(await tracked.round(right('b'))).toEqual<StreakNews>({ streak: 2, ended: 0 });
    expect(stored()?.rounds).toEqual([
      { id: 'a', answer: 'RU' },
      { id: 'b', answer: 'RU' },
    ]);
  });

  it('begins a run for a streak as its first round is played, once, and keeps it with the streak', async () => {
    const { tracked, begun, stored } = tracker();
    await tracked.round(right('a'));
    await tracked.round(right('b'));
    await tracked.round(right('c'));
    expect(begun).toEqual([{ run: 'run.1', at: 1000 }]);
    expect(stored()?.begun).toEqual({ run: 'run.1', at: 1000 });
  });

  it('carries on from the streak the last game left, with the run it had', async () => {
    const { tracked, begun, stored } = tracker({ [KEY]: three });
    expect(await tracked.round(right('d'))).toEqual({ streak: 4, ended: 0 });
    expect(begun).toEqual([]);
    expect(stored()?.begun).toEqual({ run: 'run.9', at: 5 });
  });

  it('starts again on a wrong country, says how long the streak was, and finishes its run with every round, the losing one last', async () => {
    const { tracked, finished, stored } = tracker({ [KEY]: three });
    expect(await tracked.round(wrong('d'))).toEqual({ streak: 0, ended: 3 });
    expect(stored()).toEqual({ rounds: [], begun: null });
    expect(finished).toEqual([{ run: 'run.9', rounds: [...['a', 'b', 'c'].map((id) => ({ id, answer: 'RU' })), { id: 'd', answer: 'BR' }] }]);
  });

  it('counts a round with no guess as a miss, sent with no answer', async () => {
    const { tracked, finished } = tracker({ [KEY]: three });
    expect(await tracked.round(round('d', null))).toEqual({ streak: 0, ended: 3 });
    expect(finished[0]?.rounds.at(-1)).toEqual({ id: 'd', answer: null });
  });

  it('gives each streak a run of its own', async () => {
    const { tracked, begun, finished } = tracker();
    await tracked.round(right('a'));
    await tracked.round(wrong('b'));
    await tracked.round(right('c'));
    await tracked.round(right('d'));
    await tracked.round(wrong('e'));
    expect(begun.map((each) => each.run)).toEqual(['run.1', 'run.2']);
    expect(finished.map((each) => [each.run, each.rounds.map((played) => played.id).join('')])).toEqual([
      ['run.1', 'ab'],
      ['run.2', 'cde'],
    ]);
  });

  it('counts a visitor’s streak and says it, with no run begun or finished', async () => {
    const { tracked, begun, finished, stored } = tracker({}, false);
    expect(await tracked.round(right('a'))).toEqual({ streak: 1, ended: 0 });
    expect(await tracked.round(right('b'))).toEqual({ streak: 2, ended: 0 });
    expect(await tracked.round(wrong('c'))).toEqual({ streak: 0, ended: 2 });
    await settled();
    expect([begun, finished]).toEqual([[], []]);
    expect(stored()).toEqual({ rounds: [], begun: null });
  });

  it('goes on counting when the server cannot be reached, at the start or at the finish', async () => {
    const offline = tracker({}, 'fails');
    expect(await offline.tracked.round(right('a'))).toEqual({ streak: 1, ended: 0 });
    expect(await offline.tracked.round(wrong('b'))).toEqual({ streak: 0, ended: 1 });
    const lost = tracker({ [KEY]: three }, 'fails');
    expect(await lost.tracked.round(wrong('d'))).toEqual({ streak: 0, ended: 3 });
    await settled();
    expect(lost.finished).toHaveLength(1);
  });

  it('does not make a result wait for the server', async () => {
    let answer: (begun: BegunStreak | null) => void = () => {};
    const storage = memory();
    const slow = { begin: () => new Promise<BegunStreak | null>((resolve) => (answer = resolve)), finish: async (): Promise<FinishOutcome> => 'done' };
    const tracked = trackWorldStreak(slow, createStreakStore(() => storage), async () => find, createUnsentStore(() => storage));
    expect(await tracked.round(right('a'))).toEqual({ streak: 1, ended: 0 });
    // the next round is judged once the run has come, so the run is with the streak it was begun for
    const next = tracked.round(right('b'));
    await settled();
    answer({ run: 'run.1', at: 9 });
    expect(await next).toEqual({ streak: 2, ended: 0 });
    expect(JSON.parse(storage.items.get(KEY)!)).toMatchObject({ begun: { run: 'run.1', at: 9 } });
  });

  it('judges rounds in the order they were played, however long the borders take to load', async () => {
    let ready: (finder: typeof find) => void = () => {};
    const { tracked, stored } = tracker({}, true, () => new Promise((resolve) => (ready = resolve)));
    const news = [tracked.round(right('a')), tracked.round(right('b')), tracked.round(wrong('c')), tracked.round(right('d'))];
    ready(find);
    expect(await Promise.all(news)).toEqual([
      { streak: 1, ended: 0 },
      { streak: 2, ended: 0 },
      { streak: 0, ended: 2 },
      { streak: 1, ended: 0 },
    ]);
    expect(stored()?.rounds).toEqual([{ id: 'd', answer: 'RU' }]);
  });

  const lostRounds = [...['a', 'b', 'c'].map((id) => ({ id, answer: 'RU' })), { id: 'd', answer: 'BR' }];

  it('keeps the finish of a streak the server could not be told of, and sends it again when the next game begins', async () => {
    const offline = tracker({ [KEY]: three }, 'fails');
    await offline.tracked.round(wrong('d'));
    await settled();
    expect(offline.unsent.read()).toEqual([{ begun: { run: 'run.9', at: 5 }, rounds: lostRounds }]);

    // the next world game, with the server back: the same run, the same rounds, and then nothing left to send
    const back = tracker({}, true, async () => find, offline.storage);
    await settled();
    expect(back.finished).toEqual([{ run: 'run.9', rounds: lostRounds }]);
    expect(back.unsent.read()).toEqual([]);

    // and it is not sent a third time
    const after = tracker({}, true, async () => find, offline.storage);
    await settled();
    expect(after.finished).toEqual([]);
  });

  it('keeps a finish the server asks for later, and goes on keeping it while it is not through', async () => {
    const busy = tracker({ [KEY]: three }, 'busy');
    await busy.tracked.round(wrong('d'));
    await settled();
    expect(busy.unsent.read()).toHaveLength(1);
    const still = tracker({}, 'busy', async () => find, busy.storage);
    await settled();
    expect(still.finished).toHaveLength(1);
    expect(still.unsent.read()).toHaveLength(1);
  });

  it('keeps nothing of a finish the server has answered', async () => {
    const { tracked, unsent } = tracker({ [KEY]: three });
    await tracked.round(wrong('d'));
    await settled();
    expect(unsent.read()).toEqual([]);
  });

  it('sends what was kept without holding up the game: a round is judged while the server is still being told', async () => {
    const storage = memory();
    createUnsentStore(() => storage).add({ begun: { run: 'run.9', at: 5 }, rounds: lostRounds });
    const never = { begin: async () => null, finish: () => new Promise<FinishOutcome>(() => {}) };
    const tracked = trackWorldStreak(never, createStreakStore(() => storage), async () => find, createUnsentStore(() => storage));
    expect(await tracked.round(right('e'))).toEqual({ streak: 1, ended: 0 });
  });

  it('counts nothing, and says nothing, when the borders will not load', async () => {
    const { tracked, finished, stored } = tracker({ [KEY]: three }, true, () => Promise.reject(new Error('offline')));
    expect(await tracked.round(wrong('d'))).toBeNull();
    expect(stored()).toEqual(JSON.parse(three));
    expect(finished).toEqual([]);
  });
});
