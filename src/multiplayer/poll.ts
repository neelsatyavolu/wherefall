import type { Result } from '../account/client.ts';
import { t } from '../i18n/index.ts';

/** How often a queue or a small match is asked for its state. Each request is also the player's heartbeat. */
export const POLL_MS = 1500;
/** A match with more players is asked less often, so a full party costs the server no more than a few small ones. */
const POLL_PACES: ReadonlyArray<readonly [upToPlayers: number, ms: number]> = [
  [10, POLL_MS],
  [20, 2500],
];
const POLL_MS_LARGEST = 4000;

/** How long to wait before asking a match again, from how many players its last state had. */
export function pollInterval(players: number): number {
  return POLL_PACES.find(([upTo]) => !(players > upTo))?.[1] ?? POLL_MS_LARGEST;
}
/** Failed polls in a row before the connection is called lost. */
export const MAX_FAILED_POLLS = 3;

/** One measurement of how far the server's clock is from this one. */
export interface ClockSample {
  /** add this to the local clock to get server time */
  offsetMs: number;
  /** how long the request took; the shorter it was, the better the measurement */
  roundTripMs: number;
}

/** Assumes the server stamped its reply half-way through the round trip. */
export function sampleClock(serverNow: string | null, sentAt: number, receivedAt: number): ClockSample | null {
  const server = serverNow === null ? Number.NaN : Date.parse(serverNow);
  if (Number.isNaN(server)) {
    return null;
  }
  return { offsetMs: server - (sentAt + receivedAt) / 2, roundTripMs: receivedAt - sentAt };
}

export function betterSample(current: ClockSample | null, next: ClockSample | null): ClockSample | null {
  if (!current || !next) {
    return next ?? current;
  }
  return next.roundTripMs < current.roundTripMs ? next : current;
}

export interface PollOptions<T> {
  /**
   * One request. Failures come back as a result; a thrown error counts as one too. The signal is
   * aborted when polling stops, so a request still in flight is cut off rather than left to land
   * after the player has moved on.
   */
  load: (signal: AbortSignal) => Promise<Result<T>>;
  onData: (data: T) => void;
  /** Called once per outage, after a few failed polls in a row. Polling goes on, so a later reply recovers. */
  onLost: (error: string) => void;
  /** Reads the server's time from a reply, to correct for a local clock that is off. */
  serverNow?: (data: T) => string | null;
  /** How long to wait after a reply before asking again. Left out, it is always `POLL_MS`. A failed poll keeps the last reply's pace. */
  interval?: (data: T) => number;
}

export interface Poller {
  stop(): void;
  /**
   * Wants one request that starts no sooner than `fromMs` from now and no later than `byMs` from
   * now. A request of the regular pace that starts inside that window is the one; otherwise one more
   * is made when the window closes, or as soon as a request still in flight then is back. The pace
   * goes on from its reply. A newer window takes the place of one not yet served.
   */
  askBetween(fromMs: number, byMs: number): void;
  /** The server's time now, in ms, as best measured so far. The local clock until a reply arrives. */
  serverNow(): number;
}

/** A `fetch` that gives up when the signal is aborted, for a poll's `load`. */
export const abortable =
  (signal: AbortSignal): typeof fetch =>
  (input, init) =>
    fetch(input, { ...init, signal });

const failed = (): Result<never> => ({ ok: false, error: t('error.unreachable') });

/**
 * Asks at once and then again 1.5 s after each reply (or as long after it as `interval` says), so
 * two requests are never in flight together. Stops for good when `stop` is called; a reply that
 * arrives after that is dropped.
 */
export function startPolling<T>(options: PollOptions<T>): Poller {
  let stopped = false;
  let waitMs = POLL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let clock: ClockSample | null = null;
  let inFlight: AbortController | null = null;
  /** when the pace asks next, on the local clock */
  let nextAt = 0;
  /** the window `askBetween` wants a request to start in, on the local clock; null once one has */
  let wanted: { from: number; by: number } | null = null;

  /** Sets the next request for when the pace has it, or for the close of a wanted window when that comes sooner. */
  const arm = (): void => {
    clearTimeout(timer);
    const due = wanted !== null && wanted.by < nextAt ? wanted.by : nextAt;
    timer = setTimeout(() => void run(), Math.max(0, due - Date.now()));
  };

  const run = async (): Promise<void> => {
    const sentAt = Date.now();
    if (wanted !== null && sentAt >= wanted.from) {
      wanted = null;
    }
    inFlight = new AbortController();
    const result = await options.load(inFlight.signal).catch((): Result<T> => failed());
    inFlight = null;
    if (stopped) {
      return;
    }
    if (result.ok) {
      waitMs = options.interval?.(result.data) ?? POLL_MS;
    }
    nextAt = Date.now() + waitMs;
    if (result.ok) {
      failures = 0;
      clock = betterSample(clock, options.serverNow ? sampleClock(options.serverNow(result.data), sentAt, Date.now()) : null);
      options.onData(result.data);
    } else {
      failures += 1;
      if (failures === MAX_FAILED_POLLS) {
        options.onLost(result.error);
      }
    }
    // the handlers above may have stopped the polling
    if (!stopped) {
      arm();
    }
  };

  void run();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
    },
    askBetween: (fromMs, byMs) => {
      if (stopped) {
        return;
      }
      const now = Date.now();
      wanted = { from: now + fromMs, by: now + Math.max(fromMs, byMs) };
      // with a request in flight the next one is set when it is back
      if (inFlight === null) {
        arm();
      }
    },
    serverNow: () => Date.now() + (clock?.offsetMs ?? 0),
  };
}
