import { describe, expect, it } from 'vitest';
import { UNEXPECTED, bodyOf, failure, fakeFetch, success } from '../account/testing.ts';
import { parseLocationSet } from '../game/locations.ts';
import { ViewerBudgetError, withinBudget } from '../imagery/budget.ts';
import type { ImageryProvider } from '../imagery/provider.ts';
import { askViewer, claimDaily, dailyChallenge, getDaily, startDaily, type DailyState, type StoredDaily } from './client.ts';

const daily: DailyState = {
  date: '2026-10-11',
  seed: 'daily20261011',
  settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 3 },
  serverNow: '2026-10-11T12:00:00.000Z',
  nextAt: '2026-10-12T00:00:00.000Z',
  state: 'done',
  yours: { score: 11_250, maxScore: 15_000, rounds: [4800, 3950, 2500], rank: 2, beat: 50, averages: [3900, 4100, 2500], personalBest: true },
  streak: { current: 4, best: 9, atRisk: false },
  records: { played: 12, best: 14_200, average: 9870 },
  history: [
    { date: '2026-10-10', score: 9000 },
    { date: '2026-10-11', score: 11_250 },
  ],
  leaderboard: {
    entries: [
      { rank: 1, username: 'sam', country: 'GB', score: 13_000 },
      { rank: 2, username: 'neel', country: null, score: 11_250 },
    ],
    page: 1,
    more: false,
  },
  distribution: [0, 0, 1, 0, 0, 0, 0, 1, 1, 0],
};

/** What a visitor is sent: nothing about them, and the challenge open. */
const forVisitor = { ...daily, state: 'open', yours: null, streak: { current: 0, best: 0, atRisk: false }, records: null, history: [] };

