import { z } from 'zod';
import { bearingDeg, distanceKm, type LngLat } from '../game/geo.ts';
import { t } from '../i18n/index.ts';

/** Panoramax meta-catalog: one keyless API in front of every public instance. */
const API = 'https://api.panoramax.xyz/api';

const CROSSING_BOX_DEG = 0.0003;
const CROSSING_MAX_KM = 0.025;
const CROSSING_MIN_ANGLE_DEG = 35;
const MAX_CROSSINGS = 3;
/** Photo Sphere Viewer only draws tile grids whose sides are powers of two. */
const MAX_TILE_COLS = 64;

export interface PanoLink extends LngLat {
  id: string;
}

interface SequencePoint extends PanoLink {
  sequence: string;
}

export interface PanoTiles {
  width: number;
  cols: number;
  rows: number;
  url: (col: number, row: number) => string;
}

export interface Pano extends LngLat {
  id: string;
  sequence: string;
  /** compass bearing of the centre of the image */
  heading: number;
  /** image shown first: the low-resolution one when tiles exist, else the full picture */
  baseUrl: string;
  tiles: PanoTiles | null;
  next: PanoLink | null;
  prev: PanoLink | null;
  /** who took the picture and under which licence, ready to show */
  credit: string;
}

/** The request itself failed (network down, server error): worth retrying, the picture may be fine. */
export class PanoRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanoRequestError';
  }
}

/** True when the picture is the problem: removed, or no longer a usable 360 photo. */
export function isPanoGone(error: unknown): boolean {
  return !(error instanceof PanoRequestError);
}

const point = z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) });

/** images are fetched and drawn, so only plain https addresses are accepted */
const httpsUrl = z.url({ protocol: /^https$/ });

const featureSchema = z.object({
  id: z.string(),
  collection: z.string(),
  geometry: point,
  properties: z.object({
    license: z.string().nullish(),
    'view:azimuth': z.number().nullish(),
    'geovisio:producer': z.string().nullish(),
    'pers:interior_orientation': z.object({ field_of_view: z.number().nullish() }).nullish(),
    'tiles:tile_matrix_sets': z
      .object({
        geovisio: z.object({
          tileMatrix: z.array(z.object({ tileWidth: z.number(), matrixWidth: z.number(), matrixHeight: z.number() })),
        }),
      })
      .nullish(),
  }),
  assets: z.object({ hd: z.object({ href: httpsUrl }), sd: z.object({ href: httpsUrl }) }),
  asset_templates: z.object({ tiles: z.object({ href: z.string() }).nullish() }).nullish(),
  links: z.array(z.object({ rel: z.string(), id: z.string().nullish(), geometry: point.nullish() })),
});

type Feature = z.infer<typeof featureSchema>;

const searchSchema = z.object({ features: z.array(z.unknown()) });

const isPowerOfTwo = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

function readTiles(feature: Feature): PanoTiles | null {
  const template = feature.asset_templates?.tiles?.href;
  const matrix = feature.properties['tiles:tile_matrix_sets']?.geovisio.tileMatrix[0];
  if (!template?.startsWith('https://') || !matrix) {
    return null;
  }
  const { matrixWidth: cols, matrixHeight: rows, tileWidth } = matrix;
  const drawable = isPowerOfTwo(cols) && isPowerOfTwo(rows) && cols <= MAX_TILE_COLS && rows <= MAX_TILE_COLS / 2 && tileWidth > 0;
  if (!drawable) {
    return null;
  }
  return {
    width: cols * tileWidth,
    cols,
    rows,
    url: (col, row) => template.replace('{TileCol}', String(col)).replace('{TileRow}', String(row)),
  };
}

function readLink(feature: Feature, rel: 'next' | 'prev'): PanoLink | null {
  const link = feature.links.find((l) => l.rel === rel);
  if (!link?.id || !link.geometry) {
    return null;
  }
  const [lng, lat] = link.geometry.coordinates;
  return { id: link.id, lng, lat };
}

