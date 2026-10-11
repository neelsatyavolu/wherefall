import type { Page } from '@playwright/test';
import { servePlaces } from './place-rules.ts';

/** Smallest valid JPEG (one grey pixel): stands in for every panorama image and tile. */
const PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

const IMAGE_HOST = 'https://img.plonk.test';

function picture(id: string) {
  return {
    id,
    collection: `seq-of-${id.split('~')[0]}`,
    geometry: { type: 'Point', coordinates: [2.345, 48.86] },
    properties: {
      license: 'CC-BY-SA-4.0',
      'view:azimuth': 0,
      'geovisio:producer': 'e2e fixture',
      'pers:interior_orientation': { field_of_view: 360 },
      'tiles:tile_matrix_sets': { geovisio: { tileMatrix: [{ tileWidth: 512, tileHeight: 512, matrixWidth: 4, matrixHeight: 2 }] } },
    },
    assets: { hd: { href: `${IMAGE_HOST}/${id}/hd.jpg` }, sd: { href: `${IMAGE_HOST}/${id}/sd.jpg` } },
    asset_templates: { tiles: { href: `${IMAGE_HOST}/${id}/tiled/{TileCol}_{TileRow}.jpg` } },
    links: [
      { rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      { rel: 'next', id: `${id}~n`, geometry: { type: 'Point', coordinates: [2.345, 48.8601] } },
      { rel: 'prev', id: `${id}~p`, geometry: { type: 'Point', coordinates: [2.345, 48.8599] } },
    ],
  };
}

export interface MockOptions {
  /**
   * `km` (the default) stores kilometres as the player's units before the page loads, when nothing
   * is stored yet, so a test reads the same distances whatever the browser's locale would start
   * with. `browser` stores nothing: the page starts as a new browser does, which is in miles for
   * US and UK English.
   */
  units?: 'km' | 'browser';
  /**
   * `seen` (the default) marks the welcome a new visitor gets as answered before the page loads, so
   * a test starts on the home screen. `show` stores nothing: the plain home page then opens on the
   * welcome, as it does in a browser that has never been here.
   */
  welcome?: 'seen' | 'show';
}

/**
 * Replaces every outside service with local stand-ins, so the flow is tested without depending
 * on Panoramax, the map tile host or the font host being up. Returns the ids of panoramas shown.
 */
export async function mockServices(page: Page, options: MockOptions = {}): Promise<string[]> {
  const shown: string[] = [];
  // the dev server tells its pages to reload whenever any file in the project is saved, which fails
  // a test for no fault of its own while others are editing: a page under test does not listen
  await page.routeWebSocket(/.*/, () => undefined);
  if (options.units !== 'browser') {
    // only when nothing is stored: a choice made in the test survives a reload
    await page.addInitScript(() => {
      if (localStorage.getItem('plonk.units') === null) {
        localStorage.setItem('plonk.units', 'km');
      }
    });
  }
  if (options.welcome !== 'show') {
    await page.addInitScript(() => localStorage.setItem('plonk.welcome-seen', '1'));
  }

  await page.route('https://api.panoramax.xyz/api/search**', async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('ids');
    await route.fulfill({ json: { features: ids ? [picture(ids)] : [] } });
  });

  await page.route(`${IMAGE_HOST}/**`, async (route) => {
    const [, id, file] = new URL(route.request().url()).pathname.split('/');
    if (file === 'sd.jpg' && id) {
      shown.push(decodeURIComponent(id));
    }
    await route.fulfill({ body: PIXEL_JPEG, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' } });
  });

  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  return shown;
}

type Row = [id: string, lng: number, lat: number, country: string];

const rows = (country: string, count: number, lng: number, lat: number): Row[] =>
  Array.from({ length: count }, (_, i) => [`${country.toLowerCase()}-${String(i).padStart(2, '0')}`, lng + (i % 9) * 0.5, lat + Math.floor(i / 9) * 0.5, country]);

/** A small list of places: Russia and Kenya are large enough to be maps of their own, Japan is not. */
export const PLACES_FIXTURE = {
  version: 1,
  regions: { RU: 'europe', KE: 'africa', JP: 'asia-oceania' },
  locations: [...rows('RU', 45, 60, 55), ...rows('KE', 40, 35, -2), ...rows('JP', 12, 136, 35)],
};

/** Only Russian places, so every round of a country streak has the same right answer. */
export const RUSSIA_ONLY = { version: 1, regions: { RU: 'europe' }, locations: rows('RU', 60, 60, 55) };

/**
 * Serves a stand-in list of places instead of the real one. The stand-in servers of the page are
 * told too, since the server takes a saved game, a run or a daily only on places it has in its lists.
 */
export async function mockPlaces(page: Page, places: unknown = PLACES_FIXTURE): Promise<void> {
  servePlaces(page, places);
  await page.route('**/locations.json', (route) => route.fulfill({ json: places }));
}

/**
 * The account's session has ended from somewhere else (its password was changed, a recovery code
 * was used, it was deleted or banned, or it signed out everywhere): from now on every stand-in
 * given answers this browser as it answers a visitor, 401 "Sign in first." wherever a session is
 * needed. For `AccountServer` use its own `endedElsewhere()`.
 */
export function endSession(...servers: Array<{ session: 'account' | 'guest' | 'none' }>): void {
  for (const server of servers) {
    server.session = 'none';
  }
}
