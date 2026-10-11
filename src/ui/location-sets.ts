import { parseLocationSet, type LocationSet } from '../game/locations.ts';

/**
 * The lists of places, as the server has them now. The server takes a game only on places it holds
 * itself, so a list is never read from a copy that could be older than the server's: every fetch
 * asks the server whether the browser's copy is still good (`no-cache` revalidates, and costs a
 * 304 when nothing changed), and a list is kept in memory for this page only. Nothing is stored
 * across page loads, here or in the service worker.
 */
const loaded = new Map<string, Promise<LocationSet>>();

/** Fetches and checks a list of places once per page. A failed load is forgotten, so it can be tried again. */
export function loadLocationSet(url: string): Promise<LocationSet> {
  const cached = loaded.get(url);
  if (cached) {
    return cached;
  }
  const loading = fetch(url, { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Places request failed with HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(parseLocationSet);
  loaded.set(url, loading);
  loading.catch(() => {
    // only its own entry: the lists may have been forgotten and read again while this one was on its way
    if (loaded.get(url) === loading) {
      loaded.delete(url);
    }
  });
  return loading;
}

/**
 * Drops the lists this page has read, so the next game reads them again. For the daily, which is
 * played once: its three places are drawn from the list as the server has it when the attempt
 * begins, not as it was when a page left open for hours was loaded.
 */
export function forgetLocationSets(): void {
  loaded.clear();
}
