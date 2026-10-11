import { describe, expect, it } from 'vitest';
import {
  chatLine,
  chatMode,
  guessStatus,
  healthRows,
  isCancelled,
  isLastRound,
  latest,
  msUntil,
  outcomeLine,
  ownResults,
  placesToLoad,
  roundTable,
  runningForMs,
  secondsLeft,
  shortName,
  stageOf,
  standing,
  teamRoundScores,
  teamTotals,
  toPlaces,
  unreadCount,
} from './state.ts';
import { KIND_SETTINGS, NOW, PLACES, at, chatEntry, guessRow, guest, matchState, noGuess, outcome, player, rankedState, settings, teamRow, teamState } from './testing.ts';

const now = Date.parse(NOW);

const playing = (change = {}) =>
  matchState({ phase: 'playing', places: PLACES, round: 0, roundStartsAt: at(3), roundEndsAt: at(33), ...change });

const teams = teamState({
  phase: 'reveal',
  round: 1,
  places: PLACES,
  players: [player('neel', { team: 0 }), player('ana', { team: 0 }), player('sam', { team: 1 }), player('kit', { team: 1 })],
  results: [
    { round: 0, guesses: [guessRow('neel', 1000), guessRow('ana', 4000), guessRow('sam', 3000), guessRow('kit', 2500)] },
    { round: 1, guesses: [guessRow('neel', 4500), noGuess('ana'), guessRow('sam', 100), guessRow('kit', 4600)] },
  ],
});

describe('msUntil and secondsLeft', () => {
  it('counts down to a server time', () => {
    expect(msUntil(at(30), now)).toBe(30_000);
    expect(msUntil(at(30), now + 29_100)).toBe(900);
  });

  it('is zero once the time has passed, or when there is none', () => {
    expect(msUntil(at(-1), now)).toBe(0);
    expect(msUntil(null, now)).toBe(0);
    expect(msUntil('not a date', now)).toBe(0);
  });

  it('shows a started second as a whole one', () => {
    expect(secondsLeft(30_000)).toBe(30);
    expect(secondsLeft(29_001)).toBe(30);
    expect(secondsLeft(900)).toBe(1);
    expect(secondsLeft(0)).toBe(0);
    expect(secondsLeft(-50)).toBe(0);
  });
});

