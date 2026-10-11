/**
 * The street map in the game's own colours. The map's style (OpenFreeMap "liberty") is kept whole:
 * every layer, every width, every zoom rule. Only its colours are replaced, by tones mixed from the
 * two tokens of the scheme in use, canvas and ink, so the map is a drawing in the page's own ink
 * and the accent stays free for the pins. A pure function from style to style: `themeStyle`.
 */

/** What the map is drawn on: an ink-dark ground with pale lines, or paper with dark ones. */
export type Ground = 'dark' | 'light';

/** The canvas and the ink of each scheme, as `styles.css` has them. */
export const GROUND_TOKENS: Readonly<Record<Ground, { bg: string; fg: string }>> = {
  dark: { bg: '#0e0e0d', fg: '#f2f0ea' },
  light: { bg: '#f7f5ef', fg: '#16161a' },
};

/**
 * Each tone as its share of ink over canvas: 0 is the canvas, 1 the ink. The dark map is kept
 * lighter than a page (land at 0.14 of ink, not the canvas itself) so that streets, buildings and
 * water stay apart at street level, where a pin is placed.
 */
const SHARES = {
  dark: {
    land: 0.14,
    water: 0.03,
    green: 0.08,
    residential: 0.16,
    landuse: 0.17,
    ice: 0.24,
    sand: 0.18,
    building: 0.22,
    buildingEdge: 0.32,
    motorway: 0.5,
    main: 0.38,
    street: 0.28,
    path: 0.46,
    motorwayCasing: 0.82,
    mainCasing: 0.03,
    streetCasing: 0.03,
    rail: 0.42,
    border: 0.62,
    borderMinor: 0.4,
    place: 1,
    minor: 0.76,
    road: 1,
    waterName: 0.58,
  },
  light: {
    land: 0,
    water: 0.15,
    green: 0.06,
    residential: 0.03,
    landuse: 0.05,
    ice: 0,
    sand: 0.04,
    building: 0.12,
    buildingEdge: 0.28,
    motorway: 0.38,
    main: 0.27,
    street: 0.17,
    path: 0.46,
    motorwayCasing: 0.72,
    mainCasing: 0.48,
    streetCasing: 0.32,
    rail: 0.42,
    border: 0.58,
    borderMinor: 0.34,
    place: 1,
    minor: 0.78,
    road: 0.92,
    waterName: 0.76,
  },
} as const satisfies Record<Ground, Record<string, number>>;

export type Tone = keyof (typeof SHARES)['dark'];
export type Tones = Readonly<Record<Tone, string>>;

/** The relief picture under the land at world zoom: its own greens and blues taken out, and dimmed on the dark map. */
const RELIEF: Readonly<Record<Ground, Record<string, number>>> = {
  dark: { 'raster-saturation': -1, 'raster-brightness-min': 0.06, 'raster-brightness-max': 0.34 },
  light: { 'raster-saturation': -1, 'raster-brightness-min': 0.72, 'raster-brightness-max': 1 },
};

/**
 * Patterned fills (a marsh, a paved square) are small pictures with colours of their own, green
 * leaves among them, which no token made: on either ground they are let through only faintly, so
 * the area still reads as one of its kind and the map stays a drawing in the page's ink.
 */
const PATTERN_OPACITY: Readonly<Record<Ground, number>> = { dark: 0.12, light: 0.2 };

type Rgb = readonly [number, number, number];

