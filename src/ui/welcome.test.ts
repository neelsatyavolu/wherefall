import { describe, expect, it } from 'vitest';
import { createPrefs } from './prefs.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('what this browser remembers of the welcome', () => {
  it('starts unanswered', () => {
    expect(createPrefs(() => memory()).welcomeSeen()).toBe(false);
  });

  it('is answered for good once it was', () => {
    const storage = memory();
    createPrefs(() => storage).markWelcomeSeen();
    expect(createPrefs(() => storage).welcomeSeen()).toBe(true);
  });

  it('is kept apart from the how-to box, which a skipped welcome leaves in place', () => {
    const storage = memory();
    createPrefs(() => storage).markWelcomeSeen();
    expect(createPrefs(() => storage).introSeen()).toBe(false);
    expect(createPrefs(() => memory({ 'plonk.intro-seen': '1' })).welcomeSeen()).toBe(false);
  });

  it('is unanswered where nothing can be stored', () => {
    const prefs = createPrefs(() => {
      throw new Error('no storage');
    });
    prefs.markWelcomeSeen();
    expect(prefs.welcomeSeen()).toBe(false);
  });
});
