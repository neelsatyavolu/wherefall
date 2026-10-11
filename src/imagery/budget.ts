import type { ImageryProvider, Place } from './provider.ts';

/** Google is not to be used for this game: the day's free allowance is spent, or the server could not be asked. */
export class ViewerBudgetError extends Error {
  constructor() {
    super("Google's daily allowance is not available for this game");
    this.name = 'ViewerBudgetError';
  }
}

/**
 * Puts a source behind the server's daily allowance. `ask` is put to the server once, the first
 * time a place is opened on the source, and its answer stands for the whole game or match: one viewer serves
 * all of it. On a no, or when the question fails, everything rejects, and the caller falls back to
 * the next source without a word to the player.
 */
export function withinBudget<P extends Place>(provider: ImageryProvider<P>, ask: () => Promise<boolean>): ImageryProvider<P> {
  let answer: Promise<boolean> | null = null;
  const allowed = async (): Promise<void> => {
    answer ??= ask().catch(() => false);
    if (!(await answer)) {
      throw new ViewerBudgetError();
    }
  };
  return {
    name: provider.name,
    attribution: provider.attribution,
    isGone: (error) => !(error instanceof ViewerBudgetError) && provider.isGone(error),
    // the list of places is only a file: the home screen reads it to offer maps, and that must not spend the allowance
    places: () => provider.places(),
    resolve: async (location) => {
      await allowed();
      return provider.resolve(location);
    },
    createView: async (container, mode, handlers) => {
      await allowed();
      return provider.createView(container, mode, handlers);
    },
  };
}
