import type { StyleLayer } from './basemap-theme.ts';

/**
 * City names for the map while it is zoomed out. The tiles carry every city only from zoom 7:
 * further out they have a handful to a screen, so a country shows a few names and then all of them
 * at once. Until then the names are drawn from a list of the game's own (`public/cities.json`,
 * built by `scripts/build-cities.ts`), in layers that are the style's city layers in every way but
 * where their names come from. From zoom 7 the style's own layers take over.
 */
export const CITY_NAMES = 'city-names';
/** the zoom the tiles carry every city from, and their own names are drawn from */
export const NEAR_ZOOM = 7;
/** further out than this the map is the whole world, with room for countries' names only */
const FAR_ZOOM = 1;
/** how many zooms sooner than the list says a city is named: its zooms are Natural Earth's, for a busier map than this one, which has the room */
const ZOOM_AHEAD = 2;

/** The style's city layers, and whether each is the one for capitals. */
const CAPITALS: Readonly<Record<string, boolean>> = { label_city: false, label_city_capital: true };

interface NameLayer extends StyleLayer {
  layout?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
}

/** A city layer's twin: the same letters, sizes and colours, with its names from the list. */
function fromList(layer: NameLayer, capital: boolean): NameLayer {
  return {
    id: `${layer.id}_far`,
    type: layer.type,
    source: CITY_NAMES,
    minzoom: FAR_ZOOM,
    maxzoom: NEAR_ZOOM,
    filter: ['all', ['<=', ['get', 'zoom'], ['+', ['zoom'], ZOOM_AHEAD]], [capital ? '==' : '!=', ['get', 'capital'], true]],
    // where two names would overlap, the one drawn from further out stays: zooming in adds names and takes none away
    layout: { ...layer.layout, 'text-field': ['get', 'name'], 'symbol-sort-key': ['get', 'zoom'] },
    paint: layer.paint,
  };
}

/**
 * The style with the list of cities at `data` drawn under its own city names, which wait for zoom
 * 7. A style with no city layers is given back as it was. The style given is left as it was.
 */
export function withCityNames<Style extends { layers: readonly StyleLayer[]; sources?: Readonly<Record<string, unknown>> }>(style: Style, data: string): Style {
  if (!style.layers.some((layer) => layer.id in CAPITALS)) {
    return style;
  }
  const layers = style.layers.flatMap((layer: NameLayer) => {
    const capital = CAPITALS[layer.id];
    return capital === undefined ? [layer] : [fromList(layer, capital), { ...layer, minzoom: NEAR_ZOOM }];
  });
  return { ...style, layers, sources: { ...style.sources, [CITY_NAMES]: { type: 'geojson', data } } };
}
