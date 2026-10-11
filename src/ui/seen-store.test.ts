import { describe, expect, it } from 'vitest';
import { SEEN_LIMIT } from '../game/seen-places.ts';
import { createSeenStore } from './seen-store.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const KEY = 'plonk.seen-places';

describe('the seen-places store', () => {
  it('starts empty', () => {
    expect(createSeenStore(() => memory()).ids().size).toBe(0);
  });

  it('remembers places across pages', () => {
    const storage = memory();
    createSeenStore(() => storage).add(['a', 'b']);
    createSeenStore(() => storage).add(['c']);
    expect([...createSeenStore(() => storage).ids()]).toEqual(['a', 'b', 'c']);
  });

  it('keeps the last 5,000, oldest dropped', () => {
    const storage = memory();
    const store = createSeenStore(() => storage);
    store.add(Array.from({ length: SEEN_LIMIT }, (_, i) => `old${i}`));
    store.add(['new']);
    const ids = store.ids();
    expect(ids.size).toBe(SEEN_LIMIT);
    expect(ids.has('old0')).toBe(false);
    expect(ids.has('old1')).toBe(true);
    expect(ids.has('new')).toBe(true);
  });

  it('reads anything that is not a list of ids as nothing seen', () => {
    for (const stored of ['', 'not json', '{"a":1}', '[1,2]', '["a",null]', 'null']) {
      expect(createSeenStore(() => memory({ [KEY]: stored })).ids().size).toBe(0);
    }
  });

  it('works without storage: nothing is remembered and nothing throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createSeenStore(() => blocked);
    expect(() => store.add(['a'])).not.toThrow();
    expect(store.ids().size).toBe(0);
  });

  it('does not write when there is nothing to add', () => {
    const storage = memory();
    createSeenStore(() => storage).add([]);
    expect(storage.data.has(KEY)).toBe(false);
  });
});
