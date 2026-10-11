import type { Page } from '@playwright/test';
import type { SavedRound } from '../src/account/client.ts';
import { drawDaily } from '../src/daily/draw.ts';
import type { Location } from '../src/game/locations.ts';
import { dailySeed, listsFor } from './place-rules.ts';

/**
 * What the specs that drive the stand-in servers through the real clients share: every reply a
 * stand-in gives is read by the same zod schema the game reads the real server with, so a stand-in
 * that drifts from the contract fails there. Each request is made from the page, where the routes are.
 */

/** A `fetch` for the clients that sends each request from inside the page and brings the reply back. */
export function through(page: Page): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const reply = await page.evaluate(
      async ([path, method, body]) => {
        const response = await fetch(path!, method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: body ?? undefined } : undefined);
        return { status: response.status, text: await response.text() };
      },
      [url, init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : null] as const,
    );
    return new Response(reply.text, { status: reply.status });
  }) as typeof fetch;
}

/** Any page of the site will do to ask from: this one loads nothing of the game. */
export async function open(page: Page): Promise<typeof fetch> {
  await page.goto('/manifest.webmanifest');
  return through(page);
}

export const refused = (error: string) => ({ ok: false, error });

export const data = <T>(result: { ok: true; data: T } | { ok: false; error: string }): T => {
  if (!result.ok) {
    throw new Error(`Refused: ${result.error}`);
  }
  return result.data;
};

export const GUESTS = 'Guests cannot do that. Make an account first.';
export const SIGN_IN = 'Sign in first.';

const asLocations = (list: number): Location[] => listsFor(null)[list]!.locations.map(([id, lng, lat, country]) => ({ id, lng, lat, country }));

/** The real open list of places, which a page plays from unless a test serves it another. */
export const openPlaces = (): Location[] => asLocations(1);
/** The real Google list. */
export const googlePlaces = (): Location[] => asLocations(0);

/** The three places of a UTC day's daily on the open list, as the game draws them. */
export const dailyPlaces = (day: string): Location[] => drawDaily(openPlaces(), dailySeed(day));

/** A round on a place, as a game saves it: on the coordinates its list has, guessed where it is. */
export const roundOn = (place: Location, score = 0): SavedRound => ({
  id: place.id,
  lng: place.lng,
  lat: place.lat,
  guessLng: place.lng,
  guessLat: place.lat,
  hinted: false,
  country: place.country,
  distanceKm: 0,
  score,
});
