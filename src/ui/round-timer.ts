/** How the round's clock reads and how pressing it looks, by the seconds left. */

/** calm: plenty of time. warn: under ten seconds, yellow. urgent: under five, red and pulsing. */
export type TimerState = 'calm' | 'warn' | 'urgent';

const WARN_UNDER_SECONDS = 10;
const URGENT_UNDER_SECONDS = 5;

/** The clock's state for the seconds left, or for no clock at all (null). The number is always shown with it. */
export function timerState(seconds: number | null): TimerState {
  if (seconds === null || seconds >= WARN_UNDER_SECONDS) {
    return 'calm';
  }
  return seconds < URGENT_UNDER_SECONDS ? 'urgent' : 'warn';
}

/** Seconds as minutes and seconds: 75 is 1:15. */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
