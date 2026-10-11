import type { MatchState } from '../multiplayer/client.ts';
import { runningForMs, type Stage } from '../multiplayer/state.ts';
import { joinPanel } from './match-standing.ts';
import type { RoundScreen } from './round-screen.ts';

/** A first round that has been running this long when a player arrives from the queue started without them. */
const LATE_ENTRY_MS = 5000;

/** How a player came into the match, as far as coming in late goes. */
export interface Entry {
  /** true when the match was entered straight from the public queue, which can drop a player into a game under way */
  fromQueue: boolean;
  /** for a player who joined a party under way by its code: the round they come in on. Null for everyone else */
  joinRound: number | null;
}

/**
 * The round a player the public queue has just handed this game comes in on, or null when they
 * were gathered for it: a game that has only just begun is one this player was gathered for, one
 * further along is one they were dropped into.
 */
function publicJoinRound(state: MatchState, stage: Stage, serverNowMs: number): number | null {
  if (state.kind !== 'unranked' || !('round' in stage)) {
    return null;
  }
  // how long the round has run comes from when the server started it: its end can have been moved earlier
  const runningFor = stage.kind === 'guessing' || stage.kind === 'waiting' ? runningForMs(state, serverNowMs) : 0;
  const underWay = stage.kind === 'reveal' || stage.kind === 'timeup' || runningFor > LATE_ENTRY_MS || stage.round > 0;
  return underWay ? stage.round + 1 : null;
}

/**
 * A player who comes into a game already under way plays from the next round: one the public
 * queue dropped in, or one who joined a party by its code. Until that round starts they see where
 * the game stands. Nobody else is ever a late joiner.
 */
export function lateJoin(screen: RoundScreen, entry: Entry, onLeave: () => void) {
  /** the round the player comes in on; null for everyone else, and once it has started */
  let joinRound: number | null = null;
  let entered = false;

  return {
    /** true while the standing is what is on screen */
    get waiting(): boolean {
      return joinRound !== null;
    },

    /**
     * Looks at the match as it stands and puts up, keeps or takes down the standing. True while it
     * is up. `onShown` is called when it goes up.
     */
    check(state: MatchState, stage: Stage, serverNowMs: number, onShown: () => void): boolean {
      if (!entered) {
        entered = true;
        joinRound = entry.joinRound ?? (entry.fromQueue ? publicJoinRound(state, stage, serverNowMs) : null);
        if (joinRound !== null) {
          onShown();
          screen.setPhase('loading');
          screen.showPanel(joinPanel(state, joinRound, onLeave));
        }
      }
      if (joinRound !== null && 'round' in stage) {
        if (stage.round >= joinRound) {
          joinRound = null;
          screen.clearPanel();
        } else {
          // the corner says which round the others are on
          screen.setCount(stage.round + 1);
        }
      }
      return joinRound !== null;
    },
  };
}
