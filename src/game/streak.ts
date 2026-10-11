/** The longest streak the server accepts. A run that reaches it ends there. */
export const MAX_STREAK = 500;

/** One run of the country streak: how many in a row, and how the last round went. */
export interface StreakRun {
  readonly streak: number;
  readonly over: boolean;
  /** the country the last place was in */
  readonly answer: string | null;
  /** the country the player picked for it; null for none (the sea, or the time ran out) */
  readonly guessed: string | null;
}

export const newRun = (): StreakRun => ({ streak: 0, over: false, answer: null, guessed: null });

/** Scores one round: the right country adds one, anything else ends the run. */
export function judge(run: StreakRun, answer: string, guessed: string | null): StreakRun {
  if (run.over) {
    return run;
  }
  if (guessed !== answer) {
    return { streak: run.streak, over: true, answer, guessed };
  }
  const streak = run.streak + 1;
  return { streak, over: streak >= MAX_STREAK, answer, guessed };
}
