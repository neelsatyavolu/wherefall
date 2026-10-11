import { describe, expect, it } from 'vitest';
import { PIN_INTERVAL_MS } from './client.ts';
import { throttleLatest, type ThrottleClock } from './pin-throttle.ts';

/** A clock the test moves by hand: timers run when their time has come, in order. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  let timers: Array<{ id: number; at: number; run: () => void }> = [];
  const clock: ThrottleClock = {
    now: () => now,
    set: (run, ms) => {
      const id = nextId++;
      timers = [...timers, { id, at: now + ms, run }];
      return id;
    },
    clear: (id) => {
      timers = timers.filter((timer) => timer.id !== id);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      timers = timers.filter((timer) => timer.id !== due.id);
      now = due.at;
      due.run();
    }
    now = until;
  };
  return { clock, advance, pending: () => timers.length };
}

function setUp() {
  const sent: Array<{ value: string; at: number }> = [];
  const time = fakeClock();
  const throttle = throttleLatest<string>((value) => sent.push({ value, at: time.clock.now() }), PIN_INTERVAL_MS, time.clock);
  return { sent, throttle, ...time };
}

describe('throttleLatest', () => {
  it('sends the first value at once', () => {
    const { sent, throttle } = setUp();
    throttle.push('a');
    expect(sent).toEqual([{ value: 'a', at: 0 }]);
  });

  it('holds what follows until a second has passed, then sends only the newest', () => {
    const { sent, throttle, advance } = setUp();
    throttle.push('a');
    advance(200);
    throttle.push('b');
    advance(300);
    throttle.push('c');
    expect(sent.map((entry) => entry.value)).toEqual(['a']);
    advance(499);
    expect(sent).toHaveLength(1);
    advance(1);
    expect(sent).toEqual([
      { value: 'a', at: 0 },
      { value: 'c', at: 1000 },
    ]);
  });

  it('never sends two within a second of each other, however fast values arrive', () => {
    const { sent, throttle, advance } = setUp();
    for (let step = 0; step < 50; step++) {
      throttle.push(`p${step}`);
      advance(90);
    }
    advance(2000);
    const gaps = sent.slice(1).map((entry, index) => entry.at - sent[index]!.at);
    expect(gaps.every((gap) => gap >= PIN_INTERVAL_MS)).toBe(true);
    // 4.4 seconds of moving: one at the start, one on each of the four seconds after, and the final position on the fifth
    expect(sent.map((entry) => entry.at)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(sent.at(-1)!.value).toBe('p49');
  });

  it('sends at once again after a quiet second', () => {
    const { sent, throttle, advance } = setUp();
    throttle.push('a');
    advance(1000);
    throttle.push('b');
    expect(sent).toEqual([
      { value: 'a', at: 0 },
      { value: 'b', at: 1000 },
    ]);
  });

  it('keeps the gap after a value that had to wait', () => {
    const { sent, throttle, advance } = setUp();
    throttle.push('a');
    advance(900);
    throttle.push('b');
    advance(100);
    // 'b' went at 1000: 'c' may not follow before 2000
    advance(500);
    throttle.push('c');
    expect(sent.map((entry) => entry.at)).toEqual([0, 1000]);
    advance(500);
    expect(sent.map((entry) => entry.at)).toEqual([0, 1000, 2000]);
  });

  it('forgets a waiting value when cancelled, and sends nothing more until asked', () => {
    const { sent, throttle, advance, pending } = setUp();
    throttle.push('a');
    throttle.push('b');
    throttle.cancel();
    expect(pending()).toBe(0);
    advance(5000);
    expect(sent.map((entry) => entry.value)).toEqual(['a']);
    throttle.push('c');
    expect(sent.map((entry) => entry.value)).toEqual(['a', 'c']);
  });
});
