import { MAX_VOLUME, prefs } from './prefs.ts';

/**
 * The game's sounds: a handful of short, quiet tones made with Web Audio, no files. Nothing is
 * created until the player has touched the page (browsers refuse audio before that, and it would
 * be rude anyway), and nothing plays while the Sound setting is off or the volume is at zero. The
 * click of a button is one of them (see click-sound.ts for what makes one).
 */

export type SoundName = 'pin' | 'guess' | 'result' | 'tick' | 'match' | 'chat' | 'click';

/** The little of Web Audio this needs, so a test can stand in for it. */
interface Param {
  setValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
interface AudioLike {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<unknown>;
  createOscillator(): { type: string; frequency: Param; connect(node: unknown): unknown; start(time?: number): unknown; stop(time?: number): unknown };
  createGain(): { gain: Param; connect(node: unknown): unknown };
}

interface Tone {
  /** Hz */
  pitch: number;
  /** seconds after the sound starts */
  at: number;
  /** seconds */
  length: number;
  /** how loud beside the other sounds, as a share of the level; the whole of it when left out */
  share?: number;
}

/** how loud a tone is with the volume at the top; the middle, where a new browser starts, is half of it */
export const MAX_GAIN = 0.12;
const MAX_SCORE = 5000;
const LOW_PITCH = 220;
const HIGH_PITCH = 880;

const TONES: Record<Exclude<SoundName, 'result'>, Tone[]> = {
  pin: [{ pitch: 520, at: 0, length: 0.05 }],
  guess: [
    { pitch: 440, at: 0, length: 0.07 },
    { pitch: 660, at: 0.07, length: 0.09 },
  ],
  tick: [{ pitch: 880, at: 0, length: 0.04 }],
  match: [
    { pitch: 523, at: 0, length: 0.1 },
    { pitch: 659, at: 0.1, length: 0.1 },
    { pitch: 784, at: 0.2, length: 0.16 },
  ],
  chat: [{ pitch: 700, at: 0, length: 0.06 }],
  // a button pressed: low, very short and at half the level, so a pane of buttons does not chirp
  click: [{ pitch: 330, at: 0, length: 0.03, share: 0.5 }],
};

/**
 * A press that plays a sound of its own (an answer given, the volume let go) is followed, in the
 * same instant, by the click every button makes. Within this long of another sound the click is
 * left out, so one press is one sound.
 */
const SAME_PRESS_MS = 60;

export function createSounds(deps: { context: () => AudioLike; enabled: () => boolean; /** 0 to 100; the top when left out */ volume?: () => number; /** the time in ms; the browser's clock when left out */ now?: () => number }) {
  let unlocked = false;
  let audio: AudioLike | null = null;
  /** when a sound other than the click last played */
  let lastOwn = Number.NEGATIVE_INFINITY;
  const now = deps.now ?? (() => performance.now());

  /** The level every tone starts at, from the volume setting: nothing at 0, `MAX_GAIN` at the top. */
  const level = (): number => (Math.min(MAX_VOLUME, Math.max(0, deps.volume?.() ?? MAX_VOLUME)) / MAX_VOLUME) * MAX_GAIN;

  /** A round's result sounds higher the better it went: two octaves from nothing to a perfect score. */
  const resultPitch = (score: number) => LOW_PITCH * (HIGH_PITCH / LOW_PITCH) ** (Math.min(MAX_SCORE, Math.max(0, score)) / MAX_SCORE);

  function tone(context: AudioLike, { pitch, at, length, share = 1 }: Tone, level: number): void {
    const gainLevel = level * share;
    const start = context.currentTime + at;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(pitch, start);
    gain.gain.setValueAtTime(gainLevel, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + length);
  }

  return {
    resultPitch,
    /** Called on the player's first touch or key: from then on sounds may play. */
    unlock(): void {
      unlocked = true;
    },
    /** `score` is for `result`, whose pitch follows it. */
    play(name: SoundName, score = 0): void {
      const gainLevel = level();
      if (!unlocked || !deps.enabled() || gainLevel === 0) {
        return;
      }
      if (name === 'click' && now() - lastOwn < SAME_PRESS_MS) {
        return;
      }
      if (name !== 'click') {
        lastOwn = now();
      }
      try {
        audio ??= deps.context();
        if (audio.state === 'suspended') {
          void audio.resume();
        }
        const tones = name === 'result' ? [{ pitch: resultPitch(score), at: 0, length: 0.22 }] : TONES[name];
        tones.forEach((each) => tone(audio as AudioLike, each, gainLevel));
      } catch {
        // no audio on this device, or it was refused: the game is the same without it
      }
    },
  };
}

export const sounds = createSounds({ context: () => new AudioContext(), enabled: () => prefs.sound(), volume: () => prefs.volume() });
