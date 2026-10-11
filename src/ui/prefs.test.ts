import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME, createPrefs, defaultUnits } from './prefs.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('prefs', () => {
  it('starts with kilometres, a medium map and the introduction unseen', () => {
    const prefs = createPrefs(() => memory());
    expect(prefs.units()).toBe('km');
    expect(prefs.mapSize()).toBe('medium');
    expect(prefs.introSeen()).toBe(false);
    expect(prefs.sound()).toBe(true);
  });

  it('remembers sound switched off, and back on', () => {
    const storage = memory();
    createPrefs(() => storage).setSound(false);
    expect(createPrefs(() => storage).sound()).toBe(false);
    createPrefs(() => storage).setSound(true);
    expect(createPrefs(() => storage).sound()).toBe(true);
  });

  it('remembers what was chosen', () => {
    const storage = memory();
    const prefs = createPrefs(() => storage);
    prefs.setUnits('mi');
    prefs.setMapSize('large');
    prefs.dismissIntro();
    const later = createPrefs(() => storage);
    expect(later.units()).toBe('mi');
    expect(later.mapSize()).toBe('large');
    expect(later.introSeen()).toBe(true);
  });

  it('ignores a stored value it does not know', () => {
    const prefs = createPrefs(() => memory({ 'plonk.units': 'furlongs', 'plonk.map-size': 'huge' }));
    expect(prefs.units()).toBe('km');
    expect(prefs.mapSize()).toBe('medium');
  });

  it('works without storage: the defaults, and saving does nothing', () => {
    for (const prefs of [createPrefs(() => broken), createPrefs(() => { throw new Error('no storage'); })]) {
      prefs.setUnits('mi');
      prefs.dismissIntro();
      expect(prefs.units()).toBe('km');
      expect(prefs.introSeen()).toBe(false);
    }
  });
});

describe('the units a new browser starts with', () => {
  it('is miles where the browser is set to US or UK English', () => {
    expect(defaultUnits('en-US')).toBe('mi');
    expect(defaultUnits('en-GB')).toBe('mi');
    expect(defaultUnits('en-us')).toBe('mi');
  });

  it('is kilometres everywhere else, and where the browser says nothing', () => {
    for (const locale of ['en', 'en-AU', 'en-CA', 'en-IE', 'de-DE', 'fr-FR', 'es-US', 'ru', '', undefined]) {
      expect(defaultUnits(locale)).toBe('km');
    }
  });

  it('applies only while no choice has been made', () => {
    const storage = memory();
    const prefs = createPrefs(() => storage, () => 'en-US');
    expect(prefs.units()).toBe('mi');
    prefs.setUnits('km');
    expect(createPrefs(() => storage, () => 'en-US').units()).toBe('km');
    expect(createPrefs(() => memory({ 'plonk.units': 'mi' }), () => 'de-DE').units()).toBe('mi');
  });

  it('is kilometres when the browser will not say where it is set', () => {
    const prefs = createPrefs(() => memory(), () => {
      throw new Error('no navigator');
    });
    expect(prefs.units()).toBe('km');
  });
});

describe('road names', () => {
  it('are off until switched on, and the choice is remembered', () => {
    const storage = memory();
    expect(createPrefs(() => storage).roadNames()).toBe(false);
    createPrefs(() => storage).setRoadNames(true);
    expect(createPrefs(() => storage).roadNames()).toBe(true);
    createPrefs(() => storage).setRoadNames(false);
    expect(createPrefs(() => storage).roadNames()).toBe(false);
  });
});

describe('the volume', () => {
  it('starts in the middle and is remembered', () => {
    const storage = memory();
    expect(createPrefs(() => storage).volume()).toBe(DEFAULT_VOLUME);
    createPrefs(() => storage).setVolume(80);
    expect(createPrefs(() => storage).volume()).toBe(80);
    createPrefs(() => storage).setVolume(0);
    expect(createPrefs(() => storage).volume()).toBe(0);
  });

  it('is kept within 0 to 100, whole', () => {
    const storage = memory();
    const prefs = createPrefs(() => storage);
    prefs.setVolume(140);
    expect(prefs.volume()).toBe(100);
    prefs.setVolume(-5);
    expect(prefs.volume()).toBe(0);
    prefs.setVolume(33.4);
    expect(prefs.volume()).toBe(33);
  });

  it('ignores a stored value that is not a volume', () => {
    for (const stored of ['loud', '', '250', '-1', '12.5', 'NaN']) {
      expect(createPrefs(() => memory({ 'plonk.volume': stored })).volume()).toBe(DEFAULT_VOLUME);
    }
  });
});
