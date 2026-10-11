import type { Result } from '../account/client.ts';
import { startDaily, type DailyStart } from './client.ts';
import { begun, visitorDailies, type VisitorStore } from './visitor-store.ts';

/**
 * Beginning the day's one attempt, for whoever is playing. The server is told first, always: an
 * account's attempt is marked there, and its result is refused without that; anyone else is
 * answered with a token, which is kept in this browser with the attempt so the result can be
 * claimed by an account made later.
 */

/** `play`: the attempt is begun, start the game. `done`: the account already has today's result. Otherwise the refusal to show. */
export type Begun = 'play' | 'done' | { error: string };

/** Begins the daily of `date`. Whether the player is an account or not is the server's to say, so a session that ended since the page was drawn plays as a visitor does. */
export async function beginDaily(date: string, store: VisitorStore = visitorDailies, start: () => Promise<Result<DailyStart>> = startDaily): Promise<Begun> {
  const started = await start();
  if (!started.ok) {
    return { error: started.error };
  }
  if (started.data.state === 'done') {
    return 'done';
  }
  const { token } = started.data;
  if (token !== null) {
    // not an account: the one attempt a day is counted here
    store.update((kept) => begun(kept, date, token));
  }
  return 'play';
}