describe('stageOf', () => {
  it('is the lobby before the host starts', () => {
    expect(stageOf(matchState(), now)).toEqual({ kind: 'lobby' });
  });

  it('asks the resolver, and only the resolver, to find the places', () => {
    const preparing = matchState({ phase: 'preparing' });
    expect(stageOf(preparing, now)).toEqual({ kind: 'preparing', resolve: true });
    expect(stageOf({ ...preparing, you: { ...preparing.you, isResolver: false } }, now)).toEqual({ kind: 'preparing', resolve: false });
  });

  it('does not ask for places that were already posted', () => {
    expect(stageOf(matchState({ phase: 'preparing', places: PLACES }), now)).toEqual({ kind: 'preparing', resolve: false });
  });

  it('waits for the round to start', () => {
    expect(stageOf(playing(), now)).toEqual({ kind: 'starting', round: 0, startsInMs: 3000, msLeft: 30_000 });
  });

  it('lets the player guess while the round runs', () => {
    expect(stageOf(playing(), now + 3000)).toEqual({ kind: 'guessing', round: 0, msLeft: 30_000 });
    expect(stageOf(playing({ round: 2 }), now + 32_500)).toEqual({ kind: 'guessing', round: 2, msLeft: 500 });
  });

  it('waits for the others once the player has guessed', () => {
    const guessed = playing({ players: [player('neel', { guessed: true }), player('sam')] });
    expect(stageOf(guessed, now + 10_000)).toEqual({ kind: 'waiting', round: 0, msLeft: 23_000 });
  });

  it('knows the time is up before the server says so', () => {
    expect(stageOf(playing(), now + 33_000)).toEqual({ kind: 'timeup', round: 0 });
    const guessed = playing({ players: [player('neel', { guessed: true }), player('sam')] });
    expect(stageOf(guessed, now + 40_000)).toEqual({ kind: 'waiting', round: 0, msLeft: 0 });
  });

  it('follows the end of the round when the server moves it earlier', () => {
    // 30 seconds were left; then the last other player guessed and the server cut the round to 20 seconds from then
    const before = playing();
    const cut = playing({ roundEndsAt: at(28), players: [player('neel'), player('sam', { guessed: true })] });
    expect(stageOf(before, now + 8000)).toEqual({ kind: 'guessing', round: 0, msLeft: 25_000 });
    expect(stageOf(cut, now + 8000)).toEqual({ kind: 'guessing', round: 0, msLeft: 20_000 });
    expect(stageOf(cut, now + 28_000)).toEqual({ kind: 'timeup', round: 0 });
  });

  it('counts a ranked duel down from the 15 seconds the server leaves once the opponent has guessed', () => {
    const duel = rankedState({ phase: 'playing', places: PLACES, roundStartsAt: at(5), roundEndsAt: at(65) });
    const cut = { ...duel, roundEndsAt: at(35), players: [player('neel', { health: 5000 }), player('sam', { health: 5000, guessed: true })] };
    expect(stageOf(duel, now + 20_000)).toEqual({ kind: 'guessing', round: 0, msLeft: 45_000 });
    expect(stageOf(cut, now + 20_000)).toEqual({ kind: 'guessing', round: 0, msLeft: 15_000 });
  });

  it('has no time to count down in a round with no timer, and the time is never up', () => {
    const open = playing({ roundStartsAt: at(5), roundEndsAt: null, settings: settings({ timeLimit: 0 }) });
    expect(stageOf(open, now)).toEqual({ kind: 'starting', round: 0, startsInMs: 5000, msLeft: null });
    expect(stageOf(open, now + 5000)).toEqual({ kind: 'guessing', round: 0, msLeft: null });
    expect(stageOf(open, now + 3_600_000)).toEqual({ kind: 'guessing', round: 0, msLeft: null });
    const guessed = { ...open, players: [player('neel', { guessed: true }), player('sam')] };
    expect(stageOf(guessed, now + 60_000)).toEqual({ kind: 'waiting', round: 0, msLeft: null });
  });

  it('gets ready for five seconds, as long as the server says', () => {
    const ready = playing({ roundStartsAt: at(5), roundEndsAt: at(50), settings: KIND_SETTINGS.unranked });
    expect(stageOf(ready, now)).toEqual({ kind: 'starting', round: 0, startsInMs: 5000, msLeft: 45_000 });
    expect(stageOf(ready, now + 4999)).toMatchObject({ kind: 'starting', startsInMs: 1 });
    expect(stageOf(ready, now + 5000)).toEqual({ kind: 'guessing', round: 0, msLeft: 45_000 });
  });

  it('shows the reveal and how long it lasts', () => {
    const reveal = matchState({ phase: 'reveal', round: 1, places: PLACES, revealEndsAt: at(10) });
    expect(stageOf(reveal, now + 4000)).toEqual({ kind: 'reveal', round: 1, msLeft: 6000 });
  });

  it.each([
    ['ten seconds', matchState({ phase: 'reveal', round: 1, places: PLACES, revealEndsAt: at(10) }), 10_000],
    ['eight seconds in a ranked duel', rankedState({ phase: 'reveal', round: 1, places: PLACES, revealEndsAt: at(8) }), 8000],
    ['five seconds after the last round', matchState({ phase: 'reveal', round: 2, places: PLACES, revealEndsAt: at(5) }), 5000],
  ])('shows a reveal for the %s the server gives it', (_name, reveal, msLeft) => {
    expect(stageOf(reveal, now)).toEqual({ kind: 'reveal', round: reveal.round, msLeft });
  });

  it('tells a finished match from a cancelled one', () => {
    expect(stageOf(matchState({ phase: 'finished', places: PLACES, outcome: outcome([]) }), now)).toEqual({ kind: 'finished', cancelled: false });
    expect(stageOf(matchState({ phase: 'finished', outcome: outcome([]) }), now)).toEqual({ kind: 'finished', cancelled: true });
    expect(isCancelled(matchState({ phase: 'reveal' }))).toBe(false);
  });

  it('counts a ranked duel as cancelled when a player left before the first guess, places or not', () => {
    const dodged = rankedState({ phase: 'finished', places: PLACES, outcome: outcome([], { dodgedBy: 'sam' }) });
    expect(isCancelled(dodged)).toBe(true);
    expect(stageOf(dodged, now)).toEqual({ kind: 'finished', cancelled: true });
    expect(isCancelled(rankedState({ phase: 'finished', places: PLACES, outcome: outcome(['neel']) }))).toBe(false);
  });
});

