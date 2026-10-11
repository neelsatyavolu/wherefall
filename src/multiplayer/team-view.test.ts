import { describe, expect, it } from 'vitest';
import { teamHealthRows, teamRows } from './team-view.ts';
import { PLACES, guessRow, matchState, noGuess, outcome, player, rankedState, settings, teamRow, teamState, viewer } from './testing.ts';

/** A party with teams seen by "neel" on team 1: "sam" with them, "ana" and "kit" on team 2. */
const teamParty = (mode: 'best' | 'average', change = {}) =>
  matchState({
    settings: settings({ teams: mode }),
    phase: 'reveal',
    places: PLACES,
    you: viewer({ team: 0 }),
    players: [player('neel', { team: 0 }), player('sam', { team: 0 }), player('ana', { team: 1 }), player('kit', { team: 1 })],
    teams: [teamRow(0, { health: null, total: 4000 }), teamRow(1, { health: null, total: 3000 })],
    results: [{ round: 0, guesses: [guessRow('neel', 4000), guessRow('sam', 1000), guessRow('ana', 3000), noGuess('kit')] }],
    ...change,
  });

describe('teamRows', () => {
  it('is empty in a match without teams', () => {
    expect(teamRows(matchState(), null)).toEqual([]);
    expect(teamRows(rankedState(), 0)).toEqual([]);
  });

  it('scores a round by each team’s best guess', () => {
    expect(teamRows(teamParty('best'), 0)).toEqual([
      { team: 0, isYours: true, round: 4000, total: 4000, won: false },
      { team: 1, isYours: false, round: 3000, total: 3000, won: false },
    ]);
  });

  it('scores a round by each team’s average, a missing guess counting nothing', () => {
    const state = teamParty('average', { teams: [teamRow(0, { health: null, total: 2500 }), teamRow(1, { health: null, total: 1500 })] });
    expect(teamRows(state, 0).map((row) => row.round)).toEqual([2500, 1500]);
  });

  it('takes the totals from the server, not from the rounds it can see', () => {
    // a player who was kicked is in no results, but what the team made with them stands
    const state = teamParty('best', { teams: [teamRow(0, { health: null, total: 9000 }), teamRow(1, { health: null, total: 3000 })] });
    expect(teamRows(state, 0).map((row) => row.total)).toEqual([9000, 3000]);
  });

  it('has no round score when no round is asked for, or one not yet revealed', () => {
    expect(teamRows(teamParty('best'), null).map((row) => row.round)).toEqual([null, null]);
    expect(teamRows(teamParty('best'), 1).map((row) => row.round)).toEqual([null, null]);
  });

  it('marks the team whose members won', () => {
    const state = teamParty('best', { phase: 'finished', outcome: outcome(['ana', 'kit']) });
    expect(teamRows(state, null).map((row) => row.won)).toEqual([false, true]);
    expect(teamRows(teamParty('best', { phase: 'finished', outcome: outcome([]) }), null).map((row) => row.won)).toEqual([false, false]);
  });

  it('marks nobody’s team as the viewer’s before they have one', () => {
    expect(teamRows(teamParty('best', { you: viewer() }), null).map((row) => row.isYours)).toEqual([false, false]);
  });
});

describe('teamHealthRows', () => {
  const round = [{ round: 0, guesses: [guessRow('neel', 1200), guessRow('sam', 2000), guessRow('ana', 3000), guessRow('kit', 500)] }];

  it('is empty outside 2v2: a party’s teams have no health', () => {
    expect(teamHealthRows(teamParty('best'), 0)).toEqual([]);
    expect(teamHealthRows(matchState(), null)).toEqual([]);
  });

  it('starts both teams full', () => {
    expect(teamHealthRows(teamState(), null)).toEqual([
      { team: 0, isYours: true, health: 5000, lost: 0, share: 1 },
      { team: 1, isYours: false, health: 5000, lost: 0, share: 1 },
    ]);
  });

  it('takes the gap between the best guesses, times 1.3, off the lower team', () => {
    // 3,000 against 2,000: 1,000 x 1.3
    const state = teamState({ phase: 'reveal', places: PLACES, results: round, teams: [teamRow(0, { health: 3700 }), teamRow(1)] });
    expect(teamHealthRows(state, 0)).toEqual([
      { team: 0, isYours: true, health: 3700, lost: 1300, share: 0.74 },
      { team: 1, isYours: false, health: 5000, lost: 0, share: 1 },
    ]);
  });

  it('shows no damage between reveals', () => {
    const state = teamState({ phase: 'playing', round: 1, places: PLACES, results: round, teams: [teamRow(0, { health: 3700 }), teamRow(1)] });
    expect(teamHealthRows(state, null).map((row) => row.lost)).toEqual([0, 0]);
  });

  it('shows what a round took, not the whole gap, when the team had less than that left', () => {
    // round 1 cost 1,300; in round 2 a gap of 5,000 would cost 6,500, but 3,700 was all there was
    const results = [...round, { round: 1, guesses: [noGuess('neel'), noGuess('sam'), guessRow('ana', 5000), guessRow('kit', 500)] }];
    const state = teamState({ phase: 'reveal', round: 1, places: PLACES, results, teams: [teamRow(0, { health: 0 }), teamRow(1)] });
    expect(teamHealthRows(state, 1)[0]).toEqual({ team: 0, isYours: true, health: 0, lost: 3700, share: 0 });
    // and the round before still shows what it cost then
    expect(teamHealthRows({ ...state, teams: [teamRow(0, { health: 3700 }), teamRow(1)] }, 0)[0]!.lost).toBe(1300);
  });

  it('shows the damage of the other team too, when it is the one that lost the round', () => {
    const results = [{ round: 0, guesses: [guessRow('neel', 4000), guessRow('ana', 3000)] }];
    const state = teamState({ phase: 'reveal', places: PLACES, results, teams: [teamRow(0), teamRow(1, { health: 3700 })] });
    expect(teamHealthRows(state, 0).map((row) => row.lost)).toEqual([0, 1300]);
  });

  it('takes nothing off either team when they tie', () => {
    const results = [{ round: 0, guesses: [guessRow('neel', 3000), guessRow('ana', 3000)] }];
    const state = teamState({ phase: 'reveal', places: PLACES, results });
    expect(teamHealthRows(state, 0).map((row) => row.lost)).toEqual([0, 0]);
  });
});
