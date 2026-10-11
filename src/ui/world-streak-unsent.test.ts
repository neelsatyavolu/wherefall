import { describe, expect, it } from 'vitest';
import { KEEP_UNSENT_MS, MAX_UNSENT, createUnsentStore } from './world-streak-unsent.ts';

const KEY = 'plonk.world-streak.unsent';

function memory(start: Record<string, string> = {}) {
  const items = new Map(Object.entries(start));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items };
}

const finish = (run: string, ids = ['a', 'b']) => ({ begun: { run, at: 5 }, rounds: ids.map((id, index) => ({ id, answer: index === ids.length - 1 ? 'BR' : 'RU' })) });

describe('finishes the server has not had', () => {
  it('start as none, and as none again on anything that cannot be read', () => {
    expect(createUnsentStore(() => memory()).read()).toEqual([]);
    expect(createUnsentStore(() => memory({ [KEY]: 'not json' })).read()).toEqual([]);
    expect(createUnsentStore(() => memory({ [KEY]: '[{"begun":{"run":""},"rounds":[]}]' })).read()).toEqual([]);
  });

  it('are kept for a later page, each run once, and dropped when the server has answered', () => {
    const storage = memory();
    const first = createUnsentStore(() => storage, () => 1000);
    first.add(finish('run.1'));
    first.add(finish('run.2'));
    // sent again and still not through: it is the same finish, not another
    first.add(finish('run.1'));
    const later = createUnsentStore(() => storage, () => 2000);
    expect(later.read().map((each) => each.begun.run)).toEqual(['run.2', 'run.1']);
    expect(later.read()[0]).toEqual(finish('run.2'));
    later.remove('run.2');
    expect(later.read().map((each) => each.begun.run)).toEqual(['run.1']);
  });

  it('hold a handful at most, the oldest making way', () => {
    const storage = memory();
    const store = createUnsentStore(() => storage, () => 1000);
    Array.from({ length: MAX_UNSENT + 2 }, (_, index) => store.add(finish(`run.${index + 1}`)));
    expect(store.read().map((each) => each.begun.run)).toEqual(Array.from({ length: MAX_UNSENT }, (_, index) => `run.${index + 3}`));
  });

  it('are let go after two weeks: an account that never came back is not asked for ever', () => {
    const storage = memory();
    createUnsentStore(() => storage, () => 1000).add(finish('run.1'));
    // failing again on the way does not make it any younger
    const again = createUnsentStore(() => storage, () => 1000 + KEEP_UNSENT_MS - 1);
    expect(again.read()).toHaveLength(1);
    again.add(finish('run.1'));
    expect(createUnsentStore(() => storage, () => 1000 + KEEP_UNSENT_MS + 1).read()).toEqual([]);
  });

  it('break nothing where storage is blocked: nothing is kept', () => {
    const blocked = createUnsentStore(() => {
      throw new Error('blocked');
    });
    expect(() => blocked.add(finish('run.1'))).not.toThrow();
    expect(() => blocked.remove('run.1')).not.toThrow();
    expect(blocked.read()).toEqual([]);
  });
});
