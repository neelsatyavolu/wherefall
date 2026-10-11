import { describe, expect, it, vi } from 'vitest';
import { MAX_GAIN, createSounds } from './sound.ts';

/** A stand-in for the Web Audio context that counts what was made and started. */
function fakeAudio() {
  const made = { contexts: 0, oscillators: 0, started: 0 };
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const create = () => {
    made.contexts += 1;
    return {
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: () => {
        made.oscillators += 1;
        return { type: 'sine', frequency: param(), connect: vi.fn(), start: () => (made.started += 1), stop: vi.fn() };
      },
      createGain: () => ({ gain: param(), connect: vi.fn() }),
    };
  };
  return { made, create };
}

describe('sounds', () => {
  it('makes nothing before the first user gesture', () => {
    const { made, create } = fakeAudio();
    const sounds = createSounds({ context: create, enabled: () => true });
    sounds.play('pin');
    sounds.play('result', 4200);
    expect(made).toEqual({ contexts: 0, oscillators: 0, started: 0 });
  });

  it('plays once a gesture has happened, on one shared context', () => {
    const { made, create } = fakeAudio();
    const sounds = createSounds({ context: create, enabled: () => true });
    sounds.unlock();
    expect(made.contexts).toBe(0);
    sounds.play('pin');
    sounds.play('guess');
    sounds.play('chat');
    expect(made.contexts).toBe(1);
    expect(made.started).toBe(made.oscillators);
    expect(made.started).toBeGreaterThanOrEqual(3);
  });

  it('plays nothing when switched off, and makes no context for it', () => {
    const { made, create } = fakeAudio();
    let on = false;
    const sounds = createSounds({ context: create, enabled: () => on });
    sounds.unlock();
    for (const name of ['pin', 'guess', 'result', 'tick', 'match', 'chat'] as const) {
      sounds.play(name, 2500);
    }
    expect(made).toEqual({ contexts: 0, oscillators: 0, started: 0 });
    on = true;
    sounds.play('tick');
    expect(made.started).toBeGreaterThan(0);
  });

  it('pitches the round result by the score', () => {
    expect(createSounds({ context: fakeAudio().create, enabled: () => true }).resultPitch(0)).toBeLessThan(
      createSounds({ context: fakeAudio().create, enabled: () => true }).resultPitch(5000),
    );
  });

  it('stays silent where there is no audio at all', () => {
    const sounds = createSounds({
      context: () => {
        throw new Error('no audio here');
      },
      enabled: () => true,
    });
    sounds.unlock();
    expect(() => sounds.play('pin')).not.toThrow();
  });
});

describe('the volume', () => {
  /** A stand-in that keeps the level each tone was started at. */
  function levels() {
    const heard: number[] = [];
    const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    const context = () => ({
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: () => ({ type: 'sine', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() }),
      createGain: () => ({ gain: { setValueAtTime: (value: number) => void heard.push(value), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
    });
    return { heard, context };
  }

  it('sets the level of every sound', () => {
    for (const name of ['pin', 'guess', 'result', 'tick', 'match', 'chat'] as const) {
      const { heard, context } = levels();
      let volume = 100;
      const sounds = createSounds({ context, enabled: () => true, volume: () => volume });
      sounds.unlock();
      sounds.play(name, 2500);
      const loud = heard[0]!;
      volume = 50;
      sounds.play(name, 2500);
      expect(loud).toBeCloseTo(MAX_GAIN);
      expect(heard.at(-1)).toBeCloseTo(MAX_GAIN / 2);
      expect(heard.every((level) => level === loud || level === heard.at(-1))).toBe(true);
    }
  });

  it('plays nothing at zero, and makes no context for it', () => {
    const { made, create } = fakeAudio();
    const sounds = createSounds({ context: create, enabled: () => true, volume: () => 0 });
    sounds.unlock();
    sounds.play('pin');
    sounds.play('result', 5000);
    expect(made).toEqual({ contexts: 0, oscillators: 0, started: 0 });
  });

  it('is never louder than the top of the slider', () => {
    const { heard, context } = levels();
    const sounds = createSounds({ context, enabled: () => true, volume: () => 900 });
    sounds.unlock();
    sounds.play('pin');
    expect(heard[0]).toBeCloseTo(MAX_GAIN);
  });
});

describe('the click of a button', () => {
  it('is softer than the other sounds, and follows the volume', () => {
    const heard: number[] = [];
    const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    const context = () => ({
      currentTime: 0,
      state: 'running',
      destination: {},
      resume: vi.fn(async () => {}),
      createOscillator: () => ({ type: 'sine', frequency: param(), connect: vi.fn(), start: vi.fn(), stop: vi.fn() }),
      createGain: () => ({ gain: { setValueAtTime: (value: number) => void heard.push(value), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
    });
    let volume = 100;
    const sounds = createSounds({ context, enabled: () => true, volume: () => volume });
    sounds.unlock();
    sounds.play('click');
    volume = 50;
    sounds.play('click');
    expect(heard[0]).toBeGreaterThan(0);
    expect(heard[0]).toBeLessThan(MAX_GAIN);
    expect(heard[1]).toBeCloseTo(heard[0]! / 2);
  });

  it('is not made before the first user gesture, with sound off, or at zero volume', () => {
    const { made, create } = fakeAudio();
    let enabled = true;
    let volume = 50;
    const sounds = createSounds({ context: create, enabled: () => enabled, volume: () => volume });
    sounds.play('click');
    sounds.unlock();
    enabled = false;
    sounds.play('click');
    enabled = true;
    volume = 0;
    sounds.play('click');
    expect(made).toEqual({ contexts: 0, oscillators: 0, started: 0 });
    volume = 50;
    sounds.play('click');
    expect(made).toEqual({ contexts: 1, oscillators: 1, started: 1 });
  });

  it('gives way to a sound the button made of its own at the same moment', () => {
    const { made, create } = fakeAudio();
    let now = 1000;
    const sounds = createSounds({ context: create, enabled: () => true, now: () => now });
    sounds.unlock();
    // the button's own handler runs first and plays its sound; the click that follows the same press is not added to it
    sounds.play('result', 5000);
    sounds.play('click');
    expect(made.started).toBe(1);
    // a press a moment later is a press of its own
    now += 500;
    sounds.play('click');
    expect(made.started).toBe(2);
  });
});