describe('runningForMs', () => {
  it("is how long ago the round started on the server's clock", () => {
    expect(runningForMs(playing(), now + 3000)).toBe(0);
    expect(runningForMs(playing(), now + 10_000)).toBe(7000);
  });

  it('does not change when the end of the round is moved earlier', () => {
    expect(runningForMs(playing({ roundEndsAt: at(12) }), now + 10_000)).toBe(7000);
    expect(runningForMs(playing({ roundEndsAt: null }), now + 10_000)).toBe(7000);
  });

  it('is zero before the start and outside a round', () => {
    expect(runningForMs(playing(), now)).toBe(0);
    expect(runningForMs(matchState(), now)).toBe(0);
    expect(runningForMs(playing({ phase: 'reveal' }), now + 10_000)).toBe(0);
  });
});

describe('latest', () => {
  it('takes the first state and any state of another match', () => {
    const next = playing();
    expect(latest(null, next)).toBe(next);
    expect(latest(matchState({ id: 'old', phase: 'finished' }), next)).toBe(next);
  });

  it('moves forward through the phases and rounds', () => {
    const steps = [
      matchState(),
      matchState({ phase: 'preparing' }),
      playing(),
      playing({ phase: 'reveal' }),
      playing({ round: 1 }),
      playing({ round: 1, phase: 'reveal' }),
      playing({ round: 2, phase: 'finished' }),
    ];
    steps.slice(1).forEach((next, index) => expect(latest(steps[index]!, next)).toBe(next));
  });

  it('ignores a reply that is older than what is already shown', () => {
    const reveal = playing({ phase: 'reveal' });
    expect(latest(reveal, playing())).toBe(reveal);
    const second = playing({ round: 1 });
    expect(latest(second, reveal)).toBe(second);
    const done = playing({ phase: 'finished' });
    expect(latest(done, playing({ round: 2 }))).toBe(done);
  });

  it('takes a newer reply of the same phase, such as a lobby someone joined', () => {
    const joined = matchState({ players: [player('neel'), player('sam'), player('ana')] });
    expect(latest(matchState(), joined)).toBe(joined);
  });

  it('never takes back a guess within a round', () => {
    const sent = playing({ players: [player('neel', { guessed: true }), player('sam')] });
    const stale = playing({ players: [player('neel'), player('sam', { guessed: true })] });
    expect(latest(sent, stale).players.map((p) => p.guessed)).toEqual([true, true]);
  });

  it('takes an earlier end of the round from a newer reply', () => {
    const cut = playing({ roundEndsAt: at(23), players: [player('neel'), player('sam', { guessed: true })] });
    expect(latest(playing(), cut)).toBe(cut);
    expect(stageOf(latest(playing(), cut), now + 3000)).toEqual({ kind: 'guessing', round: 0, msLeft: 20_000 });
  });

  it('never moves the end of a round later again when an older reply arrives late', () => {
    const cut = playing({ roundEndsAt: at(23), players: [player('neel'), player('sam', { guessed: true })] });
    const stale = playing();
    const shown = latest(cut, stale);
    expect(shown.roundEndsAt).toBe(at(23));
    expect(shown.players.map((p) => p.guessed)).toEqual([false, true]);
    expect(stageOf(shown, now + 3000)).toEqual({ kind: 'guessing', round: 0, msLeft: 20_000 });
  });

  it('gives each round its own end', () => {
    const cut = playing({ roundEndsAt: at(23) });
    const second = playing({ round: 1, roundStartsAt: at(40), roundEndsAt: at(70) });
    expect(latest(cut, second)).toBe(second);
  });

  it('keeps a round with no timer without one', () => {
    const open = playing({ roundEndsAt: null });
    const same = playing({ roundEndsAt: null, players: [player('neel'), player('sam', { guessed: true })] });
    expect(latest(open, same)).toBe(same);
  });

  it('follows a finished party back to its lobby when its host sends it there', () => {
    const done = playing({ phase: 'finished', round: 2, outcome: outcome(['sam']), serverNow: at(100) });
    const lobby = matchState({ serverNow: at(103) });
    expect(latest(done, lobby)).toBe(lobby);
    // and on into the next game from there
    const preparing = matchState({ phase: 'preparing', serverNow: at(110) });
    expect(latest(lobby, preparing)).toBe(preparing);
  });

  it('does not go back to the end when the last reply about it arrives after the lobby', () => {
    const done = playing({ phase: 'finished', round: 2, outcome: outcome(['sam']), serverNow: at(100) });
    const lobby = matchState({ serverNow: at(103) });
    expect(latest(lobby, done)).toBe(lobby);
  });

  it('ends a lobby that closes, as when its two players are queued for 2v2', () => {
    const lobby = matchState({ serverNow: at(10) });
    const closed = matchState({ phase: 'finished', outcome: outcome([]), movedToQueue: 'team', serverNow: at(12) });
    expect(latest(lobby, closed)).toBe(closed);
  });

  it('starts the next round with no guesses', () => {
    const sent = playing({ players: [player('neel', { guessed: true }), player('sam', { guessed: true })] });
    expect(latest(sent, playing({ round: 1 })).players.map((p) => p.guessed)).toEqual([false, false]);
  });
});

