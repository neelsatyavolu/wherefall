const DAY_MS = 86_400_000;
/** One missed day is forgiven in the seven days that end at the next played day. */
const GRACE_WINDOW_DAYS = 7;

export interface DailyStreak {
  /** Days with a result, counted back from today, or from yesterday while today is still to play. */
  current: number;
  /** The longest the streak has ever been. */
  best: number;
  /** True when there is a streak and it ends unless today is played. */
  atRisk: boolean;
}

/** A YYYY-MM-DD day as a count of days, so that the day before is one less. */
const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * True when the day before `next` may be missed without ending the streak:
 * it is then the only day without a result in the seven days ending at
 * `next`, the next played day. So the five days before the missed one must
 * all have been played.
 */
function bridges(played: ReadonlySet<number>, next: number): boolean {
  for (let day = next - (GRACE_WINDOW_DAYS - 1); day < next - 1; day += 1) {
    if (!played.has(day)) {
      return false;
    }
  }
  return true;
}

/** How long the streak was on each played day, that day included. `days` is in order, earliest first. */
function lengths(days: readonly number[], played: ReadonlySet<number>): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const day of days) {
    const before = byDay.get(day - 1) ?? (bridges(played, day) ? byDay.get(day - 2) : undefined) ?? 0;
    byDay.set(day, before + 1);
  }
  return byDay;
}

/**
 * The daily streak of a player from the days (YYYY-MM-DD, UTC) they have a
 * result on. A streak is days in a row, and survives one missed day as long
 * as that is the only missed day in the seven days ending at the next played
 * day. While today is still to play, the streak is the one playing today
 * would carry on: it counts back from yesterday, or across a missed yesterday
 * that today would bridge.
 */
export function dailyStreak(playedDays: readonly string[], today: string): DailyStreak {
  const now = dayNumber(today);
  const days = [...new Set(playedDays.map(dayNumber))].filter((day) => day <= now).sort((a, b) => a - b);
  const played = new Set(days);
  const byDay = lengths(days, played);
  const best = Math.max(0, ...byDay.values());
  if (played.has(now)) {
    return { current: byDay.get(now) ?? 0, best, atRisk: false };
  }
  const current = byDay.get(now - 1) ?? (bridges(played, now) ? byDay.get(now - 2) : undefined) ?? 0;
  return { current, best, atRisk: current > 0 };
}
