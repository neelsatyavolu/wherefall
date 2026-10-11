import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../account/client.ts';
import { startPresence, type PresenceEnv } from './presence.ts';

const MINUTE = 60_000;

/** A page whose visibility the test sets, on the test's clock. */
function fakePage(visible = true) {
  const listeners = new Set<() => void>();
  const state = { visible };
  const env: PresenceEnv = {
    visible: () => state.visible,
    onVisibility: (run) => {
      listeners.add(run);
      return () => listeners.delete(run);
    },
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
  };
  return {
    env,
    show(shown: boolean) {
      state.visible = shown;
      listeners.forEach((run) => run());
    },
    listening: () => listeners.size,
  };
}

/** A server that says how many are online, or fails, and counts how often it was asked. */
function fakeServer(online = 37) {
  const server = {
    online,
    down: false,
    asked: 0,
    ask: async (): Promise<Result<{ online: number }>> => {
      server.asked += 1;
      return server.down ? { ok: false, error: 'Could not reach the server.' } : { ok: true, data: { online: server.online } };
    },
  };
  return server;
}

describe('startPresence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks at once, then once a minute while the page is visible', async () => {
    const [page, server] = [fakePage(), fakeServer()];
    const seen: Array<number | null> = [];
    const presence = startPresence(server.ask, page.env);
    presence.subscribe((count) => seen.push(count));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.asked).toBe(1);
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(server.asked).toBe(1);
    server.online = 40;
    await vi.advanceTimersByTimeAsync(1);
    expect(server.asked).toBe(2);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(server.asked).toBe(5);
    // nothing is known when the listener arrives; then each answer as it comes
    expect(seen).toEqual([null, 37, 40, 40, 40, 40]);
    presence.stop();
  });

  it('never asks while the page is hidden, and asks at once when it is seen again', async () => {
    const [page, server] = [fakePage(), fakeServer()];
    const presence = startPresence(server.ask, page.env);
    await vi.advanceTimersByTimeAsync(0);
    page.show(false);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(server.asked).toBe(1);

    page.show(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.asked).toBe(2);
    // the minute is counted again from the moment the page came back
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(server.asked).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.asked).toBe(3);
    presence.stop();
  });

  it('waits for a page that opens hidden to be seen', async () => {
    const [page, server] = [fakePage(false), fakeServer()];
    const presence = startPresence(server.ask, page.env);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(server.asked).toBe(0);
    page.show(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.asked).toBe(1);
    presence.stop();
  });

  it('shows nothing after a failed call, and tries again at the next minute', async () => {
    const [page, server] = [fakePage(), fakeServer()];
    const seen: Array<number | null> = [];
    const presence = startPresence(server.ask, page.env);
    presence.subscribe((count) => seen.push(count));
    await vi.advanceTimersByTimeAsync(0);
    server.down = true;
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(seen.at(-1)).toBeNull();
    // no hurried second try
    await vi.advanceTimersByTimeAsync(MINUTE - 1);
    expect(server.asked).toBe(2);
    server.down = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([null, 37, null, 37]);
    presence.stop();
  });

  it('tells a listener that arrives later what is already known, and stops telling one that left', async () => {
    const [page, server] = [fakePage(), fakeServer()];
    const presence = startPresence(server.ask, page.env);
    await vi.advanceTimersByTimeAsync(0);
    const seen: Array<number | null> = [];
    const leave = presence.subscribe((count) => seen.push(count));
    expect(seen).toEqual([37]);
    leave();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(seen).toEqual([37]);
    presence.stop();
  });

  it('asks no more once stopped, hidden or shown', async () => {
    const [page, server] = [fakePage(), fakeServer()];
    const presence = startPresence(server.ask, page.env);
    await vi.advanceTimersByTimeAsync(0);
    presence.stop();
    expect(page.listening()).toBe(0);
    page.show(true);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(server.asked).toBe(1);
  });

  it('keeps the newer answer when an older one comes back late', async () => {
    const page = fakePage();
    const replies: Array<(result: Result<{ online: number }>) => void> = [];
    const presence = startPresence(() => new Promise((resolve) => replies.push(resolve)), page.env);
    const seen: Array<number | null> = [];
    presence.subscribe((count) => seen.push(count));
    page.show(true);
    replies[1]!({ ok: true, data: { online: 9 } });
    await vi.advanceTimersByTimeAsync(0);
    replies[0]!({ ok: true, data: { online: 4 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([null, 9]);
    presence.stop();
  });
});
