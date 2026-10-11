import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTINENTS, continentOf, countriesOf } from './continents.ts';
import { parseLocationSet } from './locations.ts';

const at = (country: string, lng = 0, lat = 0) => ({ id: 'x', lng, lat, country });

describe('continentOf', () => {
  it('has six continents', () => {
    expect(CONTINENTS).toEqual(['africa', 'asia', 'europe', 'north-america', 'oceania', 'south-america']);
  });

  it('names the continent of a country', () => {
    expect(continentOf(at('KE'))).toBe('africa');
    expect(continentOf(at('JP'))).toBe('asia');
    expect(continentOf(at('FR'))).toBe('europe');
    expect(continentOf(at('MX'))).toBe('north-america');
    expect(continentOf(at('NZ'))).toBe('oceania');
    expect(continentOf(at('BR'))).toBe('south-america');
  });

  it('splits the two regions the place lists lump together', () => {
    // "americas" in the lists
    expect(continentOf(at('US'))).toBe('north-america');
    expect(continentOf(at('GL'))).toBe('north-america');
    expect(continentOf(at('PA'))).toBe('north-america');
    expect(continentOf(at('CO'))).toBe('south-america');
    // "asia-oceania" in the lists
    expect(continentOf(at('AU'))).toBe('oceania');
    expect(continentOf(at('GU'))).toBe('oceania');
    expect(continentOf(at('ID'))).toBe('asia');
    expect(continentOf(at('TR'))).toBe('asia');
  });

  it('puts Russia in Europe west of the Urals and in Asia east of them', () => {
    expect(continentOf(at('RU', 37.6, 55.7))).toBe('europe');
    expect(continentOf(at('RU', 59.9, 56.8))).toBe('europe');
    expect(continentOf(at('RU', 60, 56.8))).toBe('asia');
    expect(continentOf(at('RU', 131.9, 43.1))).toBe('asia');
    // Chukotka lies past the date line
    expect(continentOf(at('RU', -173, 64.4))).toBe('asia');
  });

  it('has no continent for Antarctica or a code that is no country', () => {
    expect(continentOf(at('AQ'))).toBeNull();
    expect(continentOf(at('ZZ'))).toBeNull();
  });

  it('lists each country under one continent only', () => {
    const all = CONTINENTS.flatMap((continent) => countriesOf(continent));
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(countriesOf('europe')).toContain('RU');
  });

  it.each(['locations.json', 'locations.google.json'])('knows every country in %s but Antarctica', (file) => {
    const set = parseLocationSet(JSON.parse(readFileSync(new URL(`../../public/${file}`, import.meta.url), 'utf8')));
    const unplaced = new Set(set.locations.filter((location) => continentOf(location) === null).map((location) => location.country));
    expect([...unplaced].filter((code) => code !== 'AQ')).toEqual([]);
  });
});
