import type { LngLat } from '../game/geo.ts';
import { GoogleUnavailableError, googleKeyRejected, googleResolver, googleSnap, isNoCoverage, loadStreetView, type GooglePlace } from '../imagery/google.ts';
import { fetchPano, isPanoGone, type Pano } from '../imagery/panoramax.ts';
import { askViewer } from '../daily/client.ts';
import { t } from '../i18n/index.ts';
import { withinBudget } from '../imagery/budget.ts';
import type { ImageryProvider } from '../imagery/provider.ts';
import { loadLocationSet } from './location-sets.ts';

const panoramax: ImageryProvider<Pano> = {
  name: 'panoramax',
  // read when a game starts, so it is in the language in use
  get attribution() {
    return t('provider.panoramaxCredit');
  },
  places: () => loadLocationSet('/locations.json'),
  resolve: (location) => fetchPano(location.id),
  isGone: isPanoGone,
  // the panorama engine is large, so it loads only when this source is actually used
  createView: async (container, mode, handlers) => new (await import('./panoramax-view.ts')).PanoramaxView(container, mode, handlers),
};

function google(key: string): ImageryProvider<GooglePlace> {
  return {
    name: 'google',
    attribution: null,
    places: () => loadLocationSet('/locations.google.json'),
    resolve: async (location) => {
      const library = await loadStreetView(key);
      const resolve = googleResolver(new library.StreetViewService(), library.StreetViewSource, library.StreetViewPreference, googleKeyRejected);
      return resolve(location);
    },
    isGone: isNoCoverage,
    createView: async (container, mode, handlers) => {
      const [library, { GoogleView }] = await Promise.all([loadStreetView(key), import('./google-view.ts')]);
      if (googleKeyRejected()) {
        throw new GoogleUnavailableError('Google rejected the Maps key');
      }
      return new GoogleView(container, library, mode, handlers);
    },
  };
}

/**
 * Imagery sources in order of preference. Google Street View is used when a Maps key is
 * configured; Panoramax needs no key and is the fallback when Google is missing, over quota or
 * unreachable. Each plays from its own list of places, so a link leads to the same places only for
 * players on the same source.
 */
export function imageryProviders(): ImageryProvider[] {
  const key = googleKey();
  // each call is one game or match: Google is asked for once, and the answer stands for all of it
  return key ? [withinBudget(google(key), allowedToday), panoramax] : [panoramax];
}

/** Whether the server's count of today's Google viewers leaves room for one more. A failed question is a no. */
async function allowedToday(): Promise<boolean> {
  const answer = await askViewer();
  return answer.ok && answer.data.google;
}

function googleKey(): string | null {
  const key: unknown = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  return typeof key === 'string' && key ? key : null;
}

export type Snap = (point: LngLat) => Promise<{ id: string; lng: number; lat: number } | null>;

/**
 * The map editor's lookup: the nearest official Google panorama within 500 m of a click. Null when
 * no Maps key is configured, which is when community maps can be neither made nor played.
 */
export function googleSnapper(): (() => Promise<Snap>) | null {
  const key = googleKey();
  if (!key) {
    return null;
  }
  return async () => {
    const library = await loadStreetView(key);
    return googleSnap(new library.StreetViewService(), library.StreetViewSource, library.StreetViewPreference, googleKeyRejected);
  };
}
