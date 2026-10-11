import { describe, expect, it } from 'vitest';
import { PREVIEW_PLACES, previewPlaces, stepped } from './map-preview.ts';
import type { MapRow } from './maps.ts';

const rows = (count: number): MapRow[] => Array.from({ length: count }, (_, i) => [`pano-${i}`, i, -i, 'FR']);
const ids = (count: number) => previewPlaces(rows(count)).map((place) => place.id);

describe('the places a map is previewed by', () => {
  it('are five', () => {
    expect(PREVIEW_PLACES).toBe(5);
    expect(ids(5000)).toHaveLength(5);
  });

  it('are all of a map of five, in its order', () => {
    expect(ids(5)).toEqual(['pano-0', 'pano-1', 'pano-2', 'pano-3', 'pano-4']);
  });

  it('are spread evenly through a longer map, starting with its first place', () => {
    expect(ids(10)).toEqual(['pano-0', 'pano-2', 'pano-4', 'pano-6', 'pano-8']);
    expect(ids(6)).toEqual(['pano-0', 'pano-1', 'pano-2', 'pano-3', 'pano-4']);
    expect(ids(5000)).toEqual(['pano-0', 'pano-1000', 'pano-2000', 'pano-3000', 'pano-4000']);
  });

  it('are the same every time, so a preview does not give away a different five on each visit', () => {
    expect(ids(137)).toEqual(ids(137));
    expect(new Set(ids(137)).size).toBe(5);
  });

  it('are every place of a map with fewer than five', () => {
    expect(ids(3)).toEqual(['pano-0', 'pano-1', 'pano-2']);
    expect(ids(0)).toEqual([]);
  });

  it('are places a game could open: id, position and country', () => {
    expect(previewPlaces(rows(5))[1]).toEqual({ id: 'pano-1', lng: 1, lat: -1, country: 'FR' });
  });
});

describe('stepping through them', () => {
  it('goes on to the next and back to the one before', () => {
    expect(stepped(0, 1, 5)).toBe(1);
    expect(stepped(3, -1, 5)).toBe(2);
  });

  it('goes round at either end', () => {
    expect(stepped(4, 1, 5)).toBe(0);
    expect(stepped(0, -1, 5)).toBe(4);
  });

  it('stays put when there is one place or none', () => {
    expect(stepped(0, 1, 1)).toBe(0);
    expect(stepped(0, 1, 0)).toBe(0);
  });
});
