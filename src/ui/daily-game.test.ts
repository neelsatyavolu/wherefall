import { describe, expect, it } from 'vitest';
import type { Result } from '../account/client.ts';
import type { DailyState } from '../daily/client.ts';
import { createSession, submitGuess, totalScore, type Session } from '../game/session.ts';
import { dailyGame } from './daily-game.ts';

const PLACES = [
  { id: 'a', lng: 2, lat: 48, country: 'FR' },
  { id: 'b', lng: 36, lat: -1, country: 'KE' },
  { id: 'c', lng: 139, lat: 35, country: 'JP' },
];

/** A finished daily: three guesses a little off each place. */
const played = (): Session => PLACES.reduce((session, place) => submitGuess(session, { lng: place.lng + 1, lat: place.lat }, false, 1000), createSession(PLACES, 20_000));

const standing = (score: number, beat: number, date = '2026-10-11'): Result<DailyState> => ({
  ok: true,
  data: {
    date,
    seed: 'daily20261011',
    settings: { map: 'world', mode: 'move', timeLimit: 60, rounds: 3 },
    serverNow: '2026-10-11T18:00:00.000Z',
    nextAt: '2026-10-12T00:00:00.000Z',
    state: 'done',
    yours: { score, maxScore: 15_000, rounds: [score, 0, 0], rank: 2, beat, averages: null, personalBest: false },
    streak: { current: 1, best: 1, atRisk: false },
    records: { played: 1, best: score, average: score },
    history: [],
    leaderboard: { entries: [], page: 1, more: false },
    distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
});

const URL = 'https://plonk.test/#daily';
const unread = async (): Promise<Result<DailyState>> => ({ ok: false, error: 'Try again shortly.' });

/** The summary's own part as a list of what it was told to show: no page is needed to see that. */
function fakeExtras() {
  const showed: Array<{ standing: { personalBest: boolean; averages: number[] | null } } | 'stale'> = [];
  const node = {} as HTMLElement;
  return {
    showed,
    node,
    make: () => ({ node, showStanding: (standing: { personalBest: boolean; averages: number[] | null }) => void showed.push({ standing }), showStale: () => void showed.push('stale') }),
  };
}

const game = (read: () => Promise<Result<DailyState>> = unread, extras = fakeExtras(), lost: string[] = []) =>
  dailyGame('2026-10-11', 'daily20261011', { read, url: () => URL, extras: extras.make, lost: (date) => void lost.push(date) });

const beatLineOf = (text: string) => text.split('\n').find((line) => line.startsWith('Beat')) ?? null;

describe("the daily game's share text", () => {
  it('has no players beaten until the result is known to be saved', () => {
    const session = played();
    const text = game().shareText(session);
    expect(text.split('\n')[0]).toBe('Wherefall daily challenge · October 11, 2026');
    expect(text.split('\n').at(-1)).toBe(URL);
    expect(beatLineOf(text)).toBeNull();
  });

  it('says how many players the saved result beat', async () => {
    const session = played();
    const saved = game(async () => standing(totalScore(session), 72));
    await saved.learnStanding();
    expect(beatLineOf(saved.shareText(session))).toBe('Beat 72% of players');
  });

  it('says nothing of an earlier result that is the one on the leaderboard, or of another day', async () => {
    const session = played();
    const earlier = game(async () => standing(totalScore(session) + 1, 72));
    await earlier.learnStanding();
    expect(beatLineOf(earlier.shareText(session))).toBeNull();
    const tomorrow = game(async () => standing(totalScore(session), 72, '2026-10-12'));
    await tomorrow.learnStanding();
    expect(beatLineOf(tomorrow.shareText(session))).toBeNull();
  });

  it('says nothing when the standing cannot be read', async () => {
    const session = played();
    const unknown = game();
    await unknown.learnStanding();
    expect(beatLineOf(unknown.shareText(session))).toBeNull();
  });
});

describe("the daily game's summary", () => {
  /** the saved result with what the day adds to it */
  const withExtras = (score: number, personalBest: boolean, averages: number[] | null): Result<DailyState> => {
    const day = standing(score, 40);
    return day.ok ? { ok: true, data: { ...day.data, yours: { ...day.data.yours!, personalBest, averages } } } : day;
  };

  it('shows nothing of the standing until it is known', () => {
    const extras = fakeExtras();
    expect(game(unread, extras).extras(played())).toBe(extras.node);
    expect(extras.showed).toEqual([]);
  });

  it("shows the saved result's personal best and averages, whether the summary or the answer comes first", async () => {
    const session = played();
    const answer = async () => withExtras(totalScore(session), true, [3000, 3000, 3000]);
    const shown = { standing: expect.objectContaining({ personalBest: true, averages: [3000, 3000, 3000] }) };

    const summaryFirst = fakeExtras();
    const first = game(answer, summaryFirst);
    first.extras(session);
    await first.learnStanding();
    expect(summaryFirst.showed).toEqual([shown]);

    const answerFirst = fakeExtras();
    const second = game(answer, answerFirst);
    await second.learnStanding();
    second.extras(session);
    expect(answerFirst.showed).toEqual([shown]);
  });

  it('shows nothing of an earlier result that is the one on the leaderboard: its best and its averages are not this game’s', async () => {
    const session = played();
    const extras = fakeExtras();
    const earlier = game(async () => withExtras(totalScore(session) + 1, true, [3000, 3000, 3000]), extras);
    earlier.extras(session);
    await earlier.learnStanding();
    expect(extras.showed).toEqual([]);
  });

  it('says a game the server could not take for its places was lost to an update, notes the day, and keeps saying so', async () => {
    const session = played();
    const extras = fakeExtras();
    const lost: string[] = [];
    const stale = game(unread, extras, lost);
    stale.markStale();
    expect(lost).toEqual(['2026-10-11']);
    stale.extras(session);
    // the standing is asked for afterwards as after any save: there is none, and the notice stays
    await stale.learnStanding();
    expect(extras.showed.every((each) => each === 'stale')).toBe(true);
    expect(extras.showed.length).toBeGreaterThan(0);
  });
});
