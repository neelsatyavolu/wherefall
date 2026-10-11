import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../account/client.ts';
import { MAX_FAILED_POLLS, POLL_MS, betterSample, pollInterval, sampleClock, startPolling } from './poll.ts';

interface Reply {
  serverNow: string;
  n: number;
}

const ok = (n: number, serverNow = new Date().toISOString()): Result<Reply> => ({ ok: true, data: { serverNow, n } });
const fail = (error = 'Could not reach the server.'): Result<Reply> => ({ ok: false, error });

/** A loader that answers from a script, then keeps giving the last answer. */
function scripted(...answers: Array<() => Result<Reply>>) {
  let calls = 0;
  const load = vi.fn(async () => {
    const answer = answers[Math.min(calls, answers.length - 1)]!;
    calls += 1;
    return answer();
  });
  return load;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startPolling', () => {
  it('asks at once, then every 1.5 seconds', async () => {
    const load = scripted(() => ok(1));
    const onData = vi.fn();
    startPolling({ load, onData, onLost: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(5);
    expect(POLL_MS).toBe(1500);
  });

  it('hands over each reply', async () => {
    const onData = vi.fn();
    startPolling({ load: scripted(() => ok(1), () => ok(2)), onData, onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onData.mock.calls.map(([data]) => (data as Reply).n)).toEqual([1, 2]);
  });

  it('stops for good on teardown', async () => {
    const load = scripted(() => ok(1));
    const onData = vi.fn();
    const poller = startPolling({ load, onData, onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('drops a reply that arrives after teardown', async () => {
    let release: (value: Result<Reply>) => void = () => {};
    const load = vi.fn(() => new Promise<Result<Reply>>((resolve) => (release = resolve)));
    const onData = vi.fn();
    const poller = startPolling({ load, onData, onLost: vi.fn() });
    poller.stop();
    release(ok(1));
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(onData).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cuts off the request that is in flight when it is stopped', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<Result<Reply>>(() => {});
    });
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    poller.stop();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('gives each request its own signal, and leaves a finished one alone', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      return ok(1);
    });
    startPolling({ load, onData: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it('does not ask again when the reply handler stops it', async () => {
    const load = scripted(() => ok(1));
    const poller = startPolling({ load, onData: () => poller.stop(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never has two requests in flight', async () => {
    let inFlight = 0;
    let most = 0;
    const load = vi.fn(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS * 2));
      inFlight -= 1;
      return ok(1);
    });
    startPolling({ load, onData: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(most).toBe(1);
    expect(load.mock.calls.length).toBeGreaterThan(1);
  });

  it('tolerates a few failed polls before reporting the connection lost', async () => {
    const onLost = vi.fn();
    const onData = vi.fn();
    startPolling({ load: scripted(() => ok(1), () => fail('Down.')), onData, onLost });
    await vi.advanceTimersByTimeAsync(POLL_MS * (MAX_FAILED_POLLS - 1));
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith('Down.');
    expect(MAX_FAILED_POLLS).toBe(3);
  });

  it('reports a long outage once and keeps trying', async () => {
    const onLost = vi.fn();
    const load = scripted(() => fail());
    startPolling({ load, onData: vi.fn(), onLost });
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(load.mock.calls.length).toBeGreaterThan(MAX_FAILED_POLLS);
  });

  it('forgets earlier failures once a poll succeeds', async () => {
    const onLost = vi.fn();
    const onData = vi.fn();
    startPolling({ load: scripted(fail, fail, () => ok(1), fail, fail, () => ok(2)), onData, onLost });
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(onLost).not.toHaveBeenCalled();
    expect(onData).toHaveBeenCalledTimes(2);
  });

  it('counts a loader that throws as a failed poll', async () => {
    const onLost = vi.fn();
    const load = vi.fn(async (): Promise<Result<Reply>> => {
      throw new Error('boom');
    });
    startPolling({ load, onData: vi.fn(), onLost });
    await vi.advanceTimersByTimeAsync(POLL_MS * MAX_FAILED_POLLS);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe('pollInterval', () => {
  it('is 1.5 seconds with up to ten players, 2.5 with up to twenty and 4 above that', () => {
    expect([1, 2, 10].map(pollInterval)).toEqual([1500, 1500, 1500]);
    expect([11, 20].map(pollInterval)).toEqual([2500, 2500]);
    expect([21, 40].map(pollInterval)).toEqual([4000, 4000]);
  });

  it('is the quickest for a count that is no count', () => {
    expect([0, -1, Number.NaN].map(pollInterval)).toEqual([1500, 1500, 1500]);
  });
});

describe('a poll whose pace follows its replies', () => {
  /** each reply's `n` is how many players the match has */
  const paced = (load: ReturnType<typeof scripted>) => startPolling({ load, onData: vi.fn(), onLost: vi.fn(), interval: (reply) => pollInterval(reply.n) });

  it('waits 4 seconds after a reply with more than twenty players', async () => {
    const load = scripted(() => ok(40));
    paced(load);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('waits 2.5 seconds after a reply with eleven to twenty', async () => {
    const load = scripted(() => ok(11));
    paced(load);
    await vi.advanceTimersByTimeAsync(2499);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('follows the count as it changes: slower as a party fills, quicker again as it empties', async () => {
    const load = scripted(() => ok(10), () => ok(21), () => ok(2));
    paced(load);
    await vi.advanceTimersByTimeAsync(1500);
    expect(load).toHaveBeenCalledTimes(2);
    // the second reply had twenty-one players
    await vi.advanceTimersByTimeAsync(3999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    // the third had two
    await vi.advanceTimersByTimeAsync(1500);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('keeps the pace of the last reply through failed polls, and the quickest before any reply', async () => {
    const early = scripted(() => fail());
    paced(early);
    await vi.advanceTimersByTimeAsync(1500);
    expect(early).toHaveBeenCalledTimes(2);

    const load = scripted(() => ok(40), () => fail());
    paced(load);
    await vi.advanceTimersByTimeAsync(4000);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('one request more, asked for ahead of the pace', () => {
  /** a match of forty: asked for every 4 seconds */
  const slow = (load: ReturnType<typeof scripted>) => startPolling({ load, onData: vi.fn(), onLost: vi.fn(), interval: () => 4000 });
  /** the times, in ms from the start, at which the loader was called */
  function timed(takesMs = 0) {
    const started = Date.now();
    const at: number[] = [];
    let inFlight = 0;
    let most = 0;
    const load = vi.fn(async () => {
      at.push(Date.now() - started);
      inFlight += 1;
      most = Math.max(most, inFlight);
      if (takesMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, takesMs));
      }
      inFlight -= 1;
      return ok(40);
    });
    return { load, at, most: () => most };
  }

  it('asks at the end of the window when the pace would not have asked inside it, then keeps its pace', async () => {
    const { load, at } = timed();
    const poller = slow(load);
    await vi.advanceTimersByTimeAsync(0);
    poller.askBetween(2000, 2600);
    await vi.advanceTimersByTimeAsync(2599);
    expect(at).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(at).toEqual([0, 2600]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(at).toEqual([0, 2600, 6600]);
  });

  it('asks nothing more when a request of the pace starts inside the window anyway', async () => {
    const { load, at } = timed();
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    poller.askBetween(1000, 2000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(at).toEqual([0, 1500, 3000]);
  });

  it('is not served by a request that started before the window', async () => {
    const { load, at } = timed();
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    poller.askBetween(2000, 2200);
    await vi.advanceTimersByTimeAsync(3700);
    expect(at).toEqual([0, 1500, 2200, 3700]);
  });

  it('waits for a request still in flight, asks as soon as it is back, and never has two under way', async () => {
    const { load, at, most } = timed(1000);
    const poller = slow(load);
    await vi.advanceTimersByTimeAsync(1000);
    // the second request leaves at 5000 and is back at 6000: the window closes while it is away
    await vi.advanceTimersByTimeAsync(4100);
    poller.askBetween(200, 400);
    await vi.advanceTimersByTimeAsync(899);
    expect(at).toEqual([0, 5000]);
    // (a timer set for "now" inside a tick of the fake clock runs a millisecond later)
    await vi.advanceTimersByTimeAsync(2);
    expect(at).toEqual([0, 5000, 6001]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(at).toEqual([0, 5000, 6001]);
    await vi.advanceTimersByTimeAsync(1);
    expect(at).toEqual([0, 5000, 6001, 11_001]);
    expect(most()).toBe(1);
  });

  it('asks once for a window, and a newer window takes the place of the one before', async () => {
    const { load, at } = timed();
    const poller = slow(load);
    await vi.advanceTimersByTimeAsync(0);
    poller.askBetween(500, 1000);
    poller.askBetween(1500, 2000);
    await vi.advanceTimersByTimeAsync(3999);
    expect(at).toEqual([0, 2000]);
    // asked for again with the same window, as every reply during a reveal does: nothing changes
    poller.askBetween(100, 200);
    poller.askBetween(100, 200);
    await vi.advanceTimersByTimeAsync(200);
    expect(at).toEqual([0, 2000, 4199]);
  });

  it('asks nothing once the polling has stopped', async () => {
    const { load, at } = timed();
    const poller = slow(load);
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    poller.askBetween(100, 200);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(at).toEqual([0]);
  });

  it('keeps counting failed polls through it', async () => {
    const onLost = vi.fn();
    const poller = startPolling({ load: scripted(() => fail()), onData: vi.fn(), onLost });
    await vi.advanceTimersByTimeAsync(0);
    poller.askBetween(100, 200);
    await vi.advanceTimersByTimeAsync(200 + POLL_MS);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe('server time', () => {
  it('is the local clock until a reply says otherwise', () => {
    const poller = startPolling({ load: scripted(() => fail()), onData: vi.fn(), onLost: vi.fn() });
    expect(poller.serverNow()).toBe(Date.now());
    poller.stop();
  });

  it('follows a server whose clock is ahead', async () => {
    const ahead = 90_000;
    const load = scripted(() => ok(1, new Date(Date.now() + ahead).toISOString()));
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn(), serverNow: (data) => data.serverNow });
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.serverNow()).toBe(Date.now() + ahead);
    await vi.advanceTimersByTimeAsync(700);
    expect(poller.serverNow()).toBe(Date.now() + ahead);
  });

  it('follows a server whose clock is behind', async () => {
    const load = scripted(() => ok(1, new Date(Date.now() - 4000).toISOString()));
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn(), serverNow: (data) => data.serverNow });
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.serverNow()).toBe(Date.now() - 4000);
  });

  it('allows for the time the reply spent on the wire', async () => {
    // the server stamps the reply half-way through a 400 ms round trip, on a clock 10 s ahead
    const load = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const stamped = new Date(Date.now() + 10_000).toISOString();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return ok(1, stamped);
    });
    const poller = startPolling({ load, onData: vi.fn(), onLost: vi.fn(), serverNow: (data) => data.serverNow });
    await vi.advanceTimersByTimeAsync(400);
    expect(poller.serverNow()).toBe(Date.now() + 10_000);
  });

  it('has the corrected time ready when the reply is handed over', async () => {
    const seen: number[] = [];
    const poller = startPolling({
      load: scripted(() => ok(1, new Date(Date.now() + 5000).toISOString())),
      onData: () => seen.push(poller.serverNow() - Date.now()),
      onLost: vi.fn(),
      serverNow: (data) => data.serverNow,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([5000]);
  });
});

describe('sampleClock', () => {
  it('measures the offset from the middle of the round trip', () => {
    expect(sampleClock('2026-10-11T12:00:10.000Z', Date.parse('2026-10-11T12:00:00.000Z'), Date.parse('2026-10-11T12:00:00.300Z'))).toEqual({
      offsetMs: 9850,
      roundTripMs: 300,
    });
  });

  it('gives nothing for a time it cannot read, or was not given', () => {
    expect(sampleClock('soon', 0, 10)).toBeNull();
    expect(sampleClock(null, 0, 10)).toBeNull();
  });
});

describe('betterSample', () => {
  const fast = { offsetMs: 100, roundTripMs: 40 };
  const slow = { offsetMs: 300, roundTripMs: 900 };

  it('keeps the measurement taken over the quicker round trip', () => {
    expect(betterSample(fast, slow)).toBe(fast);
    expect(betterSample(slow, fast)).toBe(fast);
  });

  it('takes whichever one exists', () => {
    expect(betterSample(null, slow)).toBe(slow);
    expect(betterSample(fast, null)).toBe(fast);
    expect(betterSample(null, null)).toBeNull();
  });
});
