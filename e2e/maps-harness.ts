// This file runs in the page, not in the test: the dev server serves it like any module of the
// app, and `e2e/wave5-maps.spec.ts` imports it there. It opens the map editor and a community
// map's page with stand-ins for Google, which the hermetic tests do not have: a lookup for the
// nearest Street View, and a Street View to preview places in.

import type { ImageryProvider, Place, StreetView } from '../src/imagery/provider.ts';
import { mapEditorPane } from '../src/ui/map-editor-pane.ts';
import { mapPage } from '../src/ui/map-page.ts';
import type { Snap } from '../src/ui/providers.ts';

/** What the stand-ins were asked for, for the test to read back. */
export interface HarnessRecord {
  /** how many Street View views were made: each is one panorama out of the day's allowance */
  views: number;
  /** the id of each place shown, in order */
  shown: string[];
  /** how many points were looked up */
  lookups: number;
  /** set to make the next view fail to open, as Google does when the allowance is spent */
  down: boolean;
}

declare global {
  interface Window {
    mapsHarness?: HarnessRecord;
  }
}

const record = (): HarnessRecord => (window.mapsHarness ??= { views: 0, shown: [], lookups: 0, down: false });

/** Goes to an address inside the app as the app's own links do. */
function navigate(href: string, state: unknown = null): void {
  history.pushState(state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Puts a pane where the app's own is. */
const mount = (node: HTMLElement) => document.querySelector('.pane-section')?.replaceWith(node);

const NO_COVERAGE_ABOVE = 80;
const rounded = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A lookup that finds a panorama exactly where it is asked (to three decimals, so the same spot
 * asked twice is the same panorama), and none north of 80 degrees.
 */
function standInSnap(delayMs: number): Snap {
  return async (point) => {
    record().lookups += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const [lat, lng] = [rounded(point.lat), rounded(point.lng)];
    return point.lat > NO_COVERAGE_ABOVE ? null : { id: `pano:${lat},${lng}`, lat, lng };
  };
}

export interface EditorOptions {
  /** how long each lookup takes, for a test that watches a long list go by */
  delayMs?: number;
}

/** Opens the editor on a new map (`null`) or one of the player's own, with the stand-in lookup. */
export function mountEditor(slug: string | null, options: EditorOptions = {}): void {
  record();
  const snap = standInSnap(options.delayMs ?? 0);
  mount(mapEditorPane(slug, { onNavigate: navigate, snapper: async () => snap }).node);
}

interface StandInPlace extends Place {
  id: string;
}

class Gone extends Error {}

export interface PageOptions {
  /** ids of places whose panorama is gone */
  gone?: string[];
}

/** A Street View that shows nothing but says which place it is on, in `data-place` on its box. */
function standInStreet(gone: readonly string[]): ImageryProvider<StandInPlace> {
  return {
    name: 'google',
    attribution: null,
    places: async () => ({ regions: {}, locations: [] }),
    resolve: async (location) => {
      if (gone.includes(location.id)) {
        throw new Gone(location.id);
      }
      return { id: location.id, lng: location.lng, lat: location.lat, credit: '' };
    },
    isGone: (error) => error instanceof Gone,
    createView: async (container) => {
      if (record().down) {
        throw new Error('no viewers left today');
      }
      record().views += 1;
      const view: StreetView<StandInPlace> = {
        show: async (place) => {
          container.dataset.place = place.id;
          record().shown.push(place.id);
        },
        returnToStart: async () => undefined,
        moveByKey: () => undefined,
        destroy: () => delete container.dataset.place,
      };
      return view;
    },
  };
}

/** Opens a community map's page as on a site with Google imagery, with the stand-in Street View for its preview. */
export function mountMapPage(slug: string, options: PageOptions = {}): void {
  record();
  const street = standInStreet(options.gone ?? []);
  mount(mapPage(slug, { onNavigate: navigate, googleReady: true, street: () => street }).node);
}
