import { describe, expect, it } from 'vitest';
import sample from './basemap-liberty.sample.json' with { type: 'json' };
import { MAP_TYPES, TILE_SOURCES, layerBelow, picturesOf } from './map-types.ts';

describe('map types', () => {
  it('are streets, satellite, hybrid and terrain, streets first', () => {
    expect(MAP_TYPES).toEqual(['streets', 'satellite', 'hybrid', 'terrain']);
  });

  it('draw hybrid from the satellite pictures, and streets from none', () => {
    expect(picturesOf('streets')).toBeNull();
    expect(picturesOf('satellite')).toBe('satellite');
    expect(picturesOf('hybrid')).toBe('satellite');
    expect(picturesOf('terrain')).toBe('terrain');
  });

  it('draw satellite and terrain from sources that need no key', () => {
    for (const source of Object.values(TILE_SOURCES)) {
      expect(source.tiles.every((url) => url.startsWith('https://') && url.includes('{z}') && url.includes('{x}') && url.includes('{y}'))).toBe(true);
      expect(source.tiles.some((url) => /key=|token=|apikey/i.test(url))).toBe(false);
      expect(source.maxzoom).toBeGreaterThan(10);
    }
  });
});

describe('layerBelow', () => {
  const layers = [
    { id: 'water', type: 'fill' },
    { id: 'roads', type: 'line' },
    { id: 'road-names', type: 'symbol' },
    { id: 'towns', type: 'symbol' },
  ];

  it('puts the hybrid map’s pictures under the first names, so places can still be read', () => {
    expect(layerBelow('hybrid', layers, 'overlay')).toBe('road-names');
  });

  it('puts satellite pictures over the whole street map: they are pictures alone', () => {
    expect(layerBelow('satellite', layers, 'overlay')).toBe('overlay');
  });

  it('puts the terrain map, which has names of its own, over the whole street map', () => {
    expect(layerBelow('terrain', layers, 'overlay')).toBe('overlay');
  });

  it('goes straight under the game layers on a map with no names', () => {
    expect(layerBelow('hybrid', [{ id: 'water', type: 'fill' }], 'overlay')).toBe('overlay');
  });

  it('covers the buildings and bridges the real style draws after its first symbols, and keeps borders and names', () => {
    const real = sample as Array<{ id: string; type: string }>;
    const under = layerBelow('hybrid', real, 'overlay');
    expect(under).toBe('boundary_3');
    const above = real.slice(real.findIndex((layer) => layer.id === under));
    expect(above.every((layer) => layer.type === 'symbol' || layer.id.startsWith('boundary'))).toBe(true);
    expect(above.map((layer) => layer.id)).toEqual(expect.arrayContaining(['boundary_2', 'label_country_1', 'highway-name-major']));
  });
});
