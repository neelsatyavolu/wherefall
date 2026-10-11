/// <reference types="google.maps" />
import type { LngLat } from '../game/geo.ts';
import type { Location } from '../game/locations.ts';
import { t } from '../i18n/index.ts';

const SCRIPT = 'https://maps.googleapis.com/maps/api/js';
/** A key of this value loads Google's watermarked, keyless development mode. Local testing only. */
const DEV_KEY = 'dev';
/** How far from a dataset coordinate an official panorama may be and still count as that place. */
const SNAP_RADIUS_M = 150;
/** How far from a click in the map editor a panorama may be and still be the place that was meant. */
const EDITOR_RADIUS_M = 500;
/** A key press follows the link closest to the wanted direction, within this angle. */
const LINK_TOLERANCE_DEG = 75;
const LOAD_TIMEOUT_MS = 15000;

export interface GooglePlace extends LngLat {
  panoId: string;
  /** direction the capturing car was travelling */
  heading: number;
  credit: string;
}

/** Google cannot be used right now (script blocked, key rejected, quota spent): fall back. */
export class GoogleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleUnavailableError';
  }
}

class NoCoverageError extends Error {}

/** True when Google simply has no official imagery at a place, so another place should be tried. */
export function isNoCoverage(error: unknown): boolean {
  return error instanceof NoCoverageError;
}

/** Google's own panorama ids: what the rows of the Google place list carry. Panoramax ids are UUIDs and never match. */
const GOOGLE_PANO_ID = /^[\w-]{22}$/;

type PanoramaRequest<Source, Preference> =
  | { pano: string }
  | { location: { lat: number; lng: number }; radius: number; sources: Source[]; preference: Preference };

/** The one call needed from Google's StreetViewService, typed loosely enough to fake in tests. */
interface PanoramaService<Source, Preference> {
  getPanorama(request: PanoramaRequest<Source, Preference>): Promise<unknown>;
}

interface PanoramaData {
  data: {
    location?: { pano?: string; latLng?: { lat(): number; lng(): number } };
    tiles?: { centerHeading?: number };
    copyright?: string;
  };
}

/**
 * Builds the function that turns a place into a Google panorama. Takes the pieces of
 * the Maps library it needs, so it can be tested without loading Google.
 */
export function googleResolver<Source, Preference>(
  service: PanoramaService<Source, Preference>,
  sources: { GOOGLE: Source },
  preference: { NEAREST: Preference },
  keyRejected: () => boolean,
): (location: Location) => Promise<GooglePlace> {
  /** One lookup. A place Google has nothing for is "no coverage"; any other failure is Google being unavailable. */
  const find = async (request: PanoramaRequest<Source, Preference>, what: string): Promise<PanoramaData> => {
    try {
      return (await service.getPanorama(request)) as PanoramaData;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ZERO_RESULTS') {
        throw new NoCoverageError(`No Google imagery ${what}`);
      }
      throw new GoogleUnavailableError(`Google Street View lookup failed: ${String(code ?? error)}`);
    }
  };

  const nearest = (location: Location) =>
    find(
      {
        location: { lat: location.lat, lng: location.lng },
        radius: SNAP_RADIUS_M,
        // official Google captures only: user-uploaded photo spheres are often indoors
        sources: [sources.GOOGLE],
        preference: preference.NEAREST,
      },
      `near ${location.lat},${location.lng}`,
    );

  return async (location) => {
    if (keyRejected()) {
      throw new GoogleUnavailableError('Google rejected the Maps key');
    }
    // a place from the Google list is opened by its id; if that panorama has been retired, the nearest one stands in
    const result = GOOGLE_PANO_ID.test(location.id)
      ? await find({ pano: location.id }, `with id ${location.id}`).catch((error: unknown) => {
          if (isNoCoverage(error)) {
            return nearest(location);
          }
          throw error;
        })
      : await nearest(location);
    const { location: found, tiles, copyright } = result.data;
    if (!found?.pano || !found.latLng) {
      throw new NoCoverageError('Google returned a panorama without a position');
    }
    return {
      panoId: found.pano,
      lat: found.latLng.lat(),
      lng: found.latLng.lng(),
      heading: tiles?.centerHeading ?? 0,
      credit: t('credit.google', { copyright: copyright ?? '© Google' }),
    };
  };
}