const parseHex = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;
const toHex = (rgb: Rgb): string => `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/** `share` of `ink` over `canvas`, as a hex colour. */
export function mix(canvas: string, ink: string, share: number): string {
  const [from, to] = [parseHex(canvas), parseHex(ink)];
  return toHex([0, 1, 2].map((channel) => from[channel]! + (to[channel]! - from[channel]!) * share) as unknown as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two hex colours, from 1 to 21. */
export function contrast(one: string, other: string): number {
  const [low, high] = [luminance(one), luminance(other)].sort((a, b) => a - b) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** Every tone of a ground as a colour. */
export function tonesFor(ground: Ground): Tones {
  const { bg, fg } = GROUND_TOKENS[ground];
  return Object.fromEntries(Object.entries(SHARES[ground]).map(([tone, share]) => [tone, mix(bg, fg, share)])) as Record<Tone, string>;
}

export interface StyleLayer {
  id: string;
  type: string;
  /** the source a layer draws from; the background has none */
  source?: string;
  paint?: Record<string, unknown>;
}

type Paint = Record<string, unknown>;

/** A road's rank, read off its layer's name: motorway, main road, street or path. */
export function roadRank(id: string): 'motorway' | 'main' | 'street' | 'path' {
  if (id.includes('motorway')) {
    return 'motorway';
  }
  if (id.includes('path_pedestrian')) {
    return 'path';
  }
  return /trunk_primary|secondary_tertiary|_link/.test(id) ? 'main' : 'street';
}

const LANDUSE = /^(landuse_(pitch|track|cemetery|hospital|school)|aeroway_fill)$/;
const GREEN = /^(park|landcover_(wood|grass))$/;
const PLACES = /^label_(country|city|town|village)/;

function fillPaint(layer: StyleLayer, tones: Tones, ground: Ground): Paint {
  const { id } = layer;
  if (layer.paint && 'fill-pattern' in layer.paint) {
    return { 'fill-opacity': PATTERN_OPACITY[ground] };
  }
  if (id === 'building') {
    return { 'fill-color': tones.building, 'fill-outline-color': tones.buildingEdge };
  }
  if (id === 'park') {
    return { 'fill-color': tones.green, 'fill-outline-color': tones.green };
  }
  const tone: Tone = id === 'water' ? 'water' : GREEN.test(id) ? 'green' : id === 'landcover_ice' ? 'ice' : id === 'landcover_sand' ? 'sand' : LANDUSE.test(id) ? 'landuse' : 'residential';
  return { 'fill-color': tones[tone] };
}

function linePaint({ id }: StyleLayer, tones: Tones): Paint {
  if (id.startsWith('waterway')) {
    return { 'line-color': tones.water };
  }
  if (id.startsWith('boundary')) {
    return { 'line-color': id === 'boundary_3' ? tones.borderMinor : tones.border };
  }
  if (id === 'park_outline') {
    return { 'line-color': tones.green };
  }
  if (id.startsWith('aeroway')) {
    return { 'line-color': tones.street };
  }
  if (id.includes('_rail')) {
    return { 'line-color': tones.rail };
  }
  const rank = roadRank(id);
  if (id.endsWith('_casing')) {
    return { 'line-color': rank === 'motorway' ? tones.motorwayCasing : rank === 'main' ? tones.mainCasing : tones.streetCasing };
  }
  // a tunnel is the same road seen through the ground: half way back to the land
  return { 'line-color': id.startsWith('tunnel_') ? mix(tones.land, tones[rank], 0.5) : tones[rank] };
}

function symbolPaint({ id, paint }: StyleLayer, tones: Tones): Paint {
  if (!paint || !('text-color' in paint)) {
    // a road's number on its shield, a one-way arrow: pictures with their own colours
    return {};
  }
  if (id.startsWith('water')) {
    return { 'text-color': tones.waterName, 'text-halo-color': tones.water };
  }
  const tone: Tone = PLACES.test(id) ? 'place' : id.startsWith('highway-name') && id !== 'highway-name-path' ? 'road' : 'minor';
  return { 'text-color': tones[tone], 'text-halo-color': tones.land };
}

/** The colours a layer is given, by its type and name. Nothing for a layer the theme has no say over. */
export function themedPaint(layer: StyleLayer, ground: Ground): Paint {
  const tones = tonesFor(ground);
  switch (layer.type) {
    case 'background':
      return { 'background-color': tones.land };
    case 'raster':
      return RELIEF[ground];
    case 'fill':
      return fillPaint(layer, tones, ground);
    case 'fill-extrusion':
      return { 'fill-extrusion-color': tones.building };
    case 'line':
      return linePaint(layer, tones);
    case 'symbol':
      return symbolPaint(layer, tones);
    default:
      return {};
  }
}

/**
 * What a layer is drawn in over satellite pictures (the hybrid map), whatever scheme the page is
 * in: names in the dark map's pale tones with a halo of its canvas, the darkest there is, and
 * borders in its pale line. Nothing for a layer the pictures cover. Only properties the theme
 * itself sets are touched, so `repaint` puts every one back when the map goes back to streets.
 */
export function overPictures(layer: StyleLayer): Paint {
  if (layer.type === 'symbol') {
    const themed = symbolPaint(layer, tonesFor('dark'));
    return 'text-color' in themed ? { ...themed, 'text-halo-color': GROUND_TOKENS.dark.bg } : {};
  }
  return layer.type === 'line' && layer.id.startsWith('boundary') ? themedPaint(layer, 'dark') : {};
}

const GROUNDS: readonly Ground[] = ['dark', 'light'];

/**
 * What to set on a layer that is already on a map when the ground changes: every property either
 * ground's theme touches, at this ground's value, or back at the style's own where this ground
 * leaves it alone (undefined where the style had none, which puts the property back to its default).
 */
export function repaint(layer: StyleLayer, ground: Ground): Paint {
  const themed = themedPaint(layer, ground);
  const touched = new Set(GROUNDS.flatMap((each) => Object.keys(themedPaint(layer, each))));
  return Object.fromEntries([...touched].map((name) => [name, name in themed ? themed[name] : layer.paint?.[name]]));
}

/**
 * The style without its relief picture, and without the source only that picture drew from. Under
 * the land at world zoom the style lays shaded relief: some thirty pictures of about 190 KB for
 * every step of zoom, several megabytes that the first zooms of a round wait behind, for a ground
 * the theme dims almost to nothing. The style given is left as it was.
 */
export function withoutRelief<Style extends { layers: readonly StyleLayer[]; sources?: Readonly<Record<string, unknown>> }>(style: Style): Style {
  const layers = style.layers.filter((layer) => layer.type !== 'raster');
  if (!style.sources) {
    return { ...style, layers };
  }
  const used = new Set(layers.map((layer) => layer.source));
  const dropped = new Set(style.layers.filter((layer) => layer.type === 'raster').map((layer) => layer.source));
  const sources = Object.fromEntries(Object.entries(style.sources).filter(([name]) => used.has(name) || !dropped.has(name)));
  return { ...style, layers, sources };
}

/** A style with every layer it had, in the same order, recoloured for a ground. The style given is left as it was. */
export function themeStyle<Style extends { layers: readonly StyleLayer[] }>(style: Style, ground: Ground): Style {
  return { ...style, layers: style.layers.map((layer) => ({ ...layer, paint: { ...layer.paint, ...themedPaint(layer, ground) } })) } as Style;
}
