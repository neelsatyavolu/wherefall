import { describe, expect, it } from 'vitest';
import sample from './basemap-liberty.sample.json' with { type: 'json' };
import { GROUND_TOKENS, contrast, mix, overPictures, repaint, roadRank, themeStyle, themedPaint, tonesFor, withoutRelief, type Ground, type StyleLayer } from './basemap-theme.ts';

// `basemap-liberty.sample.json` is the real style's layers (id, type, source layer, paint) as
// OpenFreeMap served them on 2026-10-11: the browser tests stand the style in with an empty one.

const layers = sample as StyleLayer[];
const GROUNDS: Ground[] = ['dark', 'light'];
const AA = 4.5;

const painted = (ground: Ground) => new Map(themeStyle({ layers }, ground).layers.map((layer) => [layer.id, layer.paint ?? {}]));
const colour = (ground: Ground, id: string, key: string) => painted(ground).get(id)![key] as string;

describe('mix and contrast', () => {
  it('mixes ink into canvas by a share', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('measures contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#ffffff', '#777777')).toBeCloseTo(4.48, 2);
  });
});

describe('themeStyle', () => {
  it('leaves an empty style empty, as the browser tests serve it', () => {
    expect(themeStyle({ version: 8, sources: {}, layers: [] }, 'dark')).toEqual({ version: 8, sources: {}, layers: [] });
  });

  it.each(GROUNDS)('keeps every layer of the %s map, in order, and changes nothing but colours', (ground) => {
    const themed = themeStyle({ layers }, ground).layers;
    expect(themed.map((layer) => layer.id)).toEqual(layers.map((layer) => layer.id));
    const allowed = /color$|^raster-(saturation|brightness-min|brightness-max)$/;
    themed.forEach((layer, index) => {
      const before = layers[index]!;
      expect(layer.type).toBe(before.type);
      for (const [key, value] of Object.entries(layer.paint ?? {})) {
        const patterned = 'fill-pattern' in (before.paint ?? {}) && key === 'fill-opacity';
        if (!allowed.test(key) && !patterned) {
          expect(value, `${layer.id} ${key}`).toEqual(before.paint?.[key]);
        }
      }
      // nothing the style drew with is dropped: widths, dashes, opacities and patterns are all still there
      expect(Object.keys(layer.paint ?? {})).toEqual(expect.arrayContaining(Object.keys(before.paint ?? {})));
    });
  });

  it('does not change the style it is given', () => {
    const before = JSON.stringify(layers);
    themeStyle({ layers }, 'dark');
    expect(JSON.stringify(layers)).toBe(before);
  });

  it.each(GROUNDS)('leaves no colour of the original %s style behind on a layer it themes', (ground) => {
    const tones = new Set(Object.values(tonesFor(ground)));
    for (const layer of themeStyle({ layers }, ground).layers) {
      for (const [key, value] of Object.entries(layer.paint ?? {})) {
        if (key.endsWith('color') && typeof value === 'string' && !layer.id.startsWith('tunnel_')) {
          expect(tones.has(value), `${layer.id} ${key} ${value}`).toBe(true);
        }
      }
    }
  });

  it.each(GROUNDS)('draws the %s land and water from the scheme tokens', (ground) => {
    const { bg, fg } = GROUND_TOKENS[ground];
    expect(colour(ground, 'background', 'background-color')).toBe(tonesFor(ground).land);
    expect(colour(ground, 'water', 'fill-color')).toBe(tonesFor(ground).water);
    // every tone lies between the canvas and the ink
    for (const tone of Object.values(tonesFor(ground))) {
      expect(contrast(tone, bg)).toBeLessThanOrEqual(contrast(fg, bg) + 0.001);
    }
  });
});

