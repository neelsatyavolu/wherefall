import { describe, expect, it } from 'vitest';
import { presetState, readPreset, roundsProblem, type MapPreset } from './map-preset.ts';

const paris: MapPreset = { map: 'community:paris-walk-x7k2', name: 'Paris walk', places: 6 };

describe('a preset map', () => {
  it('survives the trip through a history entry', () => {
    expect(readPreset(presetState(paris))).toEqual(paris);
    expect(readPreset(JSON.parse(JSON.stringify(presetState({ map: 'country:KE', name: 'Kenya', places: null }))))).toEqual({ map: 'country:KE', name: 'Kenya', places: null });
  });

  it('ignores a state that is not a preset', () => {
    for (const state of [null, undefined, 7, {}, { preset: null }, { preset: { map: 'mars', name: 'Mars' } }, { preset: { map: 'world' } }]) {
      expect(readPreset(state)).toBeNull();
    }
  });

  it('treats a missing place count as no limit', () => {
    expect(readPreset({ preset: { map: 'europe', name: 'Europe', places: 'many' } })).toEqual({ map: 'europe', name: 'Europe', places: null });
  });
});

describe('roundsProblem', () => {
  it('says when the map has fewer places than rounds', () => {
    expect(roundsProblem(paris, paris.map, 10)).toBe('Paris walk has 6 places. Choose fewer rounds.');
  });

  it('is fine with enough places, another map, or no preset', () => {
    expect(roundsProblem(paris, paris.map, 5)).toBeNull();
    expect(roundsProblem(paris, 'world', 10)).toBeNull();
    expect(roundsProblem(null, 'world', 10)).toBeNull();
    expect(roundsProblem({ ...paris, places: null }, paris.map, 10)).toBeNull();
  });
});
