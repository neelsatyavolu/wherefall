import { describe, expect, it } from 'vitest';
import { REFUSALS, type Result, type SavedGame, type SavedGameReply } from '../account/client.ts';
import { DAILY_MIN_MS, finishDaily } from './finish.ts';

const GAME: SavedGame = {
  map: 'world',
  mode: 'move',
  timeLimit: 60,
  seed: 'daily20261011',
  daily: '2026-10-11',
  rounds: [{ id: 'a', lng: 2, lat: 48, guessLng: 2.1, guessLat: 48.1, hinted: false, country: 'FR', distanceKm: 10, score: 4800 }],
};

const REPLY: SavedGameReply = { playedAt: '2026-10-11T09:00:00.000Z', map: 'world', mode: 'move', rounds: 3, score: 4800, maxScore: 15_000, xpEarned: 96, xpCapped: false };
const saved: Result<SavedGameReply> = { ok: true, data: REPLY };
const tooSoon: Result<SavedGameReply> = { ok: false, error: REFUSALS.dailyTooSoon };

/** A clock a test moves: `sleep` waits no time at all, and says how long it was asked to. */
function fakeClock(start: number) {
  const slept: number[] = [];
  let at = start;
  return {
    slept,
    now: () => at,
    sleep: async (ms: number) => {
      slept.push(ms);
      at += ms;
    },
  };
}

/** A save that gives each of `answers` in turn, and notes when it was asked. */
function saver(clock: { now: () => number }, ...answers: Array<Result<SavedGameReply>>) {
  const asked: number[] = [];
  return {
    asked,
    save: async (game: SavedGame) => {
      expect(game).toBe(GAME);
      asked.push(clock.now());
      return answers[asked.length - 1]!;
    },
  };
}

const BEGUN = 1_000_000;

describe('finishDaily', () => {
  it('saves a daily the server takes, once', async () => {
    const clock = fakeClock(BEGUN + 90_000);
    const { save, asked } = saver(clock, saved);
    expect(await finishDaily(GAME, BEGUN, clock, save)).toEqual(saved);
    expect(asked).toHaveLength(1);
    expect(clock.slept).toEqual([]);
  });

  it('sends a daily finished too soon once more, when the six seconds since its start have passed', async () => {
    const clock = fakeClock(BEGUN + 2500);
    const { save, asked } = saver(clock, tooSoon, saved);
    expect(await finishDaily(GAME, BEGUN, clock, save)).toEqual(saved);
    expect(asked).toHaveLength(2);
    // not a hair early the second time either
    expect(asked[1]).toBeGreaterThan(BEGUN + DAILY_MIN_MS);
    expect(clock.slept).toEqual([DAILY_MIN_MS - 2500 + 500]);
  });

  it('gives the refusal back when the second is too soon as well, and asks no third time', async () => {
    const clock = fakeClock(BEGUN + 1000);
    const { save, asked } = saver(clock, tooSoon, tooSoon, saved);
    expect(await finishDaily(GAME, BEGUN, clock, save)).toEqual(tooSoon);
    expect(asked).toHaveLength(2);
  });

  it('waits only a moment when this browser thinks the time has passed already', async () => {
    const clock = fakeClock(BEGUN + 60_000);
    const { save } = saver(clock, tooSoon, saved);
    expect(await finishDaily(GAME, BEGUN, clock, save)).toEqual(saved);
    expect(clock.slept).toEqual([500]);
  });

  it('does not send again what was refused for any other reason', async () => {
    for (const error of [REFUSALS.dailyUnstarted, "Those are not today's places.", REFUSALS.signIn]) {
      const clock = fakeClock(BEGUN + 1000);
      const { save, asked } = saver(clock, { ok: false, error }, saved);
      expect(await finishDaily(GAME, BEGUN, clock, save)).toEqual({ ok: false, error });
      expect(asked).toHaveLength(1);
    }
  });
});