describe('getDaily', () => {
  it("asks for today's challenge and the first page of its leaderboard", async () => {
    const { fetchFn, calls } = fakeFetch(success(daily));
    expect(await getDaily(1, fetchFn)).toEqual({ ok: true, data: daily });
    expect(calls.map((call) => call.url)).toEqual(['/api/daily']);
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('asks for a later page of the leaderboard', async () => {
    const third = { ...daily, leaderboard: { entries: [{ rank: 41, username: 'ana', country: 'BR', score: 5000 }], page: 3, more: true } };
    const { fetchFn, calls } = fakeFetch(success(third));
    expect(await getDaily(3, fetchFn)).toEqual({ ok: true, data: third });
    expect(calls[0]?.url).toBe('/api/daily?page=3');
  });

  it('reads the challenge as a visitor is sent it', async () => {
    expect(await getDaily(1, fakeFetch(success(forVisitor)).fetchFn)).toEqual({ ok: true, data: forVisitor });
  });

  it('reads an attempt that is begun and not finished, with the streak at risk', async () => {
    const begun = { ...daily, state: 'started', yours: null, streak: { current: 3, best: 9, atRisk: true }, history: [{ date: '2026-10-11', score: null }] };
    expect(await getDaily(1, fakeFetch(success(begun)).fetchFn)).toEqual({ ok: true, data: begun });
  });

  it('reads a result on a day fewer than five players have finished: no averages yet', async () => {
    const early = { ...daily, yours: { ...daily.yours, averages: null, personalBest: false } };
    expect(await getDaily(1, fakeFetch(success(early)).fetchFn)).toEqual({ ok: true, data: early });
  });

  it('reads a result stored out of another maximum, as the server kept it', async () => {
    const old = { ...daily, yours: { ...daily.yours, maxScore: 25_000 } };
    expect(await getDaily(1, fakeFetch(success(old)).fetchFn)).toEqual({ ok: true, data: old });
  });

  it.each([
    ['the seed is missing', { ...daily, seed: undefined }],
    ['the settings are the five rounds of two minutes the daily used to be', { ...daily, settings: { ...daily.settings, timeLimit: 120, rounds: 5 } }],
    ['the daily is not three rounds', { ...daily, settings: { ...daily.settings, rounds: 5 } }],
    ['the daily is not sixty seconds a round', { ...daily, settings: { ...daily.settings, timeLimit: 120 } }],
    ['the daily is not one where the player may move', { ...daily, settings: { ...daily.settings, mode: 'nmpz' } }],
    ['the state is not one', { ...daily, state: 'played' }],
    ['the state is missing', { ...daily, state: undefined }],
    ['the leaderboard is the bare list it used to be', { ...daily, leaderboard: daily.leaderboard.entries }],
    ['a leaderboard row has no score', { ...daily, leaderboard: { ...daily.leaderboard, entries: [{ rank: 1, username: 'sam', country: null }] } }],
    ['a leaderboard row has no country', { ...daily, leaderboard: { ...daily.leaderboard, entries: [{ rank: 1, username: 'sam', score: 1 }] } }],
    ['the leaderboard does not say whether there is more', { ...daily, leaderboard: { entries: [], page: 1 } }],
    ['the result has no round scores', { ...daily, yours: { score: 1, maxScore: 15_000, rank: 1, beat: 0, averages: null, personalBest: false } }],
    ["the result says nothing of the day's averages", { ...daily, yours: { ...daily.yours, averages: undefined } }],
    ['the result does not say whether it is a personal best', { ...daily, yours: { ...daily.yours, personalBest: undefined } }],
    ['the result has no rank', { ...daily, yours: { ...daily.yours, rank: undefined } }],
    ['the result does not say how many it beat', { ...daily, yours: { ...daily.yours, beat: undefined } }],
    ['the streak is missing', { ...daily, streak: undefined }],
    ['the streak does not say whether it is at risk', { ...daily, streak: { current: 1, best: 1 } }],
    ['the records are missing', { ...daily, records: undefined }],
    ['the history is missing', { ...daily, history: undefined }],
    ['the distribution is not ten counts', { ...daily, distribution: [1, 2, 3] }],
    ['the time of the next daily is missing', { ...daily, nextAt: undefined }],
    ["the server's time is missing", { ...daily, serverNow: undefined }],
  ])('refuses a reply where %s', async (_name, data) => {
    expect(await getDaily(1, fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it("passes on the server's own explanation", async () => {
    expect(await getDaily(1, fakeFetch(failure('Try again shortly.', 503)).fetchFn)).toEqual({ ok: false, error: 'Try again shortly.' });
  });
});

describe('dailyChallenge', () => {
  it("is the day's settings with the day's seed: three rounds of sixty seconds, moving, on the world", () => {
    expect(dailyChallenge(daily)).toEqual({ map: 'world', mode: 'move', timeLimit: 60, rounds: 3, seed: 'daily20261011' });
  });
});

describe('startDaily', () => {
  it("marks an account's one attempt at today's as begun: no token comes back", async () => {
    const { fetchFn, calls } = fakeFetch(success({ state: 'started', token: null }));
    expect(await startDaily(fetchFn)).toEqual({ ok: true, data: { state: 'started', token: null } });
    expect(calls[0]?.url).toBe('/api/daily');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ action: 'start' });
  });

  it('reads that the day is already done', async () => {
    expect(await startDaily(fakeFetch(success({ state: 'done', token: null })).fetchFn)).toEqual({ ok: true, data: { state: 'done', token: null } });
  });

  it("reads the token a visitor's or a guest's start is answered with", async () => {
    const { fetchFn, calls } = fakeFetch(success({ state: 'started', token: 'daily.1760184000000.sig' }));
    expect(await startDaily(fetchFn)).toEqual({ ok: true, data: { state: 'started', token: 'daily.1760184000000.sig' } });
    expect(bodyOf(calls[0])).toEqual({ action: 'start' });
  });

  it('refuses a reply that says the daily is still open', async () => {
    expect(await startDaily(fakeFetch(success({ state: 'open', token: null })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a reply that leaves the token out', async () => {
    expect(await startDaily(fakeFetch(success({ state: 'started' })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it.each([
    ['Too many dailies started in the last hour. Try again later.', 429],
    ['Sign in first.', 401],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await startDaily(fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });
});

describe('claimDaily', () => {
  const stored: StoredDaily[] = [
    {
      daily: '2026-10-10',
      token: 'daily.1760097600000.sig',
      rounds: [
        { id: 'fr-01', country: 'FR', distanceKm: 12.5, score: 4800, lng: 2.35, lat: 48.85, guessLng: 2.5, guessLat: 48.9, hinted: false },
        { id: 'jp-01', country: 'JP', distanceKm: 900, score: 3100, lng: 139.69, lat: 35.69, guessLng: 135, guessLat: 34, hinted: false },
        { id: 'ar-01', country: 'AR', distanceKm: null, score: 0, lng: -58.38, lat: -34.6, guessLng: null, guessLat: null, hinted: false },
      ],
    },
  ];

  it('posts the stored results, each with the token of its start, and reads the days that were taken', async () => {
    const { fetchFn, calls } = fakeFetch(success({ claimed: ['2026-10-10'] }));
    expect(await claimDaily(stored, fetchFn)).toEqual({ ok: true, data: { claimed: ['2026-10-10'] } });
    expect(calls[0]?.url).toBe('/api/daily');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ action: 'claim', results: stored });
  });

  it('reads an answer where no day was taken', async () => {
    expect(await claimDaily(stored, fakeFetch(success({ claimed: [] })).fetchFn)).toEqual({ ok: true, data: { claimed: [] } });
  });

  it.each([
    ['Results can only be claimed on the day an account is made.', 403],
    ['A claim holds 1 to 14 results.', 400],
    ['Too many claims in the last hour. Try again later.', 429],
  ])('passes on the refusal "%s"', async (error, status) => {
    expect(await claimDaily(stored, fakeFetch(failure(error, status)).fetchFn)).toEqual({ ok: false, error });
  });

  it('refuses a reply without the list of days', async () => {
    expect(await claimDaily(stored, fakeFetch(success({ claimed: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('askViewer', () => {
  it('asks the server whether a Google viewer may be made today', async () => {
    const answer = { google: true, usedToday: 12, limit: 150 };
    const { fetchFn, calls } = fakeFetch(success(answer));
    expect(await askViewer(fetchFn)).toEqual({ ok: true, data: answer });
    expect(calls[0]?.url).toBe('/api/daily');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ action: 'viewer' });
  });

  it("reads a no once the day's limit is reached", async () => {
    const answer = { google: false, usedToday: 150, limit: 150 };
    expect(await askViewer(fakeFetch(success(answer)).fetchFn)).toEqual({ ok: true, data: answer });
  });

  it('reads a no given with allowance to spare: the address has had its share, or the rest is kept for accounts', async () => {
    const answer = { google: false, usedToday: 100, limit: 150 };
    expect(await askViewer(fakeFetch(success(answer)).fetchFn)).toEqual({ ok: true, data: answer });
  });

  it('refuses a reply without an answer', async () => {
    expect(await askViewer(fakeFetch(success({ usedToday: 1, limit: 150 })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('leaves a game on open imagery for every kind of no alike, whatever the counts beside it say', async () => {
    const place = { id: 'a', lng: 1, lat: 2, country: 'FR' };
    const noes = [
      // the day's allowance is used up
      { google: false, usedToday: 150, limit: 150 },
      // this address has had its forty of the day
      { google: false, usedToday: 12, limit: 150 },
      // a visitor or a guest, with the last third kept for accounts
      { google: false, usedToday: 100, limit: 150 },
    ];
    for (const answer of noes) {
      const opened: string[] = [];
      const google: ImageryProvider = {
        name: 'google',
        attribution: null,
        places: async () => parseLocationSet({ regions: {}, locations: [['a', 1, 2, 'FR']] }),
        resolve: async (location) => {
          opened.push(location.id);
          return { lng: location.lng, lat: location.lat, credit: 'g' };
        },
        isGone: () => false,
        createView: async () => {
          opened.push('view');
          return { show: async () => {}, returnToStart: async () => {}, moveByKey: () => {}, destroy: () => {} };
        },
      };
      // asked as the game asks: only `google` is read, so no reason for a no is treated differently from another
      const source = withinBudget(google, async () => {
        const reply = await askViewer(fakeFetch(success(answer)).fetchFn);
        return reply.ok && reply.data.google;
      });
      await expect(source.resolve(place)).rejects.toBeInstanceOf(ViewerBudgetError);
      await expect(source.createView({} as HTMLElement, 'move', { onBearing: () => {}, onAtStart: () => {}, onNotice: () => {} })).rejects.toBeInstanceOf(ViewerBudgetError);
      // Google was never opened, and the refusal is not mistaken for a place without a picture: the next source takes the game
      expect(opened).toEqual([]);
      expect(source.isGone(new ViewerBudgetError())).toBe(false);
    }
  });
});
