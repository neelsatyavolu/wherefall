import { MAX_ROUND_SCORE, type SavedGame } from '../account/input.js';

const DAY_MS = 86_400_000;

/** Every daily challenge is played the same way, so every score on a day's leaderboard is comparable. */
export const DAILY_SETTINGS = { map: 'world', mode: 'move', timeLimit: 60, rounds: 3 } as const;

/** The most a daily challenge can score. */
export const DAILY_MAX_SCORE = DAILY_SETTINGS.rounds * MAX_ROUND_SCORE;

/** A daily finished sooner than this after it was begun cannot have been played. */
export const DAILY_MIN_MS = 6_000;

/** The UTC day of a moment, as YYYY-MM-DD. The daily challenge changes at midnight UTC for everyone. */
export const dailyDate = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** The seed every player's places are picked with on that day. */
export const dailySeed = (date: string): string => `daily${date.replaceAll('-', '')}`;

/** The moment the next daily challenge starts: the coming midnight UTC. */
export const nextDailyAt = (now: number): number => (Math.floor(now / DAY_MS) + 1) * DAY_MS;

/** The `count` days ending today, oldest first. */
export const lastDays = (now: number, count: number): string[] => Array.from({ length: count }, (_unused, index) => dailyDate(now - (count - 1 - index) * DAY_MS));

/** How many days before today a YYYY-MM-DD day was: 0 for today, negative for a day to come. Null when it is not a day at all. */
export function daysAgo(date: string, now: number): number | null {
  const start = Date.parse(`${date}T00:00:00Z`);
  // Date.parse rolls 30 February over into March; a real day reads back as itself.
  if (Number.isNaN(start) || dailyDate(start) !== date) {
    return null;
  }
  return Math.round((Date.parse(`${dailyDate(now)}T00:00:00Z`) - start) / DAY_MS);
}

/** True when the game is played the way every daily challenge is. */
const onDailySettings = (game: SavedGame): boolean =>
  game.map === DAILY_SETTINGS.map &&
  game.mode === DAILY_SETTINGS.mode &&
  game.timeLimit === DAILY_SETTINGS.timeLimit &&
  game.rounds.length === DAILY_SETTINGS.rounds;

/** True when a game claiming to be a daily challenge is today's, played on the daily's seed and settings. */
export function isTodaysDaily(game: SavedGame, now: number): boolean {
  const today = dailyDate(now);
  return game.daily === today && game.seed === dailySeed(today) && onDailySettings(game);
}
