import { describe, expect, it } from 'vitest';
import { PanoRequestError, fetchCrossings, fetchPano, isPanoGone, parsePano, pickCrossings, yawTowards } from './panoramax.ts';

const feature = (overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
  id: 'pic-1',
  collection: 'seq-1',
  geometry: { type: 'Point', coordinates: [2.345, 48.86] },
  properties: {
    license: 'etalab-2.0',
    'view:azimuth': 28,
    'geovisio:producer': 'immergis',
    'pers:interior_orientation': { field_of_view: 360 },
    'tiles:tile_matrix_sets': {
      geovisio: { tileMatrix: [{ tileWidth: 768, tileHeight: 768, matrixWidth: 16, matrixHeight: 8 }] },
    },
    ...props,
  },
  assets: {
    hd: { href: 'https://img.example/pic-1/hd.jpg' },
    sd: { href: 'https://img.example/pic-1/sd.jpg' },
  },
  asset_templates: { tiles: { href: 'https://img.example/pic-1/tiled/{TileCol}_{TileRow}.jpg' } },
  links: [
    { rel: 'license', href: 'https://licence.example' },
    { rel: 'prev', id: 'pic-0', geometry: { type: 'Point', coordinates: [2.3449, 48.8599] } },
    { rel: 'next', id: 'pic-2', geometry: { type: 'Point', coordinates: [2.3451, 48.8601] } },
  ],
  ...overrides,
});

const jsonFetch = (body: unknown, status = 200) => {
  const calls: string[] = [];
  const fetchFn = async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
};

describe('parsePano', () => {
  it('reads position, heading, image sources, neighbours and credit', () => {
    const pano = parsePano(feature());
    expect(pano).toMatchObject({
      id: 'pic-1',
      sequence: 'seq-1',
      lng: 2.345,
      lat: 48.86,
      heading: 28,
      baseUrl: 'https://img.example/pic-1/sd.jpg',
      tiles: { width: 12288, cols: 16, rows: 8 },
      next: { id: 'pic-2', lng: 2.3451, lat: 48.8601 },
      prev: { id: 'pic-0' },
      credit: 'Photo by immergis, etalab-2.0, via Panoramax',
    });
    expect(pano.tiles?.url(3, 5)).toBe('https://img.example/pic-1/tiled/3_5.jpg');
  });

  it('falls back to the single HD image when there is no usable tile grid', () => {
    const pano = parsePano(feature({ asset_templates: undefined }, { 'tiles:tile_matrix_sets': undefined }));
    expect(pano.tiles).toBeNull();
    expect(pano.baseUrl).toBe('https://img.example/pic-1/hd.jpg');
  });

  it('ignores a tile grid the viewer cannot draw', () => {
    const props = {
      'tiles:tile_matrix_sets': {
        geovisio: { tileMatrix: [{ tileWidth: 700, tileHeight: 700, matrixWidth: 12, matrixHeight: 6 }] },
      },
    };
    expect(parsePano(feature({}, props)).tiles).toBeNull();
  });

  it('treats a missing heading as north and missing neighbours as dead ends', () => {
    const pano = parsePano(feature({ links: [] }, { 'view:azimuth': undefined }));
    expect(pano.heading).toBe(0);
    expect(pano.next).toBeNull();
    expect(pano.prev).toBeNull();
  });

  it.each([
    ['too many rows', { tileWidth: 768, tileHeight: 768, matrixWidth: 64, matrixHeight: 64 }],
    ['zero-width tiles', { tileWidth: 0, tileHeight: 0, matrixWidth: 16, matrixHeight: 8 }],
  ])('ignores a tile grid with %s', (_name, matrix) => {
    const props = { 'tiles:tile_matrix_sets': { geovisio: { tileMatrix: [matrix] } } };
    expect(parsePano(feature({}, props)).tiles).toBeNull();
  });

  it('refuses image addresses that are not https', () => {
    const assets = { hd: { href: 'javascript:alert(1)' }, sd: { href: 'http://img.example/sd.jpg' } };
    expect(() => parsePano(feature({ assets }))).toThrow();
  });

  it('ignores a tile address that is not https', () => {
    const pano = parsePano(feature({ asset_templates: { tiles: { href: 'http://img.example/{TileCol}_{TileRow}.jpg' } } }));
    expect(pano.tiles).toBeNull();
  });

  it('rejects a flat photo', () => {
    const props = { 'pers:interior_orientation': { field_of_view: 97 } };
    expect(() => parsePano(feature({}, props))).toThrow(/360/);
  });

  it('rejects something that is not a picture', () => {
    expect(() => parsePano({ id: 'x' })).toThrow();
  });
});