describe('shortName', () => {
  it('is the first three characters in capitals', () => {
    expect(shortName('neel')).toBe('NEE');
    expect(shortName('al')).toBe('AL');
    expect(shortName('under_score')).toBe('UND');
  });
});

describe('guessStatus', () => {
  it('says who has guessed, who has not, and who is away', () => {
    const state = playing({
      players: [player('neel', { guessed: true }), player('sam'), player('ana', { active: false }), player('kit', { guessed: true, active: false })],
    });
    expect(guessStatus(state)).toEqual([
      { username: 'neel', isYou: true, status: 'guessed' },
      { username: 'sam', isYou: false, status: 'guessing' },
      { username: 'ana', isYou: false, status: 'away' },
      { username: 'kit', isYou: false, status: 'guessed' },
    ]);
  });
});

describe('roundTable', () => {
  const state = matchState({
    phase: 'reveal',
    round: 1,
    places: PLACES,
    players: [player('neel'), player('sam'), player('ana')],
    results: [
      { round: 0, guesses: [guessRow('neel', 3000), guessRow('sam', 4000)] },
      { round: 1, guesses: [guessRow('neel', 4200, { lng: 1, lat: 2, distanceKm: 80 }), noGuess('sam')] },
    ],
  });

  it('lists every player for the round, best score first, with running totals', () => {
    expect(roundTable(state, 1)).toEqual([
      { username: 'neel', isYou: true, team: null, guess: { lng: 1, lat: 2 }, distanceKm: 80, score: 4200, total: 7200 },
      { username: 'sam', isYou: false, team: null, guess: null, distanceKm: null, score: 0, total: 4000 },
      { username: 'ana', isYou: false, team: null, guess: null, distanceKm: null, score: 0, total: 0 },
    ]);
  });

  it('leaves later rounds out of the running total', () => {
    expect(roundTable(state, 0).map((row) => [row.username, row.total])).toEqual([
      ['sam', 4000],
      ['neel', 3000],
      ['ana', 0],
    ]);
  });

  it('is all zeroes for a round with no results', () => {
    expect(roundTable(matchState(), 0).map((row) => row.score)).toEqual([0, 0]);
  });
});

describe('teams', () => {
  it("scores a team's round as its best member's", () => {
    expect(teamRoundScores(teams, 0)).toEqual([4000, 3000]);
    expect(teamRoundScores(teams, 1)).toEqual([4500, 4600]);
  });

  it('adds the rounds up', () => {
    expect(teamTotals(teams)).toEqual([8500, 7600]);
    expect(teamTotals(teams, 0)).toEqual([4000, 3000]);
  });

  it('is zero for a team with no results', () => {
    expect(teamTotals({ ...teams, results: [] })).toEqual([0, 0]);
    expect(teamRoundScores(teams, 7)).toEqual([0, 0]);
  });

  it("scores a party's teams by the rounded mean of their members when the host chose the average", () => {
    const average = { ...teams, kind: 'party' as const, settings: settings({ teams: 'average' }) };
    // 1000 and 4000; 3000 and 2500
    expect(teamRoundScores(average, 0)).toEqual([2500, 2750]);
    // 4500 and no guess, which counts 0; 100 and 4600
    expect(teamRoundScores(average, 1)).toEqual([2250, 2350]);
    expect(teamTotals(average)).toEqual([4750, 5100]);
  });

  it('counts a member with no row in the results as 0 in an average', () => {
    const late = { ...teams, kind: 'party' as const, settings: settings({ teams: 'average' }), players: [...teams.players, player('lee', { team: 0 })] };
    // 1000, 4000 and a player who joined later: 5000 over three
    expect(teamRoundScores(late, 0)).toEqual([1667, 2750]);
  });
});

