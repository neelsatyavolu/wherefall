import type maplibregl from 'maplibre-gl';
import { t } from '../i18n/index.ts';
import { el, withNodes } from './dom.ts';
import { MAP_TYPES, type MapType } from './prefs.ts';

/**
 * What the guess map can be drawn as. Streets is the map's own style. Satellite and terrain are
 * pictures laid over it, from sources that ask for no key and no payment on a free site, and that
 * say how they are to be credited. Hybrid is the satellite pictures with the street map's names
 * and borders drawn over them. The credit is on the map for as long as the type is in use.
 */
export { MAP_TYPES, type MapType };
/** the pictures there are: the hybrid map has none of its own */
type TileType = 'satellite' | 'terrain';

/** The pictures a type is drawn from, or null for the street map, which is drawn from none. */
export const picturesOf = (type: MapType): TileType | null => (type === 'streets' ? null : type === 'terrain' ? 'terrain' : 'satellite');

interface TileSource {
  tiles: readonly string[];
  /** the deepest level the source has; the map stretches it beyond that */
  maxzoom: number;
}

const EOX_YEAR = 2024;
const EOX_HOME = 'https://cloudless.eox.at';
const EOX_COMPANY = 'https://eox.at';
const EOX_LICENCE = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
/** the wording EOX asks for, word for word: it is not put into the player's language */
const EOX_WORDS = { name: 'EOxCloudless', by: 'by', company: 'EOX IT Services GmbH', data: `(Contains modified Copernicus Sentinel data ${EOX_YEAR})`, licence: 'CC BY-NC-SA 4.0' };
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
/** whose the street map is, as its own style credits it: said beside the pictures' credit while its names are over them */
const STREETS_HOME = 'https://openfreemap.org';
const STREETS_TILES = 'https://www.openmaptiles.org/';
const TOPO_HOME = 'https://opentopomap.org';
const TOPO_LICENCE = 'https://creativecommons.org/licenses/by-sa/3.0/';

export const TILE_SOURCES: Readonly<Record<TileType, TileSource>> = {
  /**
   * EOxCloudless: Sentinel-2 pictures with the clouds taken out, by EOX IT Services. Free for
   * non-commercial use with this credit (CC BY-NC-SA 4.0); the 2016 layer, `s2cloudless_3857`, is
   * CC BY 4.0 and is the one to switch to if the site ever earns money.
   */
  satellite: {
    tiles: [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`],
    maxzoom: 14,
  },
  /** OpenTopoMap: a topographic map drawn from OpenStreetMap and SRTM heights, CC-BY-SA, free to embed with this credit. */
  terrain: {
    tiles: ['a', 'b', 'c'].map((host) => `https://${host}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    maxzoom: 17,
  },
};

const TILE_TYPES = Object.keys(TILE_SOURCES) as TileType[];
const layerId = (type: TileType) => `tiles-${type}`;
const link = (text: string, href: string) => el('a', { text, attrs: { href, target: '_blank', rel: 'noopener' } });

const isShown = (part: unknown): part is Node | string => Boolean(part);

function satelliteCredit(): Array<Node | string> {
  const { name, by, company, data, licence } = EOX_WORDS;
  return [`${name} `, link(EOX_HOME, EOX_HOME), ` ${by} `, link(company, EOX_COMPANY), ` ${data} `, link(licence, EOX_LICENCE)];
}

/** Whose names and borders are over the pictures of the hybrid map: the street map's own credit, in full view with the pictures'. */
function streetsCredit(): Array<Node | string> {
  const nodes = { free: link('OpenFreeMap', STREETS_HOME), tiles: link('OpenMapTiles', STREETS_TILES), osm: link('OpenStreetMap', OSM_COPYRIGHT) };
  return withNodes(t('guessMap.credit.hybrid'), nodes).filter(isShown);
}

/**
 * The credit to show on the map while a type is in use, as text and links. Nothing for streets:
 * the map library shows that one itself, folded behind its own button, and these are not given to
 * it, so each credit is on the map once and in full view. The hybrid map has two: the pictures'
 * and, on a line of its own, the street map's, whose names and borders are what is read on it.
 */
export function mapCredit(type: MapType): Array<Node | string> {
  if (type === 'satellite') {
    return satelliteCredit();
  }
  if (type === 'hybrid') {
    return [...satelliteCredit(), el('span', { class: 'map-credit-line' }, ...streetsCredit())];
  }
  if (type === 'terrain') {
    const nodes = { osm: link('OpenStreetMap', OSM_COPYRIGHT), topo: link('OpenTopoMap', TOPO_HOME), licence: link('CC-BY-SA', TOPO_LICENCE) };
    return withNodes(t('guessMap.credit.terrain'), nodes).filter(isShown);
  }
  return [];
}

const AREAS = new Set(['fill', 'fill-extrusion']);

/**
 * The layer a type's pictures go under. On the hybrid map they sit under the street map's names
 * and borders: over every area it draws (the last of which is its buildings, with its roads and
 * bridges before them), and under the first border or name after that. Satellite is the pictures
 * alone, and the terrain map has names of its own: both cover the street map whole. `overlay` is
 * the lowest of the game's layers (hint, pins' lines), which stay on top of them all.
 */
export function layerBelow(type: MapType, layers: ReadonlyArray<{ id: string; type: string }>, overlay: string): string {
  if (type !== 'hybrid') {
    return overlay;
  }
  const lastArea = layers.reduce((last, layer, index) => (AREAS.has(layer.type) ? index : last), -1);
  const afterAreas = layers.slice(lastArea + 1);
  return afterAreas.find((layer) => layer.type === 'symbol' || layer.id.startsWith('boundary'))?.id ?? overlay;
}

/** The street map's own layers as they are on the map: everything under the game's layers, less the pictures put among them. */
function streetLayers(map: maplibregl.Map, overlay: string): Array<{ id: string; type: string }> {
  const all = map.getStyle().layers ?? [];
  const game = all.findIndex((layer) => layer.id === overlay);
  return (game < 0 ? all : all.slice(0, game)).filter((layer) => !TILE_TYPES.some((each) => layerId(each) === layer.id));
}

/**
 * Draws the map as a type. A type's pictures are only asked for once it is chosen, and are put
 * where that type has them: satellite and hybrid share theirs, over the street map's names for the
 * one and under them for the other.
 */
export function showMapType(map: maplibregl.Map, type: MapType, overlay: string): void {
  const wanted = picturesOf(type);
  for (const each of TILE_TYPES) {
    const id = layerId(each);
    if (each === wanted && !map.getSource(id)) {
      const source = TILE_SOURCES[each];
      map.addSource(id, { type: 'raster', tiles: [...source.tiles], tileSize: 256, maxzoom: source.maxzoom });
      map.addLayer({ id, type: 'raster', source: id }, overlay);
    }
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', each === wanted ? 'visible' : 'none');
    }
  }
  if (wanted) {
    map.moveLayer(layerId(wanted), layerBelow(type, streetLayers(map, overlay), overlay));
  }
}
