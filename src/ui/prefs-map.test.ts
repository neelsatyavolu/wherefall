import { describe, expect, it } from 'vitest';
import { createPrefs } from './prefs.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe('the guess map’s preferences', () => {
  it('start on the street map, closing when the pointer leaves', () => {
    const prefs = createPrefs(() => memory());
    expect(prefs.mapType()).toBe('streets');
    expect(prefs.mapKeepOpen()).toBe(false);
  });

  it('remember the map type and whether the map is kept open', () => {
    const store = memory();
    const prefs = createPrefs(() => store);
    prefs.setMapType('satellite');
    prefs.setMapKeepOpen(true);
    expect(createPrefs(() => store).mapType()).toBe('satellite');
    expect(createPrefs(() => store).mapKeepOpen()).toBe(true);
    prefs.setMapKeepOpen(false);
    expect(createPrefs(() => store).mapKeepOpen()).toBe(false);
  });

  it('remember the hybrid map as they do the others', () => {
    const store = memory();
    createPrefs(() => store).setMapType('hybrid');
    expect(createPrefs(() => store).mapType()).toBe('hybrid');
  });

  it('fall back to streets for a type that is not one', () => {
    expect(createPrefs(() => memory({ 'plonk.map-type': 'watercolour' })).mapType()).toBe('streets');
  });

  it('give the defaults when storage is blocked', () => {
    const prefs = createPrefs(() => {
      throw new Error('blocked');
    });
    expect(prefs.mapType()).toBe('streets');
    expect(prefs.mapKeepOpen()).toBe(false);
    expect(() => prefs.setMapType('terrain')).not.toThrow();
  });
});
