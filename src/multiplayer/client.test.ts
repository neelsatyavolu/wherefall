import { describe, expect, it } from 'vitest';
import { UNEXPECTED, UNREACHABLE, bodyOf, failure, fakeFetch, success } from '../account/testing.ts';
import {
  EMOTES,
  createParty,
  getMatch,
  getQueue,
  joinParty,
  joinQueue,
  leaveMatch,
  leaveQueue,
  mutePlayer,
  placesRefused,
  postPlaces,
  queueAsPair,
  sendChat,
  sendEmote,
  sendGuess,
  sendPin,
  startMatch,
} from './client.ts';
import { KIND_SETTINGS, PLACES, chatEntry, guest, mate, matchState, outcome, player, queueState, rankedState, settings as settingsOf, teamRow, teamState } from './testing.ts';

const state = matchState();
const queue = queueState({ queued: true, kind: 'ranked', waiting: 1, since: '2026-10-11T11:59:50.000Z', window: 150 });
const settings = { map: 'europe', mode: 'nmpz', timeLimit: 60, rounds: 5 } as const;

describe('actions that answer with the match', () => {
  it.each([
    ['create', () => createParty, [settings], { action: 'create', settings }],
    ['join', () => joinParty, ['ABC123'], { action: 'join', code: 'ABC123' }],
    ['start', () => startMatch, ['m1'], { action: 'start', matchId: 'm1' }],
    ['places', () => postPlaces, ['m1', PLACES], { action: 'places', matchId: 'm1', places: PLACES }],
    ['chat', () => sendChat, ['m1', 'good luck', 'all'], { action: 'chat', matchId: 'm1', text: 'good luck', scope: 'all' }],
    ['team chat', () => sendChat, ['m1', 'go north', 'team'], { action: 'chat', matchId: 'm1', text: 'go north', scope: 'team' }],
    ['emote', () => sendEmote, ['m1', 'gg'], { action: 'emote', matchId: 'm1', emote: 'gg' }],
    ['guess', () => sendGuess, ['m1', 2, { lng: 12.5, lat: -3.25 }], { action: 'guess', matchId: 'm1', round: 2, lng: 12.5, lat: -3.25 }],
    ['pin', () => sendPin, ['m1', 2, { lng: 12.5, lat: -3.25 }], { action: 'pin', matchId: 'm1', round: 2, lng: 12.5, lat: -3.25 }],
    ['mute', () => mutePlayer, ['m1', 'sam', true], { action: 'mute', matchId: 'm1', username: 'sam', muted: true }],
    ['unmute', () => mutePlayer, ['m1', 'sam', false], { action: 'mute', matchId: 'm1', username: 'sam', muted: false }],
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

  it('a chat message goes to everyone unless it is said to be for the team', async () => {
    const { fetchFn, calls } = fakeFetch(success(state));
    await sendChat('m1', 'good luck', undefined, fetchFn);
    expect(bodyOf(calls[0])).toEqual({ action: 'chat', matchId: 'm1', text: 'good luck', scope: 'all' });
  });

  it('creates a party with its communication and team mode when the host chose them', async () => {
    const chosen = { ...settings, timeLimit: 0, rounds: 20, communication: 'reactions', teams: 'average' } as const;
    const { fetchFn, calls } = fakeFetch(success(state, 201));
    await createParty(chosen, fetchFn);
    expect(bodyOf(calls[0])).toEqual({ action: 'create', settings: chosen });
  });

  it('creates a party that takes accounts only when the host turned guests off', async () => {
    const { fetchFn, calls } = fakeFetch(success(state, 201));
    await createParty({ ...settings, guests: false }, fetchFn);
    expect(bodyOf(calls[0])).toEqual({ action: 'create', settings: { ...settings, guests: false } });
  });

  it('sends no scale with the places: the server works it out from the map', async () => {
    const { fetchFn, calls } = fakeFetch(success(state));
    await postPlaces('m1', PLACES, fetchFn);
    expect(Object.keys(bodyOf(calls[0]) as object).sort()).toEqual(['action', 'matchId', 'places']);
  });

  it("passes on the server's own explanation when it refuses", async () => {
    const { fetchFn } = fakeFetch(failure('No party has that code.', 404));
    expect(await joinParty('NOPE00', fetchFn)).toEqual({ ok: false, error: 'No party has that code.' });
  });

  it.each([
    ['Chat is off in this match.', 403, () => sendChat('m1', 'hi', 'all', fakeFetch(failure('Chat is off in this match.', 403)).fetchFn)],
    ['Reactions are off in this match.', 403, () => sendEmote('m1', 'gg', fakeFetch(failure('Reactions are off in this match.', 403)).fetchFn)],
    ['You were removed from that party.', 403, () => joinParty('ABC123', fakeFetch(failure('You were removed from that party.', 403)).fetchFn)],
    ['That party is locked.', 409, () => joinParty('ABC123', fakeFetch(failure('That party is locked.', 409)).fetchFn)],
    ['That party is full: it has 20 players.', 409, () => joinParty('ABC123', fakeFetch(failure('That party is full: it has 20 players.', 409)).fetchFn)],
    [
      'That party is on its last round. Try again when it is back in its lobby.',
      409,
      () => joinParty('ABC123', fakeFetch(failure('That party is on its last round. Try again when it is back in its lobby.', 409)).fetchFn),
    ],
    ['There is no such player in this match.', 409, () => mutePlayer('m1', 'nobody', true, fakeFetch(failure('There is no such player in this match.', 409)).fetchFn)],
    ['You cannot do that to yourself.', 409, () => mutePlayer('m1', 'neel', true, fakeFetch(failure('You cannot do that to yourself.', 409)).fetchFn)],
    ['Guests cannot do that. Make an account first.', 403, () => createParty(settings, fakeFetch(failure('Guests cannot do that. Make an account first.', 403)).fetchFn)],
  ])('passes on the refusal "%s"', async (error, _status, send) => {
    expect(await send()).toEqual({ ok: false, error });
  });

  it('gives a friendly error when the network fails', async () => {
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await startMatch('m1', offline)).toEqual({ ok: false, error: UNREACHABLE });
  });
});

describe('leave and the queue', () => {
  it('leaves a match', async () => {
    const { fetchFn, calls } = fakeFetch(success({ left: true }));
    expect(await leaveMatch('m1', fetchFn)).toEqual({ ok: true, data: { left: true } });
    expect(bodyOf(calls[0])).toEqual({ action: 'leave', matchId: 'm1' });
  });

  it.each(['unranked', 'ranked', 'team'] as const)('joins the %s queue alone', async (kind) => {
    const { fetchFn, calls } = fakeFetch(success({ ...queue, kind }));
    expect(await joinQueue(kind, fetchFn)).toEqual({ ok: true, data: { ...queue, kind } });
    expect(calls[0]?.url).toBe('/api/match');
    expect(bodyOf(calls[0])).toEqual({ action: 'queue', kind });
  });

  it('queues a party of two for 2v2 as a pair, by the party', async () => {
    const paired = queueState({ queued: true, kind: 'team', waiting: 2, since: '2026-10-11T12:00:00.000Z' });
    const { fetchFn, calls } = fakeFetch(success(paired));
    expect(await queueAsPair('m1', fetchFn)).toEqual({ ok: true, data: paired });
    expect(calls[0]?.url).toBe('/api/match');
    expect(bodyOf(calls[0])).toEqual({ action: 'queue', kind: 'team', matchId: 'm1' });
  });

  it.each([
    ['To queue as a pair, be the host of a party of exactly two.', 409, () => queueAsPair('m1', fakeFetch(failure('To queue as a pair, be the host of a party of exactly two.', 409)).fetchFn)],
    [
      'You left two ranked matches before they began. You can queue again in 97 seconds.',
      429,
      () => joinQueue('ranked', fakeFetch(failure('You left two ranked matches before they began. You can queue again in 97 seconds.', 429)).fetchFn),
    ],
    ['Guests cannot do that. Make an account first.', 403, () => joinQueue('ranked', fakeFetch(failure('Guests cannot do that. Make an account first.', 403)).fetchFn)],
  ])('passes on the refusal "%s"', async (error, _status, send) => {
    expect(await send()).toEqual({ ok: false, error });
  });

  it('leaves the queue', async () => {
    const { fetchFn, calls } = fakeFetch(success({ queued: false }));
    expect(await leaveQueue(fetchFn)).toEqual({ ok: true, data: { queued: false } });
    expect(bodyOf(calls[0])).toEqual({ action: 'leaveQueue' });
  });

  it('refuses a leave reply that is not a leave', async () => {
    expect(await leaveMatch('m1', fakeFetch(success({ left: false })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
    expect(await leaveQueue(fakeFetch(success({ queued: true })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });
});

describe('getMatch', () => {
  it('asks for one match by id', async () => {
    const { fetchFn, calls } = fakeFetch(success(state));
    expect(await getMatch('m 1', fetchFn)).toEqual({ ok: true, data: state });
    expect(calls[0]?.url).toBe('/api/match?id=m%201');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('reads a finished ranked match', async () => {
    const finished = rankedState({
      phase: 'finished',
      places: PLACES,
      results: [{ round: 0, guesses: [{ username: 'neel', lng: null, lat: null, distanceKm: null, score: 0 }] }],
      outcome: outcome(['sam'], { ratingChanges: [{ username: 'neel', before: 1000, after: 984 }] }),
    });
    expect(await getMatch('m1', fakeFetch(success(finished)).fetchFn)).toEqual({ ok: true, data: finished });
  });

  it('reads a ranked match that was cancelled because a player left before the first guess', async () => {
    const dodged = rankedState({ phase: 'finished', places: PLACES, outcome: outcome([], { dodgedBy: 'sam' }) });
    expect(await getMatch('m1', fakeFetch(success(dodged)).fetchFn)).toEqual({ ok: true, data: dodged });
  });

  it.each([
    ['a public game of 45 seconds a round', matchState({ kind: 'unranked', code: null, settings: KIND_SETTINGS.unranked })],
    ['a party with no timer, whose round has no end', matchState({ phase: 'playing', settings: settingsOf({ timeLimit: 0 }), places: PLACES, roundStartsAt: '2026-10-11T12:00:05.000Z', roundEndsAt: null })],
    ['a party of one round of five minutes', matchState({ settings: settingsOf({ timeLimit: 300, rounds: 1 }) })],
    ['a party of twenty rounds, reactions only, locked', matchState({ locked: true, settings: settingsOf({ rounds: 20, communication: 'reactions' }) })],
    ['a party with chat off and teams scored by average', matchState({ settings: settingsOf({ communication: 'off', teams: 'average' }), teams: [teamRow(0, { health: null }), teamRow(1, { health: null })] })],
    ['a party with a guest in it and a player with a country', matchState({ players: [player('neel', { country: 'IN' }), guest(4821)] })],
    ['a match seen by a guest who has muted a player', matchState({ you: { username: 'Guest #4821', isHost: false, isResolver: false, team: null, guest: true, muted: ['sam'] } })],
    ['a party lobby that closed because its two players were queued for 2v2', matchState({ phase: 'finished', outcome: outcome([]), movedToQueue: 'team' })],
    [
      'a 2v2 under way with team health, a teammate\'s pin and a team message',
      teamState({
        phase: 'playing',
        places: PLACES,
        teams: [teamRow(0, { health: 3700, total: 4100 }), teamRow(1, { total: 5000 })],
        mates: [mate('sam'), mate('sam', { guessed: true })],
        chat: [chatEntry(1, 'sam', 'north of the river', { scope: 'team' }), chatEntry(2, 'ana', null, { emote: 'gl' })],
      }),
    ],
  ])('reads %s', async (_name, data) => {
    expect(await getMatch('m1', fakeFetch(success(data)).fetchFn)).toEqual({ ok: true, data });
  });

  it.each([
    ['the phase is unknown', { ...state, phase: 'paused' }],
    ['the kind is unknown', { ...state, kind: 'solo' }],
    ['the time limit is longer than a match can have', { ...state, settings: { ...state.settings, timeLimit: 310 } }],
    ['the time limit is not a number', { ...state, settings: { ...state.settings, timeLimit: 'none' } }],
    ['there are no rounds', { ...state, settings: { ...state.settings, rounds: 0 } }],
    ['there are more rounds than a match can have', { ...state, settings: { ...state.settings, rounds: 21 } }],
    ['the settings do not say how players may talk', { ...state, settings: { ...state.settings, communication: undefined } }],
    ['the communication is not one', { ...state, settings: { ...state.settings, communication: 'voice' } }],
    ['the settings do not say the team mode', { ...state, settings: { ...state.settings, teams: undefined } }],
    ['it does not say whether it is locked', { ...state, locked: undefined }],
    ['a team is not 0 or 1', { ...state, you: { ...state.you, team: 2 } }],
    ['it does not say whether the player is a guest', { ...state, you: { ...state.you, guest: undefined } }],
    ['the muted players are missing', { ...state, you: { ...state.you, muted: undefined } }],
    ['a place has no coordinates', { ...state, places: [{ id: 'x', country: 'FR' }] }],
    ['the server time is missing', { ...state, serverNow: undefined }],
    ['the players are missing', { ...state, players: undefined }],
    ['a player has no country field', { ...state, players: [{ ...state.players[0], country: undefined }] }],
    ['a player does not say whether they are a guest', { ...state, players: [{ ...state.players[0], guest: undefined }] }],
    ['the chat is missing', { ...state, chat: undefined }],
    ['a chat line does not say who it was for', { ...state, chat: [{ id: 1, username: 'sam', text: 'hi', emote: null, at: '2026-10-11T12:00:01.000Z' }] }],
    ['a player has no health field', { ...state, players: [{ ...state.players[0], health: undefined }] }],
    ['the teams are missing', { ...state, teams: undefined }],
    ['a team has no total', { ...state, teams: [{ team: 0, health: 5000 }] }],
    ['the teammates are missing', { ...state, mates: undefined }],
    ['a teammate has no pin', { ...state, mates: [{ username: 'sam', guessed: false }] }],
    ['the outcome does not say who dodged', { ...state, outcome: { winners: [], ratingChanges: [] } }],
    ['it does not say whether the party moved to a queue', { ...state, movedToQueue: undefined }],
    ['it moved to a queue that pairs cannot join', { ...state, movedToQueue: 'ranked' }],
    ['the map is not one', { ...state, settings: { ...state.settings, map: 'country:france' } }],
  ])('refuses a match where %s', async (_name, data) => {
    expect(await getMatch('m1', fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('passes on what a removed player is told', async () => {
    const error = 'You were removed from that party.';
    expect(await getMatch('m1', fakeFetch(failure(error, 403)).fetchFn)).toEqual({ ok: false, error });
  });
});

describe('the fields added for ranked health, chat and country maps', () => {
  it('reads a ranked match with health and reactions', async () => {
    const ranked = rankedState({
      phase: 'playing',
      chat: [chatEntry(1, 'sam', null, { emote: 'gl' }), chatEntry(2, 'neel', null, { emote: 'gg' })],
    });
    expect(ranked.settings).toMatchObject({ mode: 'move', timeLimit: 60, rounds: 5, communication: 'reactions' });
    expect(await getMatch('m1', fakeFetch(success(ranked)).fetchFn)).toEqual({ ok: true, data: ranked });
  });

  it('reads a party on a country map', async () => {
    const party = matchState({ settings: { ...state.settings, map: 'country:FR' } });
    expect(await getMatch('m1', fakeFetch(success(party)).fetchFn)).toEqual({ ok: true, data: party });
  });
});

describe('the reactions', () => {
  it('are the twenty the server takes, in its order', () => {
    expect(EMOTES).toEqual(['gg', 'gl', 'hi', 'bye', 'nice', 'wow', 'oof', 'close', 'hm', 'lol', 'ty', 'sorry', 'rip', 'yes', 'no', 'think', 'clap', 'fire', 'sad', 'heart']);
    expect(new Set(EMOTES).size).toBe(20);
  });
});

describe('the fields added in wave 6', () => {
  it('reads whether a party takes guests', async () => {
    const closed = matchState({ settings: settingsOf({ guests: false }) });
    const read = await getMatch('m1', fakeFetch(success(closed)).fetchFn);
    expect(read.ok && read.data.settings.guests).toBe(false);
    expect(matchState().settings.guests).toBe(true);
  });

  it('refuses a match whose settings do not say whether guests may join', async () => {
    const { guests: _guests, ...old } = settingsOf();
    expect(await getMatch('m1', fakeFetch(success({ ...state, settings: old })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('reads the typical wait of a queue, and that there were no recent games', async () => {
    const typical = { ...queue, typicalWaitSeconds: 95 };
    expect(await getQueue(fakeFetch(success(typical)).fetchFn)).toEqual({ ok: true, data: typical });
    expect(await getQueue(fakeFetch(success(queueState())).fetchFn)).toEqual({ ok: true, data: { ...queueState(), typicalWaitSeconds: null } });
  });

  it('refuses a queue that says nothing of its typical wait', async () => {
    const { typicalWaitSeconds: _wait, ...old } = queueState();
    expect(await getQueue(fakeFetch(success(old)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it.each([
    ["Those places are not on this match's map.", true],
    ['A world game needs places on at least three continents.', true],
    ['This match needs exactly 5 places.', true],
    ['This match needs exactly 12 places.', true],
    ['Only the player picking the places can post them.', false],
    ['Too many requests. Slow down a little.', false],
    [UNREACHABLE, false],
  ])('tells a refusal of the places themselves ("%s") from every other failure', (error, about) => {
    expect(placesRefused(error)).toBe(about);
  });
});

describe('getQueue', () => {
  it('asks where the player is in the queue', async () => {
    const matched = queueState({ matchId: 'm9' });
    const { fetchFn, calls } = fakeFetch(success(matched));
    expect(await getQueue(fetchFn)).toEqual({ ok: true, data: matched });
    expect(calls[0]?.url).toBe('/api/match?queue=1');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it("reads a countdown, with the server's time to measure it against", async () => {
    const gathering = queueState({ queued: true, kind: 'unranked', waiting: 3, startsAt: '2026-10-11T12:00:10.000Z', since: '2026-10-11T11:59:58.000Z', serverNow: '2026-10-11T12:00:03.000Z' });
    expect(await getQueue(fakeFetch(success(gathering)).fetchFn)).toEqual({ ok: true, data: gathering });
  });

  it('reads the ranked queue: when the player joined and how wide the search is now', async () => {
    expect(await getQueue(fakeFetch(success(queue)).fetchFn)).toEqual({ ok: true, data: queue });
  });

  it('reads a lock for leaving ranked matches before they began', async () => {
    const locked = queueState({ lockedUntil: '2026-10-11T12:02:00.000Z' });
    expect(await getQueue(fakeFetch(success(locked)).fetchFn)).toEqual({ ok: true, data: locked });
  });

  it.each([
    ['the countdown field', { ...queue, startsAt: undefined }],
    ["the server's time", { ...queue, serverNow: undefined }],
    ['when the player joined', { ...queue, since: undefined }],
    ['the rating window', { ...queue, window: undefined }],
    ['the lock', { ...queue, lockedUntil: undefined }],
    ['a kind that is a queue', { ...queue, kind: 'party' }],
  ])('refuses a queue state without %s', async (_name, data) => {
    expect(await getQueue(fakeFetch(success(data)).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('refuses a reply that is not a queue state', async () => {
    expect(await getQueue(fakeFetch(success({ queued: 'yes' })).fetchFn)).toEqual({ ok: false, error: UNEXPECTED });
  });

  it('reports a visitor', async () => {
    expect(await getQueue(fakeFetch(failure('Sign in first.', 401)).fetchFn)).toEqual({ ok: false, error: 'Sign in first.' });
  });
});
