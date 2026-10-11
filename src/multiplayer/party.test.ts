import { describe, expect, it } from 'vitest';
import { bodyOf, failure, fakeFetch, success } from '../account/testing.ts';
import { backToLobby, chooseTeam, configureParty, endRound, kickPlayer, lockParty, makeHost, shuffleTeams } from './party.ts';
import { matchState } from './testing.ts';

const state = matchState();
const settings = { map: 'country:JP', mode: 'no-move', timeLimit: 0, rounds: 12, communication: 'off', teams: 'best' } as const;

describe('what a party can be sent', () => {
  it.each([
    ['configure', () => configureParty, ['m1', settings], { action: 'configure', matchId: 'm1', settings }],
    ['team', () => chooseTeam, ['m1', 1], { action: 'team', matchId: 'm1', team: 1 }],
    ['shuffle', () => shuffleTeams, ['m1'], { action: 'shuffle', matchId: 'm1' }],
    ['kick', () => kickPlayer, ['m1', 'sam'], { action: 'kick', matchId: 'm1', username: 'sam' }],
    ['host', () => makeHost, ['m1', 'sam'], { action: 'host', matchId: 'm1', username: 'sam' }],
    ['lock', () => lockParty, ['m1', true], { action: 'lock', matchId: 'm1', locked: true }],
    ['unlock', () => lockParty, ['m1', false], { action: 'lock', matchId: 'm1', locked: false }],
    ['endRound', () => endRound, ['m1'], { action: 'endRound', matchId: 'm1' }],
    ['lobby', () => backToLobby, ['m1'], { action: 'lobby', matchId: 'm1' }],
  ] as const)('%s posts its fields to /api/match and returns the match', async (_name, pick, args, body) => {
    const { fetchFn, calls } = fakeFetch(success(state));
    const send = pick() as (...all: unknown[]) => Promise<unknown>;
    expect(await send(...args, fetchFn)).toEqual({ ok: true, data: state });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/match');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(bodyOf(calls[0])).toEqual(body);
  });

  it('takes the unchanged match as the answer to an action sent in the wrong phase', async () => {
    const playing = matchState({ phase: 'playing' });
    expect(await shuffleTeams('m1', fakeFetch(success(playing)).fetchFn)).toEqual({ ok: true, data: playing });
  });

  it.each([
    ['Only the host can do that.', 403, () => kickPlayer('m1', 'sam', fakeFetch(failure('Only the host can do that.', 403)).fetchFn)],
    ['There is no such player in this match.', 409, () => kickPlayer('m1', 'nobody', fakeFetch(failure('There is no such player in this match.', 409)).fetchFn)],
    ['You cannot do that to yourself.', 409, () => makeHost('m1', 'neel', fakeFetch(failure('You cannot do that to yourself.', 409)).fetchFn)],
    ['A guest cannot host.', 409, () => makeHost('m1', 'Guest #4821', fakeFetch(failure('A guest cannot host.', 409)).fetchFn)],
    ['Teams are off in this party.', 409, () => chooseTeam('m1', 0, fakeFetch(failure('Teams are off in this party.', 409)).fetchFn)],
    ['Teams are off in this party.', 409, () => shuffleTeams('m1', fakeFetch(failure('Teams are off in this party.', 409)).fetchFn)],
    [
      'Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.',
      400,
      () => configureParty('m1', { ...settings, rounds: 21 }, fakeFetch(failure('Choose a map, a mode, 1 to 20 rounds, and no timer or 10 to 300 seconds a round.', 400)).fetchFn),
    ],
  ])('passes on the refusal "%s"', async (error, _status, send) => {
    expect(await send()).toEqual({ ok: false, error });
  });
});
