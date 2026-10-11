import { describe, expect, it } from 'vitest';
import { loadCountryFinder } from './country-finder.ts';

describe('the country finder', () => {
  it('names the country a point is in', async () => {
    const find = await loadCountryFinder();
    expect(find({ lng: 2.35, lat: 48.85 })).toBe('FR');
    expect(find({ lng: 139.69, lat: 35.69 })).toBe('JP');
    expect(find({ lng: -58.38, lat: -34.6 })).toBe('AR');
  });

  it('works at territory level, as the lists of places were built', async () => {
    const find = await loadCountryFinder();
    // Guadeloupe is its own territory here, not France
    expect(find({ lng: -61.55, lat: 16.25 })).toBe('GP');
    expect(find({ lng: -66.1, lat: 18.4 })).toBe('PR');
  });

  it('has no country for the open sea', async () => {
    const find = await loadCountryFinder();
    expect(find({ lng: -40, lat: 30 })).toBeNull();
  });
});
