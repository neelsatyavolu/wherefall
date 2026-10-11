/**
 * A daily whose result the server could not take because the site was updated while it was being
 * played (the day's places changed under the game). The attempt is used all the same, and the page
 * is reloaded for the new version: this is how the daily pane still knows, after that reload, to
 * say what happened instead of that the player left.
 */

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const KEY = 'plonk.daily.lost';

/** Storage can be missing or blocked: then nothing is kept, and the pane says what it says of any attempt that was begun. */
export function createLostStore(storage: () => Storage) {
  return {
    /** Notes the UTC day (YYYY-MM-DD) whose result was lost. Only the last one is kept: a day is played once. */
    mark(date: string): void {
      try {
        storage().setItem(KEY, date);
      } catch {
        // nowhere to keep it
      }
    },
    /** True when the result of this day was the one lost. */
    is(date: string): boolean {
      try {
        return storage().getItem(KEY) === date;
      } catch {
        return false;
      }
    },
  };
}

export const lostDailies = createLostStore(() => window.localStorage);