describe('isLastRound', () => {
  it('is the last round by count', () => {
    const party = matchState({ phase: 'reveal', places: PLACES });
    expect(isLastRound(party, 1)).toBe(false);
    expect(isLastRound(party, 2)).toBe(true);
  });

  it('is the round that leaves a player of a ranked duel with no health', () => {
    const duel = rankedState({ phase: 'reveal', places: PLACES });
    expect(isLastRound(duel, 1)).toBe(false);
    expect(isLastRound({ ...duel, players: [player('neel', { health: 0 }), player('sam', { health: 2100 })] }, 1)).toBe(true);
    expect(isLastRound(duel, 4)).toBe(true);
  });

  it('is the round that leaves a team of a 2v2 with no health', () => {
    expect(isLastRound(teams, 1)).toBe(false);
    expect(isLastRound({ ...teams, teams: [teamRow(0, { health: 0 }), teamRow(1, { health: 1200 })] }, 1)).toBe(true);
  });
});

describe('standing', () => {
  it('ranks players by their totals from the results and marks the winners', () => {
    const state = matchState({
      phase: 'finished',
      places: PLACES,
      results: [
        { round: 0, guesses: [guessRow('neel', 3000), guessRow('sam', 4000)] },
        { round: 1, guesses: [guessRow('neel', 500), noGuess('sam')] },
      ],
      outcome: outcome(['sam']),
    });
    expect(standing(state)).toEqual([
      { username: 'sam', isYou: false, team: null, total: 4000, won: true, active: true, rating: null, health: null },
      { username: 'neel', isYou: true, team: null, total: 3500, won: false, active: true, rating: null, health: null },
    ]);
  });

  it('carries the rating changes of a ranked duel', () => {
    const state = matchState({
      kind: 'ranked',
      phase: 'finished',
      places: PLACES,
      results: [{ round: 0, guesses: [guessRow('neel', 3000), guessRow('sam', 100)] }],
      outcome: outcome(['neel'], {
        ratingChanges: [
          { username: 'neel', before: 1000, after: 1016 },
          { username: 'sam', before: 1000, after: 984 },
        ],
      }),
    });
    expect(standing(state).map((row) => [row.username, row.rating])).toEqual([
      ['neel', { before: 1000, after: 1016 }],
      ['sam', { before: 1000, after: 984 }],
    ]);
  });

  it('shows a player who left as away', () => {
    const state = matchState({ phase: 'finished', places: PLACES, players: [player('neel'), player('sam', { active: false })] });
    expect(standing(state).find((row) => row.username === 'sam')?.active).toBe(false);
  });
});

describe('outcomeLine', () => {
  const finished = (winners: string[], change = {}) =>
    matchState({ phase: 'finished', places: PLACES, outcome: outcome(winners), ...change });

  it('says nothing while the match is running', () => {
    expect(outcomeLine(playing())).toBe('');
  });

  it('names the winner', () => {
    expect(outcomeLine(finished(['neel']))).toBe('You won.');
    expect(outcomeLine(finished(['sam']))).toBe('sam won.');
    expect(outcomeLine(finished(['sam', 'ana']))).toBe('sam and ana won.');
  });

  it('calls a draw a draw and a cancelled match cancelled', () => {
    expect(outcomeLine(finished([]))).toBe('A draw.');
    expect(outcomeLine(finished([], { places: null }))).toBe('The match was cancelled before it began.');
  });

  it('speaks of teams in a team match', () => {
    expect(outcomeLine({ ...teams, phase: 'finished', outcome: outcome(['neel', 'ana']) })).toBe('Your team won.');
    expect(outcomeLine({ ...teams, phase: 'finished', outcome: outcome(['sam', 'kit']) })).toBe('The other team won.');
  });

  it('speaks of teams in a party played in teams', () => {
    const party = { ...teams, kind: 'party' as const, settings: settings({ teams: 'average' }), teams: [teamRow(0, { health: null }), teamRow(1, { health: null })], phase: 'finished' as const };
    expect(outcomeLine({ ...party, outcome: outcome(['neel', 'ana']) })).toBe('Your team won.');
    expect(outcomeLine({ ...party, outcome: outcome(['sam', 'kit']) })).toBe('The other team won.');
  });

  it('calls a ranked duel that a player left before the first guess cancelled', () => {
    const dodged = rankedState({ phase: 'finished', places: PLACES, outcome: outcome([], { dodgedBy: 'sam' }) });
    expect(outcomeLine(dodged)).toBe('The match was cancelled before it began.');
  });
});

