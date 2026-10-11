import { REFUSALS, saveGame, type Result, type SavedGame, type SavedGameReply } from '../account/client.ts';
import type { Clock } from '../account/runs.ts';

/**
 * Saving an account's finished daily. The server takes it only when the account sent `start` today
 * and at least six seconds have passed since: three rounds cannot be played sooner.
 */

/** The server refuses a daily saved sooner than this after its start (`REFUSALS.dailyTooSoon`). */
export const DAILY_MIN_MS = 6000;
/** What is added to the wait before a refused daily is sent again, so the second is not a hair early too. */
const RETRY_MARGIN_MS = 500;

const REAL_CLOCK: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

type Save = (game: SavedGame) => Promise<Result<SavedGameReply>>;

/**
 * Sends the daily. A player quicker than six seconds is refused as "sooner than it could have been
 * played": that result is sent once more when the time has passed, so a quick player waits a few
 * seconds and is not turned away. `begunAt` is when this browser had the server's answer to the
 * start, which is no earlier than the server's own note of it. Any other refusal is given back as it is.
 */
export async function finishDaily(game: SavedGame, begunAt: number, clock: Clock = REAL_CLOCK, save: Save = saveGame): Promise<Result<SavedGameReply>> {
  const first = await save(game);
  if (first.ok || first.error !== REFUSALS.dailyTooSoon) {
    return first;
  }
  await clock.sleep(Math.max(0, begunAt + DAILY_MIN_MS - clock.now()) + RETRY_MARGIN_MS);
  return save(game);
}
