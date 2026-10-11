import { z } from 'zod';
import { remember } from '../game/seen-places.ts';

/** The places this browser has shown, kept in its storage: ids only, oldest first, the last 5,000. */

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const KEY = 'plonk.seen-places';
const stored = z.array(z.string());

/** Storage can be missing, blocked or full: then nothing is remembered, and games are drawn as if nothing had been seen. */
export function createSeenStore(storage: () => Storage) {
  const read = (): string[] => {
    try {
      const parsed = stored.safeParse(JSON.parse(storage().getItem(KEY) ?? '[]'));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };
  return {
    /** every place remembered */
    ids: (): ReadonlySet<string> => new Set(read()),
    /** notes places as shown, the newest last */
    add(ids: readonly string[]): void {
      if (ids.length === 0) {
        return;
      }
      try {
        storage().setItem(KEY, JSON.stringify(remember(read(), ids)));
      } catch {
        // nowhere to keep it: the places may come up again, which costs nothing but variety
      }
    },
  };
}

export const seenPlaces = createSeenStore(() => window.localStorage);
