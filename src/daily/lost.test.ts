import { describe, expect, it } from 'vitest';
import { createLostStore } from './lost.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe('a daily lost to an update', () => {
  it('is known for its own day, from a page loaded afterwards too', () => {
    const storage = memory();
    createLostStore(() => storage).mark('2026-10-11');
    const later = createLostStore(() => storage);
    expect(later.is('2026-10-11')).toBe(true);
    expect(later.is('2026-10-12')).toBe(false);
  });

  it('is not known where nothing was lost', () => {
    expect(createLostStore(memory).is('2026-10-11')).toBe(false);
  });

  it('breaks nothing where storage is blocked: nothing is kept', () => {
    const blocked = createLostStore(() => {
      throw new Error('blocked');
    });
    blocked.mark('2026-10-11');
    expect(blocked.is('2026-10-11')).toBe(false);
  });
});
