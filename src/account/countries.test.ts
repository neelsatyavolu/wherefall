import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, countryChoices, countryFromLocale, matchingCountries } from './countries.ts';

describe('COUNTRY_CODES', () => {
  it('holds each country once, as two upper-case letters', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(COUNTRY_CODES.length).toBe(250);
  });

  it('holds only codes that have a name', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    expect(COUNTRY_CODES.filter((code) => names.of(code) === undefined)).toEqual([]);
  });
});

describe('countryFromLocale', () => {
  it.each([
    ['en-US', 'US'],
    ['en-GB', 'GB'],
    ['fr-CA', 'CA'],
    ['pt-br', 'BR'],
    ['zh-Hant-TW', 'TW'],
    ['sr-Latn-RS', 'RS'],
    ['de-CH-u-co-phonebk', 'CH'],
  ])('reads the region of %s as %s', (locale, country) => {
    expect(countryFromLocale(locale)).toBe(country);
  });

  it.each([
    ['a language with no region', 'en'],
    ['a region that is a part of the world, not a country', 'es-419'],
    ['a region that is no country', 'en-ZZ'],
    ['a union of countries', 'en-EU'],
    ['something that is no locale', 'not a locale'],
    ['nothing', ''],
  ])('guesses no country for %s', (_, locale) => {
    expect(countryFromLocale(locale)).toBeNull();
  });

  it('guesses no country when the browser names no language', () => {
    expect(countryFromLocale(undefined)).toBeNull();
    expect(countryFromLocale(null)).toBeNull();
  });
});

describe('countryChoices', () => {
  const english = (code: string) => new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  const german = (code: string) => new Intl.DisplayNames(['de'], { type: 'region' }).of(code) ?? code;

  it('names every country and puts them in the order of the language', () => {
    const choices = countryChoices(english, 'en');
    expect(choices).toHaveLength(COUNTRY_CODES.length);
    expect(choices[0]).toEqual({ code: 'AF', name: 'Afghanistan' });
    expect(choices.at(-1)).toEqual({ code: 'ZW', name: 'Zimbabwe' });
  });

  it('sorts by the name in the language, accents where the language puts them', () => {
    const names = countryChoices(german, 'de').map((choice) => choice.name);
    // Ä sorts with A in German, not after Z
    expect(names.indexOf('Ägypten')).toBeLessThan(names.indexOf('Albanien'));
    expect(names.indexOf('Österreich')).toBeLessThan(names.indexOf('Polen'));
  });
});

describe('matchingCountries', () => {
  const choices = [
    { code: 'CI', name: 'Côte d’Ivoire' },
    { code: 'FR', name: 'France' },
    { code: 'GF', name: 'French Guiana' },
    { code: 'TR', name: 'Türkiye' },
  ];
  const codes = (query: string) => matchingCountries(choices, query).map((choice) => choice.code);

  it('gives every country when nothing is typed', () => {
    expect(codes('')).toEqual(['CI', 'FR', 'GF', 'TR']);
    expect(codes('   ')).toEqual(['CI', 'FR', 'GF', 'TR']);
  });

  it('finds a name by any part of it, in any case', () => {
    expect(codes('fr')).toEqual(['FR', 'GF']);
    expect(codes('GUIANA')).toEqual(['GF']);
    expect(codes(' ivoire ')).toEqual(['CI']);
  });

  it('finds a name typed without its accents', () => {
    expect(codes('cote')).toEqual(['CI']);
    expect(codes('turkiye')).toEqual(['TR']);
    expect(codes('Türk')).toEqual(['TR']);
  });

  it('finds nothing for a name no country has', () => {
    expect(codes('atlantis')).toEqual([]);
  });

  it('leaves the list it was given as it was', () => {
    const before = [...choices];
    matchingCountries(choices, 'fr');
    expect(choices).toEqual(before);
  });
});
