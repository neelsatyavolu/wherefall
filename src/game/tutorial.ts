import type { Mode } from './settings.ts';

/**
 * The tutorial's places, in the order they are played: landmarks anyone would know. Each has a
 * line of fact in the catalog (`tutorial.fact.<landmark>`), shown with its round's result.
 */
export const LANDMARKS = ['eiffel', 'colosseum'] as const;
export type Landmark = (typeof LANDMARKS)[number];

/** The catalog key of the fact a round's result shows; null for a round the tutorial does not have. */
export function factKey(round: number): `tutorial.fact.${Landmark}` | null {
  const landmark = LANDMARKS[round];
  return landmark ? `tutorial.fact.${landmark}` : null;
}

/** Where the tutorial's last screen leads, each the id of a nav item: the account pane is where a visitor signs up. */
export type WayOn = 'singleplayer' | 'daily' | 'account';

/** The ways on, the first the one to take: a player who has an account is not offered another. */
export const waysOn = (signedIn: boolean): WayOn[] => (signedIn ? ['singleplayer', 'daily'] : ['singleplayer', 'daily', 'account']);

/** What the tutorial's coach points at, one step at a time: the first round guided, the second alone. */
export const COACH_STEPS = ['look', 'move', 'map', 'pin', 'guess', 'result', 'solo'] as const;
export type CoachStep = (typeof COACH_STEPS)[number];

/** What the player did. Each is what one step asks for. */
export type CoachEvent = 'looked' | 'moved' | 'mapOpened' | 'pinned' | 'guessed' | 'nextRound';

/** The step each event completes: doing something further along finishes everything before it too. */
const COMPLETES: Record<CoachEvent, CoachStep> = { looked: 'look', moved: 'move', mapOpened: 'map', pinned: 'pin', guessed: 'guess', nextRound: 'result' };

const stepsFor = (mode: Mode) => COACH_STEPS.filter((step) => step !== 'move' || mode === 'move');

export const firstStep = (mode: Mode): CoachStep => stepsFor(mode)[0]!;

/**
 * The step to show after an event. The coach moves on when the player does what the current step
 * asks, or something that comes later; anything earlier leaves it where it is. Null means the
 * coach has nothing left to say (or was dismissed).
 */
export function advance(step: CoachStep | null, event: CoachEvent, mode: Mode): CoachStep | null {
  if (step === null) {
    return null;
  }
  const steps = stepsFor(mode);
  const done = steps.indexOf(COMPLETES[event]);
  const at = steps.indexOf(step);
  if (step === 'solo') {
    return event === 'nextRound' ? null : step;
  }
  return done >= at ? (steps[done + 1] ?? null) : step;
}