/**
 * Builds the map editor's lookup: the nearest official panorama to a click, or null where there is
 * none within 500 m. It is the game's own lookup with a wider reach, so a place that can be added
 * is a place that can be played.
 */
export function googleSnap<Source, Preference>(
  service: PanoramaService<Source, Preference>,
  sources: { GOOGLE: Source },
  preference: { NEAREST: Preference },
  keyRejected: () => boolean,
): (point: LngLat) => Promise<{ id: string; lng: number; lat: number } | null> {
  return async (point) => {
    if (keyRejected()) {
      throw new GoogleUnavailableError('Google rejected the Maps key');
    }
    let result: PanoramaData;
    try {
      result = (await service.getPanorama({
        location: { lat: point.lat, lng: point.lng },
        radius: EDITOR_RADIUS_M,
        sources: [sources.GOOGLE],
        preference: preference.NEAREST,
      })) as PanoramaData;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'ZERO_RESULTS') {
        return null;
      }
      throw new GoogleUnavailableError(`Google Street View lookup failed: ${String(code ?? error)}`);
    }
    const found = result.data.location;
    return found?.pano && found.latLng ? { id: found.pano, lng: found.latLng.lng(), lat: found.latLng.lat() } : null;
  };
}

/** The address of a place's Street View on google.com/maps, for looking around it after a round. */
export function streetViewUrl(place: LngLat): string {
  const params = new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: `${place.lat},${place.lng}` });
  return `https://www.google.com/maps/@?${params}`;
}

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** The neighbouring panorama that lies closest to a compass direction, if any is close enough. */
export function bestLink(links: ReadonlyArray<{ pano?: string | null; heading?: number | null } | null>, wanted: number): string | null {
  let best: { pano: string; off: number } | null = null;
  for (const link of links) {
    if (!link?.pano || typeof link.heading !== 'number') {
      continue;
    }
    const off = angleBetween(link.heading, wanted);
    if (off <= LINK_TOLERANCE_DEG && (!best || off < best.off)) {
      best = { pano: link.pano, off };
    }
  }
  return best?.pano ?? null;
}

export function scriptUrl(key: string, callback: string): string {
  const params = new URLSearchParams({ v: 'weekly', loading: 'async', callback });
  if (key !== DEV_KEY) {
    params.set('key', key);
  }
  return `${SCRIPT}?${params}`;
}

declare global {
  interface Window {
    /** called by the Maps script when the key, its referrer or its billing is rejected */
    gm_authFailure?: () => void;
    __plonkMapsReady?: () => void;
  }
}

let library: Promise<google.maps.StreetViewLibrary> | null = null;
let keyRejected = false;

export const googleKeyRejected = () => keyRejected;

/** Loads the Street View part of the Maps JavaScript API once per page. */
export function loadStreetView(key: string): Promise<google.maps.StreetViewLibrary> {
  library ??= new Promise<google.maps.StreetViewLibrary>((resolve, reject) => {
    const fail = (reason: string) => {
      library = null;
      reject(new GoogleUnavailableError(reason));
    };
    const timeout = window.setTimeout(() => fail('Google Maps took too long to load'), LOAD_TIMEOUT_MS);
    window.gm_authFailure = () => {
      keyRejected = true;
    };
    window.__plonkMapsReady = () => {
      window.clearTimeout(timeout);
      google.maps.importLibrary('streetView').then(
        (loaded) => resolve(loaded as google.maps.StreetViewLibrary),
        () => fail('Google Street View failed to initialise'),
      );
    };
    const script = document.createElement('script');
    script.src = scriptUrl(key, '__plonkMapsReady');
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      fail('Google Maps could not be loaded');
    };
    document.head.append(script);
  });
  return library;
}
