import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { LANGUAGES, LANGUAGE_NAMES, format, formatNumber, language, pickLanguage, t, tn, useLanguage } from './index.ts';

afterEach(() => useLanguage('en'));

describe('pickLanguage', () => {
  it("follows the browser's languages, in order, skipping ones the interface does not have", () => {
    expect(pickLanguage(null, null, ['de-AT', 'en'])).toBe('de');
    expect(pickLanguage(null, null, ['pt-BR', 'ru', 'en'])).toBe('ru');
    expect(pickLanguage(null, null, ['ja'])).toBe('en');
    expect(pickLanguage(null, null, [])).toBe('en');
  });

  it('prefers what the player chose before', () => {
    expect(pickLanguage(null, 'fr', ['de'])).toBe('fr');
  });

  it('lets the address force a language over both', () => {
    expect(pickLanguage('es', 'fr', ['de'])).toBe('es');
    expect(pickLanguage('ES', null, [])).toBe('es');
  });

  it('ignores a language it does not have, wherever it comes from', () => {
    expect(pickLanguage('xx', 'klingon', ['fr-CA'])).toBe('fr');
  });
});

describe('format', () => {
  it('puts values in their places', () => {
    expect(format('Saved to {name}, {points} points', { name: 'neel', points: 12 })).toBe('Saved to neel, 12 points');
  });

  it('leaves a place with no value alone, and a string with no places as it is', () => {
    expect(format('Hello {who}')).toBe('Hello {who}');
    expect(format('Plain')).toBe('Plain');
  });
});

describe('the catalogs', () => {
  it('speaks English until told otherwise', () => {
    expect(language()).toBe('en');
    expect(t('language.name')).toBe(en['language.name']);
    expect(formatNumber(12345)).toBe('12,345');
  });

  it.each(LANGUAGES)('loads %s and names it in its own words', async (code) => {
    await useLanguage(code);
    expect(language()).toBe(code);
    expect(LANGUAGE_NAMES[code].length).toBeGreaterThan(3);
    expect(t('language.name').length).toBeGreaterThan(0);
  });

  it('writes numbers for the language in use', async () => {
    await useLanguage('de');
    expect(formatNumber(12345)).toBe('12.345');
  });

  it('has every English key in every language, with the same places to fill', async () => {
    const places = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const code of LANGUAGES) {
      await useLanguage(code);
      for (const key of Object.keys(en) as Array<keyof typeof en>) {
        expect(t(key).trim().length, `${code} ${key}`).toBeGreaterThan(0);
        expect(places(t(key)), `${code} ${key}`).toEqual(places(en[key]));
      }
    }
  });

  it('has no key in another language that English lacks, apart from plural forms', async () => {
    const english = new Set(Object.keys(en));
    const modules = { es: () => import('./es.ts'), fr: () => import('./fr.ts'), de: () => import('./de.ts'), ru: () => import('./ru.ts') };
    for (const [code, load] of Object.entries(modules)) {
      const catalog = Object.values(await load())[0] as Record<string, string>;
      const strays = Object.keys(catalog).filter((key) => !english.has(key) && !english.has(key.replace(/\.(zero|two|few|many)$/, '.other')));
      expect(strays, code).toEqual([]);
    }
  });

  it('leaves no sentence in English in another language', async () => {
    // what is left of a string once the values put into it and the names nobody translates are taken out
    const words = (text: string) => text.replace(/\{\w+\}|Wherefall|Google|Street View|Panoramax|OpenStreetMap|OpenFreeMap|OpenTopoMap|XP/g, '').split(/\s+/).filter((word) => /\p{L}/u.test(word));
    const sentences = (Object.keys(en) as Array<keyof typeof en>).filter((key) => words(en[key]).length >= 3);
    for (const code of LANGUAGES.filter((other) => other !== 'en')) {
      await useLanguage(code);
      expect(sentences.filter((key) => t(key) === en[key]), code).toEqual([]);
    }
  });

  it('has every plural form Russian needs', async () => {
    await useLanguage('ru');
    expect([1, 3, 5, 21].map((count) => tn('queue.waiting', count))).toEqual(['1 игрок ждёт', '3 игрока ждут', '5 игроков ждут', '21 игрок ждёт']);
    expect([1, 2, 11].map((count) => tn('settings.rounds', count))).toEqual(['1 раунд', '2 раунда', '11 раундов']);
  });
});