describe('ownResults', () => {
  it("pairs each finished round's place with the player's own guess", () => {
    const state = matchState({
      phase: 'finished',
      places: PLACES,
      results: [
        { round: 0, guesses: [guessRow('neel', 3000, { lng: 1, lat: 2, distanceKm: 80 }), guessRow('sam', 4000)] },
        { round: 1, guesses: [noGuess('neel'), guessRow('sam', 4000)] },
      ],
    });
    expect(ownResults(state)).toEqual([
      { location: PLACES[0], guess: { lng: 1, lat: 2 }, distanceKm: 80, score: 3000, hinted: false },
      { location: PLACES[1], guess: null, distanceKm: null, score: 0, hinted: false },
    ]);
  });

  it('is empty when no places were posted', () => {
    expect(ownResults(matchState({ phase: 'finished' }))).toEqual([]);
  });

  it('needs only the places of the rounds that were revealed, which is all the server sends from wave 6 on', () => {
    const results = [{ round: 0, guesses: [guessRow('neel', 3000, { lng: 1, lat: 2, distanceKm: 80 })] }];
    const state = matchState({ phase: 'reveal', round: 0, settings: settings({ rounds: 3 }), places: PLACES.slice(0, 1), results });
    expect(ownResults(state)).toEqual([{ location: PLACES[0], guess: { lng: 1, lat: 2 }, distanceKm: 80, score: 3000, hinted: false }]);
  });
});

describe('placesToLoad', () => {
  it('is every posted place at first, however many of the rounds the server has sent', () => {
    expect(placesToLoad(PLACES, 0, 0)).toEqual(PLACES);
    expect(placesToLoad(PLACES.slice(0, 1), 0, 0)).toEqual([PLACES[0]]);
  });

  it('is nothing while the round to show already has its picture', () => {
    expect(placesToLoad(PLACES, PLACES.length, 1)).toEqual([]);
    expect(placesToLoad(PLACES.slice(0, 2), 2, 1)).toEqual([]);
    // the next round's place has arrived early: it waits until that round is the one to show
    expect(placesToLoad(PLACES.slice(0, 2), 1, 0)).toEqual([]);
  });

  it('is the places sent since, once a round comes whose place was not there before', () => {
    expect(placesToLoad(PLACES.slice(0, 2), 1, 1)).toEqual([PLACES[1]]);
    expect(placesToLoad(PLACES, 1, 2)).toEqual(PLACES.slice(1));
  });

  it('is nothing when the server has sent no more, or no places at all', () => {
    expect(placesToLoad(PLACES.slice(0, 1), 1, 1)).toEqual([]);
    expect(placesToLoad(null, 0, 0)).toEqual([]);
  });
});

describe('what the resolver posts', () => {
  it('is each place where its list has it, not where its picture turned out to be', () => {
    const rounds = [
      { location: PLACES[0]!, pano: { lng: 2.4, lat: 48.9, credit: 'someone' } },
      { location: PLACES[1]!, pano: { lng: 139.7, lat: 35.7, credit: 'someone else' } },
    ];
    expect(toPlaces(rounds)).toEqual([PLACES[0], PLACES[1]]);
  });

  it('sends nothing but the id, the coordinates and the country of a place', () => {
    const location = { ...PLACES[2]!, extra: 'not sent' };
    expect(toPlaces([{ location, pano: { lng: 0, lat: 0 } }])).toEqual([{ id: 'place-three', lng: -58.3816, lat: -34.6037, country: 'AR' }]);
  });
});