describe('repaint', () => {
  const wetland = layers.find((layer) => layer.id === 'landcover_wetland')!;
  const pattern = layers.find((layer) => layer.id === 'road_area_pattern')!;

  it('gives a layer the colours of the ground the page has gone to', () => {
    const water = layers.find((layer) => layer.id === 'water')!;
    expect(repaint(water, 'light')).toEqual({ 'fill-color': tonesFor('light').water });
    expect(repaint(water, 'dark')).toEqual({ 'fill-color': tonesFor('dark').water });
  });

  it('lets a patterned fill through only faintly on either ground: its picture has colours of its own, which are not the page’s', () => {
    expect(repaint(wetland, 'dark')).toEqual({ 'fill-opacity': 0.12 });
    expect(repaint(wetland, 'light')).toEqual({ 'fill-opacity': 0.2 });
    expect(repaint(pattern, 'light')).toEqual({ 'fill-opacity': 0.2 });
  });

  it('agrees with themeStyle on every layer of the real style', () => {
    for (const ground of GROUNDS) {
      const themed = painted(ground);
      for (const layer of layers) {
        for (const [name, value] of Object.entries(repaint(layer, ground))) {
          expect(themed.get(layer.id)![name], `${layer.id} ${name}`).toEqual(value);
        }
      }
    }
  });
});

describe('the road hierarchy', () => {
  it('reads a rank off a layer name', () => {
    expect(roadRank('road_motorway')).toBe('motorway');
    expect(roadRank('bridge_motorway_link_casing')).toBe('motorway');
    expect(roadRank('road_trunk_primary')).toBe('main');
    expect(roadRank('tunnel_secondary_tertiary')).toBe('main');
    expect(roadRank('road_link')).toBe('main');
    expect(roadRank('road_minor')).toBe('street');
    expect(roadRank('bridge_street')).toBe('street');
    expect(roadRank('road_service_track')).toBe('street');
    expect(roadRank('road_path_pedestrian')).toBe('path');
  });

  it.each(GROUNDS)('keeps motorway, main road, street and path apart on the %s map', (ground) => {
    const land = tonesFor(ground).land;
    const fills = ['road_motorway', 'road_trunk_primary', 'road_minor'].map((id) => colour(ground, id, 'line-color'));
    // each rank stands further from the land than the one below it, by a step the eye can see
    const [motorway, main, street] = fills.map((fill) => contrast(fill, land)) as [number, number, number];
    expect(motorway / main).toBeGreaterThan(1.2);
    expect(main / street).toBeGreaterThan(1.2);
    expect(street).toBeGreaterThan(1.15);
    // a motorway is also edged, in a tone no other road's edge has
    const casings = ['road_motorway_casing', 'road_trunk_primary_casing', 'road_minor_casing'].map((id) => colour(ground, id, 'line-color'));
    expect(new Set(casings).size).toBeGreaterThanOrEqual(2);
    expect(contrast(casings[0]!, fills[0]!)).toBeGreaterThan(1.8);
    // a path keeps its dashes, and is no road's colour
    expect(painted(ground).get('road_path_pedestrian')!['line-dasharray']).toEqual(layers.find((layer) => layer.id === 'road_path_pedestrian')!.paint!['line-dasharray']);
    expect(fills).not.toContain(colour(ground, 'road_path_pedestrian', 'line-color'));
  });
});

