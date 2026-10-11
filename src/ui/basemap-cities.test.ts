import { describe, expect, it } from 'vitest';
import { CITY_NAMES, NEAR_ZOOM, withCityNames } from './basemap-cities.ts';
import { themedPaint } from './basemap-theme.ts';

const CITIES = '/cities.json';

const city = {
  id: 'label_city',
  type: 'symbol',
  source: 'openmaptiles',
  'source-layer': 'place',
  minzoom: 3,
  filter: ['==', ['get', 'class'], 'city'],
  layout: { 'text-field': ['get', 'name_en'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
  paint: { 'text-color': '#000' },
};
const capital = { ...city, id: 'label_city_capital', layout: { ...city.layout, 'text-font': ['Noto Sans Bold'] } };
const town = { ...city, id: 'label_town', minzoom: 6 };
const water = { id: 'water', type: 'fill', source: 'openmaptiles', paint: { 'fill-color': '#00f' } };
const style = { version: 8, sources: { openmaptiles: { type: 'vector', url: 'https://tiles.example/planet' } }, layers: [water, town, city, capital] };

const layerOf = (id: string) => withCityNames(style, CITIES).layers.find((layer) => layer.id === id);

describe('withCityNames', () => {
  it('leaves a style with no city names as it was, as the browser tests serve it', () => {
    const empty = { version: 8, sources: {}, layers: [] };
    expect(withCityNames(empty, CITIES)).toEqual(empty);
    expect(withCityNames({ ...style, layers: [water, town] }, CITIES)).toEqual({ ...style, layers: [water, town] });
  });

  it('adds the list of cities as a source of its own, beside the style’s', () => {
    expect(withCityNames(style, CITIES).sources).toEqual({ ...style.sources, [CITY_NAMES]: { type: 'geojson', data: CITIES } });
  });

  it('puts a layer of the list’s names under each of the style’s two city layers, and keeps every other layer in order', () => {
    expect(withCityNames(style, CITIES).layers.map((layer) => layer.id)).toEqual(['water', 'label_town', 'label_city_far', 'label_city', 'label_city_capital_far', 'label_city_capital']);
    expect(layerOf('water')).toEqual(water);
    expect(layerOf('label_town')).toEqual(town);
  });

  it('draws the list’s names up to the zoom the tiles’ own take over at, with no gap and no zoom drawn twice', () => {
    expect(layerOf('label_city_far')).toMatchObject({ source: CITY_NAMES, maxzoom: NEAR_ZOOM });
    expect(layerOf('label_city')).toEqual({ ...city, minzoom: NEAR_ZOOM });
    expect(layerOf('label_city_capital')).toEqual({ ...capital, minzoom: NEAR_ZOOM });
  });

  it('draws a name from the list as the style draws its own: the same letters, sizes and colours, and capitals in theirs', () => {
    const far = layerOf('label_city_far');
    expect(far).toMatchObject({ type: 'symbol', paint: city.paint, layout: { ...city.layout, 'text-field': ['get', 'name'] } });
    expect(far).not.toHaveProperty('source-layer');
    expect(layerOf('label_city_capital_far')).toMatchObject({ layout: { 'text-font': ['Noto Sans Bold'], 'text-field': ['get', 'name'] } });
  });

  it('names a city two zooms sooner than the list says, capitals in the capitals’ layer and the rest in the other', () => {
    const fromItsZoom = ['<=', ['get', 'zoom'], ['+', ['zoom'], 2]];
    expect(layerOf('label_city_far')).toHaveProperty('filter', ['all', fromItsZoom, ['!=', ['get', 'capital'], true]]);
    expect(layerOf('label_city_capital_far')).toHaveProperty('filter', ['all', fromItsZoom, ['==', ['get', 'capital'], true]]);
  });

  it('where names would overlap, keeps the one that was drawn from further out', () => {
    expect(layerOf('label_city_far')).toMatchObject({ layout: { 'symbol-sort-key': ['get', 'zoom'] } });
  });

  it.each(['dark', 'light'] as const)('is coloured by the %s theme as the style’s own city names are', (ground) => {
    for (const id of ['label_city', 'label_city_capital']) {
      expect(themedPaint(layerOf(`${id}_far`)!, ground)).toEqual(themedPaint(layerOf(id)!, ground));
    }
  });

  it('does not change the style it is given', () => {
    const before = structuredClone(style);
    withCityNames(style, CITIES);
    expect(style).toEqual(before);
  });
});
