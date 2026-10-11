import { z } from 'zod';
import { SIGN_IN_FIRST } from '../account/identity.js';
import { roundSchema } from '../account/input.js';
import type { Db } from '../db/client.js';
import { dailiesPlayed, lockAccount } from '../db/daily.js';
import { insertGame, type StoredGame } from '../db/games.js';
import { checkedGame } from '../games/check.js';
import { accept, refuse, type Reply } from '../match/types.js';
import { isDailyDraw } from '../places/daily.js';
import { DAILY_SETTINGS, dailySeed, daysAgo } from './daily.js';
import { visitorStartDay } from './token.js';

/** How long after it is made an account may take over what its player did as a visitor. */
export const CLAIM_WINDOW_MS = 24 * 60 * 60_000;
/** A visitor's result older than this many days is not taken. */
export const CLAIM_DAYS = 14;

export const TOO_LATE_TO_CLAIM = 'Results can only be claimed on the day an account is made.';

type DailyGame = StoredGame & { daily: string };

const MAX_TOKEN_LENGTH = 200;

const resultSchema = z.object({
  daily: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** What the visitor's start of that day's daily was answered with. */
  token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  rounds: z.array(roundSchema).length(DAILY_SETTINGS.rounds),
});

/**
 * A stored result as the daily game it was, scored by the server. Null when
 * it is not one that can be taken: not a day, a day to come or one too long
 * ago, not begun on that day with a start this server answered, or not that
 * day's three places.
 */
function claimedGame(result: unknown, now: number, secret: Buffer): DailyGame | null {
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) {
    return null;
  }
  const { daily, token, rounds } = parsed.data;
  const age = daysAgo(daily, now);
  if (age === null || age < 0 || age > CLAIM_DAYS || visitorStartDay(token, secret) !== daily) {
    return null;
  }
  const { map, mode, timeLimit } = DAILY_SETTINGS;
  const seed = dailySeed(daily);
  const checked = checkedGame({ map, mode, timeLimit, seed, rounds, daily });
  const drawn = checked !== null && checked.list !== null && isDailyDraw(checked.places, checked.list, seed);
  return drawn ? { ...checked.game, daily } : null;
}

/** The results that can be taken, as games. Of two for one day, the first. */
export function claimable(results: readonly unknown[], now: number, secret: Buffer): DailyGame[] {
  const games = results.map((result) => claimedGame(result, now, secret)).filter((game) => game !== null);
  return games.filter((game, index) => games.findIndex((other) => other.daily === game.daily) === index);
}

/**
 * Saves the daily results a player made as a visitor, kept until now in
 * their browser, to the account they have just made. A day the account has
 * already played is left as it is. Answers with the days taken.
 */
export async function claimDailies(db: Db, userId: string, results: readonly unknown[], now: number, secret: Buffer): Promise<Reply<{ claimed: string[] }>> {
  const games = claimable(results, now, secret);
  return db.transaction(async (tx) => {
    // Holding the account makes two claims take turns, so the second finds the first one's days played.
    const madeAt = await lockAccount(tx, userId);
    if (madeAt === null) {
      return refuse(401, SIGN_IN_FIRST);
    }
    if (now - madeAt > CLAIM_WINDOW_MS) {
      return refuse(403, TOO_LATE_TO_CLAIM);
    }
    const played = await dailiesPlayed(
      tx,
      userId,
      games.map((game) => game.daily),
    );
    const fresh = games.filter((game) => !played.has(game.daily));
    for (const game of fresh) {
      await insertGame(tx, userId, game, now);
    }
    return accept({ claimed: fresh.map((game) => game.daily) });
  });
}