export function parsePano(raw: unknown): Pano {
  const feature = featureSchema.parse(raw);
  if (feature.properties['pers:interior_orientation']?.field_of_view !== 360) {
    throw new Error(`Picture ${feature.id} is not a 360 panorama`);
  }
  const [lng, lat] = feature.geometry.coordinates;
  const tiles = readTiles(feature);
  return {
    id: feature.id,
    sequence: feature.collection,
    lng,
    lat,
    heading: feature.properties['view:azimuth'] ?? 0,
    baseUrl: tiles ? feature.assets.sd.href : feature.assets.hd.href,
    tiles,
    next: readLink(feature, 'next'),
    prev: readLink(feature, 'prev'),
    credit: t('credit.panoramax', { name: feature.properties['geovisio:producer'] ?? t('credit.contributor'), licence: feature.properties.license ?? t('credit.openLicence') }),
  };
}

async function search(query: string, fetchFn: typeof fetch): Promise<unknown[]> {
  const response = await fetchFn(`${API}/search?${query}`).catch(() => {
    throw new PanoRequestError('Panoramax could not be reached');
  });
  if (!response.ok) {
    throw new PanoRequestError(`Panoramax search failed with HTTP ${response.status}`);
  }
  const body = searchSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) {
    throw new PanoRequestError('Panoramax sent a reply that could not be read');
  }
  return body.data.features;
}

export async function fetchPano(id: string, fetchFn: typeof fetch = fetch): Promise<Pano> {
  const [feature] = await search(`ids=${encodeURIComponent(id)}`, fetchFn);
  if (!feature) {
    throw new Error(`Picture ${id} is no longer available`);
  }
  return parsePano(feature);
}

/** Yaw, in radians from the centre of the image, at which a target appears. */
export function yawTowards(pano: Pano, target: LngLat): number {
  const relative = ((bearingDeg(pano, target) - pano.heading + 540) % 360) - 180;
  return (relative * Math.PI) / 180;
}

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Pictures from other sequences that sit at the same junction, so the player can turn off the
 * current street. One per sequence, nearest first, skipping directions that already have an arrow.
 */
export function pickCrossings(pano: Pano, nearby: readonly SequencePoint[]): PanoLink[] {
  const nearestPerSequence = new Map<string, { point: SequencePoint; km: number }>();
  for (const candidate of nearby) {
    const km = distanceKm(pano, candidate);
    if (candidate.sequence === pano.sequence || km > CROSSING_MAX_KM || km === 0) {
      continue;
    }
    const best = nearestPerSequence.get(candidate.sequence);
    if (!best || km < best.km) {
      nearestPerSequence.set(candidate.sequence, { point: candidate, km });
    }
  }

  const takenBearings = [pano.next, pano.prev].filter((l) => l !== null).map((l) => bearingDeg(pano, l));
  const picked: PanoLink[] = [];
  for (const { point: candidate } of [...nearestPerSequence.values()].sort((a, b) => a.km - b.km)) {
    const bearing = bearingDeg(pano, candidate);
    if (takenBearings.some((taken) => angleBetween(taken, bearing) < CROSSING_MIN_ANGLE_DEG)) {
      continue;
    }
    takenBearings.push(bearing);
    picked.push({ id: candidate.id, lng: candidate.lng, lat: candidate.lat });
    if (picked.length === MAX_CROSSINGS) {
      break;
    }
  }
  return picked;
}

const nearbySchema = z.object({ id: z.string(), collection: z.string(), geometry: point });

/** Crossing streets are a nicety: any failure here just means no extra arrows. */
export async function fetchCrossings(pano: Pano, fetchFn: typeof fetch = fetch): Promise<PanoLink[]> {
  const d = CROSSING_BOX_DEG;
  const bbox = [pano.lng - d, pano.lat - d, pano.lng + d, pano.lat + d].map((v) => v.toFixed(6)).join(',');
  try {
    const features = await search(`bbox=${bbox}&limit=60&filter=${encodeURIComponent('field_of_view=360')}`, fetchFn);
    const nearby = features.flatMap((raw) => {
      const parsed = nearbySchema.safeParse(raw);
      if (!parsed.success) {
        return [];
      }
      const [lng, lat] = parsed.data.geometry.coordinates;
      return [{ id: parsed.data.id, sequence: parsed.data.collection, lng, lat }];
    });
    return pickCrossings(pano, nearby);
  } catch {
    return [];
  }
}
