/**
 * Lets a value that changes often (a pin being moved) out at most once every `intervalMs`: the
 * first at once, then the newest one waiting each time the interval is up. What came between is
 * dropped: only where the pin is now matters.
 */

export interface Throttle<T> {
  /** The value as it is now. Sent at once when the interval allows, otherwise when it next does. */
  push: (value: T) => void;
  /** Forgets a value that is still waiting, and sends nothing more until the next `push`. */
  cancel: () => void;
}

export interface ThrottleClock {
  now: () => number;
  set: (run: () => void, ms: number) => number;
  clear: (timer: number) => void;
}

const BROWSER_CLOCK: ThrottleClock = {
  now: () => Date.now(),
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (timer) => window.clearTimeout(timer),
};

export function throttleLatest<T>(send: (value: T) => void, intervalMs: number, clock: ThrottleClock = BROWSER_CLOCK): Throttle<T> {
  let lastSentAt: number | null = null;
  let waiting: { value: T } | null = null;
  let timer: number | null = null;

  const sendNow = (value: T) => {
    lastSentAt = clock.now();
    send(value);
  };

  const flush = () => {
    timer = null;
    const next = waiting;
    waiting = null;
    if (next !== null) {
      sendNow(next.value);
    }
  };

  return {
    push(value) {
      const sinceLast = lastSentAt === null ? intervalMs : clock.now() - lastSentAt;
      if (sinceLast >= intervalMs && timer === null) {
        sendNow(value);
        return;
      }
      waiting = { value };
      timer ??= clock.set(flush, Math.max(0, intervalMs - sinceLast));
    },
    cancel() {
      waiting = null;
      if (timer !== null) {
        clock.clear(timer);
        timer = null;
      }
    },
  };
}