describe('fetchPano', () => {
  it('looks the picture up by id', async () => {
    const { fetchFn, calls } = jsonFetch({ features: [feature()] });
    const pano = await fetchPano('pic-1', fetchFn);
    expect(pano.id).toBe('pic-1');
    expect(calls[0]).toBe('https://api.panoramax.xyz/api/search?ids=pic-1');
  });

  it('treats a picture that no longer exists as gone', async () => {
    const { fetchFn } = jsonFetch({ features: [] });
    const error = await fetchPano('gone', fetchFn).catch((e: unknown) => e);
    expect(isPanoGone(error)).toBe(true);
  });

  it('treats a picture that is no longer a usable panorama as gone', async () => {
    const { fetchFn } = jsonFetch({ features: [{ id: 'broken' }] });
    const error = await fetchPano('broken', fetchFn).catch((e: unknown) => e);
    expect(isPanoGone(error)).toBe(true);
  });

  it('reports a failed request as a request problem, not a missing picture', async () => {
    const { fetchFn } = jsonFetch({}, 503);
    const error = await fetchPano('pic-1', fetchFn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PanoRequestError);
    expect(String(error)).toMatch(/503/);
    expect(isPanoGone(error)).toBe(false);
  });

  it('reports an unreachable network as a request problem', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchPano('pic-1', offline)).rejects.toBeInstanceOf(PanoRequestError);
  });
});

describe('yawTowards', () => {
  const pano = parsePano(feature({}, { 'view:azimuth': 90 }));

  it('is zero when the target is dead ahead of the camera', () => {
    expect(yawTowards(pano, { lng: pano.lng + 0.001, lat: pano.lat })).toBeCloseTo(0, 2);
  });

  it('turns left for a target to the north of an east-facing camera', () => {
    expect(yawTowards(pano, { lng: pano.lng, lat: pano.lat + 0.001 })).toBeCloseTo(-Math.PI / 2, 2);
  });
});

describe('pickCrossings', () => {
  const pano = parsePano(feature());
  const near = (id: string, sequence: string, dLng: number, dLat: number) => ({
    id,
    sequence,
    lng: pano.lng + dLng,
    lat: pano.lat + dLat,
  });

  it('keeps the closest picture of each other sequence', () => {
    const picked = pickCrossings(pano, [
      near('same', 'seq-1', 0.00005, 0),
      near('far-b', 'seq-2', 0.00015, -0.0001),
      near('near-b', 'seq-2', 0.0001, -0.00005),
      near('c', 'seq-3', -0.0001, 0),
    ]);
    expect(picked.map((p) => p.id).sort()).toEqual(['c', 'near-b']);
  });

  it('drops pictures too far to be the same junction', () => {
    expect(pickCrossings(pano, [near('away', 'seq-2', 0.002, 0)])).toEqual([]);
  });

  it('drops a picture that points the same way as an existing arrow', () => {
    // pic-2 (next) is to the north-east; a crossing in the same direction adds nothing
    expect(pickCrossings(pano, [near('dup', 'seq-2', 0.00012, 0.00012)])).toEqual([]);
  });

  it('offers at most three', () => {
    const many = [
      near('n', 'seq-2', 0, 0.0001),
      near('s', 'seq-3', 0, -0.0001),
      near('e', 'seq-4', 0.00015, -0.00002),
      near('w', 'seq-5', -0.00015, 0.00002),
      near('se', 'seq-6', 0.0001, -0.0001),
    ];
    expect(pickCrossings(pano, many).length).toBeLessThanOrEqual(3);
  });
});

describe('fetchCrossings', () => {
  it('searches a small box around the picture for 360 photos', async () => {
    const other = feature({
      id: 'x-1',
      collection: 'seq-9',
      geometry: { type: 'Point', coordinates: [2.3452, 48.86] },
    });
    const { fetchFn, calls } = jsonFetch({ features: [feature(), other] });
    const crossings = await fetchCrossings(parsePano(feature()), fetchFn);

    expect(crossings.map((c) => c.id)).toEqual(['x-1']);
    expect(calls[0]).toContain('filter=field_of_view%3D360');
    expect(calls[0]).toContain('bbox=');
  });

  it('returns nothing when the lookup fails, so play carries on', async () => {
    const { fetchFn } = jsonFetch({}, 500);
    expect(await fetchCrossings(parsePano(feature()), fetchFn)).toEqual([]);
  });
});
