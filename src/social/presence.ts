import type { Result } from '../account/client.ts';
import { PRESENCE_MS } from './client.ts';

/** What the heartbeat needs of the page it runs in, so a test can stand in for the page and the clock. */
export interface PresenceEnv {
  /** whether the page can be seen right now */
  visible: () => boolean;
  /** calls `run` whenever the page is hidden or shown; returns how to stop */
  onVisibility: (run: () => void) => () => void;
  /** calls `run` every `ms`; returns how to stop */
  every: (ms: number, run: () => void) => () => void;
}

/** How many players are online, or null when that is not known: before the first answer, and after a failed one. */
type Listener = (online: number | null) => void;

export interface Presence {
  /** Tells `listener` what is known now and each time it changes. Returns how to stop being told. */
  subscribe: (listener: Listener) => () => void;
  stop: () => void;
}

/**
 * The presence heartbeat: asks how many players are online at once and then every minute, which is
 * also what marks this player as seen. Only while the page is visible: a hidden page asks nothing,
 * and asks at once when it is shown again. A failed call leaves nothing to show and is not hurried:
 * the next minute tries again.
 */
export function startPresence(ask: () => Promise<Result<{ online: number }>>, env: PresenceEnv, everyMs: number = PRESENCE_MS): Presence {
  const listeners = new Set<Listener>();
  let online: number | null = null;
  let stopTimer: (() => void) | null = null;
  /** goes up with each call, so an answer that comes back late does not replace a newer one */
  let asked = 0;
  let stopped = false;

  async function beat(): Promise<void> {
    const mine = ++asked;
    const result = await ask();
    if (stopped || mine !== asked) {
      return;
    }
    online = result.ok ? result.data.online : null;
    listeners.forEach((listener) => listener(online));
  }

  function follow(): void {
    stopTimer?.();
    stopTimer = null;
    if (env.visible()) {
      void beat();
      stopTimer = env.every(everyMs, () => void beat());
    }
  }

  const stopWatching = env.onVisibility(follow);
  follow();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      listener(online);
      return () => {
        listeners.delete(listener);
      };
    },
    stop: () => {
      stopped = true;
      stopTimer?.();
      stopWatching();
      listeners.clear();
    },
  };
}
