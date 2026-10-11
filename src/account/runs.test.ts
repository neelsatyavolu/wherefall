import { describe, expect, it } from 'vitest';
import { REFUSALS, type AccountState, type Result } from './client.ts';
import { RUN_ROUND_MS, beginRun, finishBegunGuesser, finishBegunStreak, finishGuesserRun, finishStreak, startRun, type RunRound } from './runs.ts';
import { UNEXPECTED, bodyOf, failure, fakeFetch, success } from './testing.ts';

const posted = (calls: ReturnType<typeof fakeFetch>['calls'], at = 0) => {
  expect(calls[at]?.url).toBe('/api/games');
  expect(calls[at]?.init?.method).toBe('POST');
  return bodyOf(calls[at]);
};

const TOKEN = 'run.token.signed';
const rounds: RunRound[] = [
  { id: 'fr-01', answer: 'FR' },
  { id: 'jp-01', answer: 'JP' },
  { id: 'ke-01', answer: null },
];

describe('startRun', () => {
  it.each(['streak', 'country', 'continent'] as const)('begins a %s run on the server and reads its token', async (kind) => {
    const { fetchFn, calls } = fakeFetch(success({ run: TOKEN }, 201));
    expect(await startRun(kind, fetchFn)).toEqual({ ok: true, data: { run: TOKEN } });
    expect(calls).toHaveLength(1);
    expect(posted(calls)).toEqual({ action: 'start', kind });
  });

  it.each([
    ['Too many runs started in the last hour. Try again later.', 429],
    [REFUSALS.signIn, 401],
    [REFUSALS.guests, 403],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await startRun('streak', fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply without a token', async () => {
    expect(await startRun('streak', fakeFetch(success({ run: '' }, 201)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
    expect(await startRun('streak', fakeFetch(success({ state: 'started' }, 201)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('finishStreak', () => {
  const reply = { bestStreak: 9, streak: 2, xpEarned: 40, xpCapped: false };

  it('posts the token and every round played, the losing one last, and reads what the server counted', async () => {
    const { fetchFn, calls } = fakeFetch(success(reply));
    expect(await finishStreak(TOKEN, rounds, false, fetchFn)).toEqual({ ok: true, data: reply });
    expect(posted(calls)).toEqual({ kind: 'streak', run: TOKEN, rounds });
  });

  it('marks the streak counted behind ordinary world games, which earns no XP of its own', async () => {
    const { fetchFn, calls } = fakeFetch(success({ ...reply, xpEarned: 0 }));
    await finishStreak(TOKEN, rounds, true, fetchFn);
    expect(posted(calls)).toEqual({ kind: 'streak', run: TOKEN, rounds, inPlay: true });
  });

  it('reads a run past the day\'s XP cap', async () => {
    const capped = { ...reply, xpEarned: 0, xpCapped: true };
    expect(await finishStreak(TOKEN, rounds, false, fakeFetch(success(capped)).fetchFn)).toEqual({ ok: true, data: capped });
  });

  it.each([
    [REFUSALS.runTooSoon, 409],
    ['That run was not started here.', 400],
    ['That run could not be saved: its places are not known.', 400],
    [REFUSALS.signIn, 401],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await finishStreak(TOKEN, rounds, false, fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it.each([
    ['is a guesser result', { best: 7000, correct: 7, xpEarned: 140, xpCapped: false }],
    ['does not say how long the streak was', { ...reply, streak: undefined }],
    ['does not say whether the XP was capped', { ...reply, xpCapped: undefined }],
  ])('refuses a reply that %s', async (_name, data) => {
    expect(await finishStreak(TOKEN, rounds, false, fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('finishGuesserRun', () => {
  const reply = { best: 8000, correct: 7, xpEarned: 140, xpCapped: false };

  it('posts a Country Guesser run with the country picked in each round', async () => {
    const { fetchFn, calls } = fakeFetch(success(reply));
    expect(await finishGuesserRun('country', TOKEN, rounds, fetchFn)).toEqual({ ok: true, data: reply });
    expect(posted(calls)).toEqual({ kind: 'country', run: TOKEN, rounds });
  });

  it('posts a Continent Guesser run with the continent picked in each round', async () => {
    const picked: RunRound[] = [
      { id: 'fr-01', answer: 'europe' },
      { id: 'us-01', answer: 'north-america' },
    ];
    const { fetchFn, calls } = fakeFetch(success(reply));
    await finishGuesserRun('continent', TOKEN, picked, fetchFn);
    expect(posted(calls)).toEqual({ kind: 'continent', run: TOKEN, rounds: picked });
  });

  it('refuses a reply that is a streak result', async () => {
    const streak = { bestStreak: 9, streak: 2, xpEarned: 40, xpCapped: false };
    expect(await finishGuesserRun('country', TOKEN, rounds, fakeFetch(success(streak)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('passes on the refusal for a run finished too soon', async () => {
    expect(await finishGuesserRun('country', TOKEN, rounds, fakeFetch(failure(REFUSALS.runTooSoon, 409)).fetchFn)).toEqual({ ok: false, error: REFUSALS.runTooSoon });
  });
});

/** A clock a test moves: `sleep` waits no time at all, and says how long it was asked to. */
function fakeClock(start = 1_000_000) {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    advance: (ms: number) => {
      now += ms;
    },
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms);
        now += ms;
      },
    },
  };
}

const state = (account: boolean, guest: string | null = null): Result<AccountState> => ({
  ok: true,
  data: { account: account ? ({ username: 'neel' } as NonNullable<AccountState['account']>) : null, guest, stats: null, recentGames: [] },
});

describe('beginRun', () => {
  it('starts the run for a signed-in player and notes when its token came', async () => {
    const { clock } = fakeClock(5000);
    const starts: string[] = [];
    const begun = beginRun('country', {
      ...clock,
      account: async () => state(true),
      start: async (kind) => {
        starts.push(kind);
        return { ok: true, data: { run: TOKEN } };
      },
    });
    expect(begun.kind).toBe('country');
    expect(await begun.started).toEqual({ ok: true, data: { run: TOKEN, at: 5000 } });
    expect(starts).toEqual(['country']);
  });

  it.each([
    ['a visitor', state(false), REFUSALS.signIn],
    ['a guest', state(false, 'Guest #4821'), REFUSALS.guests],
  ])('asks the server for nothing for %s, who has nowhere to save a run', async (_who, account, error) => {
    let asked = 0;
    const begun = beginRun('streak', {
      ...fakeClock().clock,
      account: async () => account,
      start: async () => {
        asked += 1;
        return { ok: true, data: { run: TOKEN } };
      },
    });
    expect(await begun.started).toEqual({ ok: false, error });
    expect(asked).toBe(0);
  });

  it('passes on a start the server refused, and an account that could not be read', async () => {
    const tooMany = 'Too many runs started in the last hour. Try again later.';
    const refused = beginRun('streak', { ...fakeClock().clock, account: async () => state(true), start: async () => ({ ok: false, error: tooMany }) });
    expect(await refused.started).toEqual({ ok: false, error: tooMany });
    const unread = beginRun('streak', { ...fakeClock().clock, account: async () => ({ ok: false, error: 'offline' }), start: async () => ({ ok: true, data: { run: TOKEN } }) });
    expect(await unread.started).toEqual({ ok: false, error: 'offline' });
  });
});

describe('finishing a run that was begun', () => {
  const begunAt = (kind: 'streak' | 'country' | 'continent', at: number) => ({ kind, started: Promise.resolve({ ok: true as const, data: { run: TOKEN, at } }) });
  const streakReply = { bestStreak: 9, streak: 2, xpEarned: 40, xpCapped: false };
  const guesserReply = { best: 8000, correct: 7, xpEarned: 140, xpCapped: false };

  it('sends the run at once, and waits for nothing when the server takes it', async () => {
    const time = fakeClock(100_000);
    const { fetchFn, calls } = fakeFetch(success(streakReply));
    expect(await finishBegunStreak(begunAt('streak', 99_000) as Parameters<typeof finishBegunStreak>[0], rounds, false, time.clock, fetchFn)).toEqual({ ok: true, data: streakReply });
    expect(time.slept).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(posted(calls)).toEqual({ kind: 'streak', run: TOKEN, rounds });
  });

  it('sends a run the server found too quick once more, when two seconds a round have passed since its start', async () => {
    const time = fakeClock(100_000);
    expect(RUN_ROUND_MS).toBe(2000);
    const replies = [failure(REFUSALS.runTooSoon, 409), success(guesserReply)];
    const { fetchFn, calls } = fakeFetch(() => replies.shift()!());
    // three rounds answered 2.5 seconds after the start: 3.5 seconds short of six
    const begun = begunAt('country', 97_500) as Parameters<typeof finishBegunGuesser>[0];
    expect(await finishBegunGuesser(begun, rounds, time.clock, fetchFn)).toEqual({ ok: true, data: guesserReply });
    expect(time.slept).toEqual([4000]);
    expect(calls).toHaveLength(2);
    expect(posted(calls, 1)).toEqual({ kind: 'country', run: TOKEN, rounds });
  });

  it('does not ask a third time, and passes on any other refusal as it came', async () => {
    const twice = fakeFetch(failure(REFUSALS.runTooSoon, 409));
    expect(await finishBegunStreak(begunAt('streak', 0) as Parameters<typeof finishBegunStreak>[0], rounds, false, fakeClock().clock, twice.fetchFn)).toEqual({ ok: false, error: REFUSALS.runTooSoon });
    expect(twice.calls).toHaveLength(2);
    const unknown = fakeFetch(failure('That run could not be saved: its places are not known.', 400));
    const time = fakeClock();
    expect((await finishBegunStreak(begunAt('streak', 0) as Parameters<typeof finishBegunStreak>[0], rounds, false, time.clock, unknown.fetchFn)).ok).toBe(false);
    expect(unknown.calls).toHaveLength(1);
    expect(time.slept).toEqual([]);
  });

  it('passes inPlay on for the streak behind world games', async () => {
    const { fetchFn, calls } = fakeFetch(success(streakReply));
    await finishBegunStreak(begunAt('streak', 0) as Parameters<typeof finishBegunStreak>[0], rounds, true, fakeClock().clock, fetchFn);
    expect(posted(calls)).toEqual({ kind: 'streak', run: TOKEN, rounds, inPlay: true });
  });

  it('sends nothing for a run that was never begun, and says why', async () => {
    const { fetchFn, calls } = fakeFetch(success(streakReply));
    const never = { kind: 'streak' as const, started: Promise.resolve({ ok: false as const, error: REFUSALS.signIn }) };
    expect(await finishBegunStreak(never, rounds, false, fakeClock().clock, fetchFn)).toEqual({ ok: false, error: REFUSALS.signIn });
    expect(calls).toHaveLength(0);
  });
});