describe('a ranked duel is played on health', () => {
  const duel = rankedState({
    phase: 'reveal',
    round: 1,
    places: PLACES,
    players: [player('neel', { rating: 1016, health: 3800 }), player('sam', { rating: 1000, health: 4100 })],
    results: [
      { round: 0, guesses: [guessRow('neel', 4000), guessRow('sam', 3100)] },
      { round: 1, guesses: [guessRow('neel', 1200), guessRow('sam', 2400)] },
    ],
  });

  it('shows each player\'s health and what the round cost them', () => {
    expect(healthRows(duel, 1)).toEqual([
      { username: 'neel', isYou: true, health: 3800, lost: 1200, share: 0.76 },
      { username: 'sam', isYou: false, health: 4100, lost: 0, share: 0.82 },
    ]);
    expect(healthRows(duel, 0).map((row) => row.lost)).toEqual([0, 900]);
  });

  it('costs nobody anything in a level round, or before any round is revealed', () => {
    const level = { ...duel, results: [{ round: 0, guesses: [guessRow('neel', 2000), guessRow('sam', 2000)] }] };
    expect(healthRows(level, 0).map((row) => row.lost)).toEqual([0, 0]);
    expect(healthRows(duel, null).map((row) => row.lost)).toEqual([0, 0]);
  });

  it('has no health rows outside ranked', () => {
    expect(healthRows(matchState(), 0)).toEqual([]);
    expect(healthRows(teams, 0)).toEqual([]);
  });

  it('is at most five rounds, moving, of sixty seconds', () => {
    expect(duel.settings).toMatchObject({ map: 'world', mode: 'move', timeLimit: 60, rounds: 5 });
    expect(isLastRound(duel, 3)).toBe(false);
    expect(isLastRound(duel, 4)).toBe(true);
  });

  it('never shows a bar below empty or above full', () => {
    const odd = { ...duel, players: [player('neel', { health: -50 }), player('sam', { health: 9000 })] };
    expect(healthRows(odd, null).map((row) => row.share)).toEqual([0, 1]);
  });

  it('ranks the final standing by health', () => {
    const done = { ...duel, phase: 'finished' as const, outcome: outcome(['sam']) };
    expect(standing(done).map((row) => [row.username, row.health])).toEqual([
      ['sam', 4100],
      ['neel', 3800],
    ]);
  });
});

describe('chat', () => {
  const chat = [
    chatEntry(1, 'sam', 'good luck'),
    chatEntry(2, 'neel', null, { emote: 'gg' }),
    chatEntry(3, 'sam', null, { emote: 'wow' }),
    chatEntry(4, 'sam', 'close one', { scope: 'team' }),
  ];

  it('counts what others said since the player last looked', () => {
    expect(unreadCount(chat, 0, 'neel')).toBe(3);
    expect(unreadCount(chat, 1, 'neel')).toBe(2);
    expect(unreadCount(chat, 4, 'neel')).toBe(0);
    expect(unreadCount([], 0, 'neel')).toBe(0);
  });

  it('writes a message as said and a reaction as its word', () => {
    expect(chatLine(chat[0]!)).toBe('good luck');
    expect(chatLine(chat[1]!)).toBe('gg');
    expect(chatLine(chatEntry(9, 'sam', null))).toBe('');
  });
});

describe('chatMode', () => {
  it('is what the host chose in a party', () => {
    expect(chatMode(matchState())).toBe('chat');
    expect(chatMode(matchState({ settings: settings({ communication: 'reactions' }) }))).toBe('reactions');
    expect(chatMode(matchState({ settings: settings({ communication: 'off' }) }))).toBe('off');
  });

  it('is the reactions alone in a ranked duel and in a public game', () => {
    expect(chatMode(rankedState())).toBe('reactions');
    expect(chatMode(matchState({ kind: 'unranked', code: null, settings: KIND_SETTINGS.unranked }))).toBe('reactions');
  });

  it('does not go by the settings outside a party: a ranked duel never has free chat', () => {
    expect(chatMode(rankedState({ settings: settings({ communication: 'chat' }) }))).toBe('reactions');
  });

  it('is free chat in 2v2', () => {
    expect(chatMode(teamState())).toBe('chat');
  });

  it('leaves a guest the reactions where others may chat, and nothing where chat is off', () => {
    const asGuest = { username: 'Guest #4821', isHost: false, isResolver: false, team: null, guest: true, muted: [] };
    const party = matchState({ you: asGuest, players: [player('neel'), guest(4821)] });
    expect(chatMode(party)).toBe('reactions');
    expect(chatMode({ ...party, settings: settings({ communication: 'off' }) })).toBe('off');
  });
});