describe('labels', () => {
  /** what a label can lie on, beyond its own halo */
  const groundsUnder = (ground: Ground, id: string): string[] => {
    const tones = tonesFor(ground);
    if (id.startsWith('water')) {
      return [tones.water];
    }
    if (id.startsWith('highway-name')) {
      return [tones.land, tones.street, tones.main, tones.motorway];
    }
    return id.startsWith('poi') || id === 'airport' ? [tones.land, tones.building, tones.landuse, tones.green] : [tones.land, tones.residential, tones.green];
  };

  it.each(GROUNDS)('place and street names stand at 4.5:1 or better on the %s map', (ground) => {
    const report: string[] = [];
    for (const layer of layers.filter((each) => each.type === 'symbol' && each.paint && 'text-color' in each.paint)) {
      const paint = themedPaint(layer, ground);
      const text = paint['text-color'] as string;
      const halo = paint['text-halo-color'] as string;
      const lowest = Math.min(contrast(text, halo), ...groundsUnder(ground, layer.id).map((under) => contrast(text, under)));
      report.push(`${layer.id} ${text} ${lowest.toFixed(2)}`);
      // every label has a halo of the ground's own colour; a street's name also clears the road it runs along
      expect(contrast(text, halo), `${layer.id} on its halo`).toBeGreaterThanOrEqual(AA);
      if (!layer.id.startsWith('highway-name')) {
        expect(lowest, `${layer.id} on its ground`).toBeGreaterThanOrEqual(AA);
      } else if (layer.id !== 'highway-name-path') {
        // off its halo too, a street's name clears the street and the main road; on a motorway it has the halo
        const { street, main } = tonesFor(ground);
        expect(Math.min(contrast(text, street), contrast(text, main)), `${layer.id} on a road`).toBeGreaterThanOrEqual(AA);
      }
    }
    // every layer of the style that writes a name
    expect(report.length).toBe(20);
  });

  it.each(GROUNDS)('a street name is given a halo to stand on, which the style left clear (%s)', (ground) => {
    for (const id of ['highway-name-minor', 'highway-name-major']) {
      expect(layers.find((layer) => layer.id === id)!.paint).not.toHaveProperty('text-halo-color');
      expect(colour(ground, id, 'text-halo-color')).toBe(tonesFor(ground).land);
      expect(painted(ground).get(id)!['text-halo-width']).toBe(1);
    }
  });
});

describe('overPictures', () => {
  const names = layers.filter((layer) => layer.type === 'symbol' && layer.paint && 'text-color' in layer.paint);
  const borders = layers.filter((layer) => layer.id.startsWith('boundary'));

  it('draws every name pale with a dark halo, whatever scheme the page is in', () => {
    expect(names.length).toBeGreaterThan(15);
    for (const layer of names) {
      const paint = overPictures(layer) as Record<string, string>;
      expect(paint['text-halo-color']).toBe(GROUND_TOKENS.dark.bg);
      expect(contrast(paint['text-color']!, paint['text-halo-color']!)).toBeGreaterThan(AA);
    }
  });

  it('draws borders pale, so they show on the pictures', () => {
    expect(borders.length).toBeGreaterThan(0);
    for (const layer of borders) {
      expect(contrast((overPictures(layer) as Record<string, string>)['line-color']!, GROUND_TOKENS.dark.bg)).toBeGreaterThan(3);
    }
  });

  it('has no say over what the pictures cover: land, water, roads, buildings', () => {
    for (const layer of layers.filter((each) => !names.includes(each) && !borders.includes(each))) {
      expect(overPictures(layer)).toEqual({});
    }
  });

  it('changes only what the page’s own theme changes, so going back to the street map puts every colour back', () => {
    for (const layer of [...names, ...borders]) {
      const back = Object.keys(repaint(layer, 'light'));
      expect(back).toEqual(expect.arrayContaining(Object.keys(overPictures(layer))));
    }
  });
});

describe('withoutRelief', () => {
  const style = {
    version: 8,
    sources: { ne2_shaded: { type: 'raster' }, openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'natural_earth', type: 'raster', source: 'ne2_shaded' },
      { id: 'water', type: 'fill', source: 'openmaptiles' },
    ],
  };

  it('takes out the relief picture and the source only it drew from, and keeps the rest in order', () => {
    const lighter = withoutRelief(style);
    expect(lighter.layers.map((layer) => layer.id)).toEqual(['background', 'water']);
    expect(Object.keys(lighter.sources)).toEqual(['openmaptiles']);
    expect(lighter.version).toBe(8);
  });

  it('leaves the style it was given as it was', () => {
    withoutRelief(style);
    expect(style.layers).toHaveLength(3);
    expect(Object.keys(style.sources)).toEqual(['ne2_shaded', 'openmaptiles']);
  });

  it('takes the one picture layer out of the real style and nothing else', () => {
    const lighter = withoutRelief({ layers }).layers;
    expect(lighter).toHaveLength(layers.length - 1);
    expect(lighter.some((layer) => layer.type === 'raster')).toBe(false);
  });

  it('leaves an empty style empty, as the browser tests serve it', () => {
    expect(withoutRelief({ version: 8, sources: {}, layers: [] })).toEqual({ version: 8, sources: {}, layers: [] });
  });
});
