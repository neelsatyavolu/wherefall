import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTY, clampRounds, clampTime, partyJoinRound, partyOffers, partySettings, playerOffers, seating } from './party-view.ts';
import { NOW, PLACES, at, guessRow, guest, matchState, noGuess, player, rankedState, settings, teamRow, viewer } from './testing.ts';

const now = Date.parse(NOW);
const MEMBER = viewer();

describe('clampRounds', () => {
  it('keeps a whole number of rounds from 1 to 20', () => {
    expect([1, 5, 20].map(clampRounds)).toEqual([1, 5, 20]);
  });

  it('brings anything else to the nearest count the server takes', () => {
    expect(clampRounds(0)).toBe(1);
    expect(clampRounds(-3)).toBe(1);
    expect(clampRounds(21)).toBe(20);
    expect(clampRounds(4.6)).toBe(5);
    expect(clampRounds(Number.NaN)).toBe(1);
  });
});

describe('clampTime', () => {
  it('keeps no timer, and every ten seconds from 10 to 300', () => {
    expect([0, 10, 60, 290, 300].map(clampTime)).toEqual([0, 10, 60, 290, 300]);
  });

  it('brings anything else to the nearest time the server takes', () => {
    expect(clampTime(4)).toBe(0);
    expect(clampTime(5)).toBe(10);
    expect(clampTime(44)).toBe(40);
    expect(clampTime(45)).toBe(50);
    expect(clampTime(900)).toBe(300);
    expect(clampTime(-20)).toBe(0);
    expect(clampTime(Number.NaN)).toBe(0);
  });
});

describe('partySettings', () => {
  it('fills in chat, no teams and guests allowed where they were left out', () => {
    expect(partySettings({ map: 'world', mode: 'nmpz', timeLimit: 0, rounds: 1 })).toEqual({ map: 'world', mode: 'nmpz', timeLimit: 0, rounds: 1, communication: 'chat', teams: 'none', guests: true });
  });

  it('keeps a party closed to guests closed', () => {
    expect(partySettings(settings({ guests: false })).guests).toBe(false);
    expect(DEFAULT_PARTY.guests).toBe(true);
  });

  it('keeps what was chosen and holds the numbers to their limits', () => {
    expect(partySettings(settings({ timeLimit: 301, rounds: 40, communication: 'off', teams: 'average' }))).toEqual(settings({ timeLimit: 300, rounds: 20, communication: 'off', teams: 'average' }));
  });

  it('starts from settings the server takes', () => {
    expect(partySettings(DEFAULT_PARTY)).toEqual(DEFAULT_PARTY);
  });
});

describe('playerOffers', () => {
  const party = matchState({ players: [player('neel'), player('sam'), guest(4821)] });

  it('offers the host a kick and a hand-over on another account', () => {
    expect(playerOffers(party, player('sam'))).toEqual({ kick: true, makeHost: true, makePicker: false });
  });

  it('never offers a hand-over to a guest, who cannot host', () => {
    expect(playerOffers(party, guest(4821))).toEqual({ kick: true, makeHost: false, makePicker: false });
  });

  it('offers nothing on the host themselves', () => {
    expect(playerOffers(party, player('neel'))).toEqual({ kick: false, makeHost: false, makePicker: false });
  });

  it('offers nothing to anyone who is not the host', () => {
    expect(playerOffers(matchState({ you: MEMBER }), player('sam'))).toEqual({ kick: false, makeHost: false, makePicker: false });
  });

  it('offers a kick in every phase, and a hand-over in all but the one where places are found', () => {
    const offered = (['lobby', 'preparing', 'playing', 'reveal', 'finished'] as const).map((phase) => playerOffers(matchState({ phase }), player('sam')));
    expect(offered.map((offer) => offer.kick)).toEqual([true, true, true, true, true]);
    expect(offered.map((offer) => offer.makeHost)).toEqual([true, false, true, true, true]);
  });

  describe('in co-op', () => {
    const coop = matchState({ settings: settings({ teams: 'coop' }), picker: 'neel', players: [player('neel'), player('sam')] });

    it('offers the host the pick for a player who does not have it', () => {
      expect(playerOffers(coop, player('sam'))).toEqual({ kick: true, makeHost: true, makePicker: true });
      expect(playerOffers({ ...coop, picker: 'sam' }, player('sam')).makePicker).toBe(false);
    });

    it('offers the host the pick back for themselves, and nothing else', () => {
      expect(playerOffers(coop, player('neel'))).toEqual({ kick: false, makeHost: false, makePicker: false });
      expect(playerOffers({ ...coop, picker: 'sam' }, player('neel'))).toEqual({ kick: false, makeHost: false, makePicker: true });
    });

    it('offers the pick to nobody but the host', () => {
      expect(playerOffers({ ...coop, you: MEMBER }, player('sam')).makePicker).toBe(false);
    });

    it('offers the pick until the match is over', () => {
      const offered = (['lobby', 'preparing', 'playing', 'reveal', 'finished'] as const).map((phase) => playerOffers({ ...coop, phase }, player('sam')).makePicker);
      expect(offered).toEqual([true, true, true, true, false]);
    });
  });

  it('offers nothing outside a party, where nobody is the host', () => {
    expect(playerOffers(rankedState({ you: viewer({ isHost: true }) }), player('sam'))).toEqual({ kick: false, makeHost: false, makePicker: false });
  });
});

describe('partyOffers', () => {
  const nothing = { configure: false, lock: false, shuffle: false, endRound: false, pair: false };

  it('offers the host of a lobby its settings, the lock, and the pair queue with exactly two accounts', () => {
    expect(partyOffers(matchState(), now)).toEqual({ ...nothing, configure: true, lock: true, pair: true });
  });

  it('offers the shuffle only with teams on', () => {
    expect(partyOffers(matchState({ settings: settings({ teams: 'best' }) }), now).shuffle).toBe(true);
    expect(partyOffers(matchState(), now).shuffle).toBe(false);
  });

  it('offers no shuffle in co-op, which has no teams to deal', () => {
    expect(partyOffers(matchState({ settings: settings({ teams: 'coop' }) }), now).shuffle).toBe(false);
  });

  it('offers the pair queue to two accounts only: not alone, not three, not with a guest', () => {
    expect(partyOffers(matchState({ players: [player('neel')] }), now).pair).toBe(false);
    expect(partyOffers(matchState({ players: [player('neel'), player('sam'), player('ana')] }), now).pair).toBe(false);
    expect(partyOffers(matchState({ players: [player('neel'), guest(4821)] }), now).pair).toBe(false);
  });

  it('offers to end a round once it has started, with a timer or without', () => {
    const playing = (change = {}) => matchState({ phase: 'playing', places: PLACES, roundStartsAt: at(-1), roundEndsAt: at(29), ...change });
    expect(partyOffers(playing(), now)).toEqual({ ...nothing, lock: true, endRound: true });
    expect(partyOffers(playing({ roundEndsAt: null }), now).endRound).toBe(true);
    // the get-ready is still running
    expect(partyOffers(playing({ roundStartsAt: at(3) }), now).endRound).toBe(false);
    expect(partyOffers(matchState({ phase: 'reveal', places: PLACES, roundStartsAt: at(-30) }), now).endRound).toBe(false);
  });

  it('offers nothing but the lock outside the lobby and a round, and nothing once the party is over', () => {
    expect(partyOffers(matchState({ phase: 'preparing' }), now)).toEqual({ ...nothing, lock: true });
    expect(partyOffers(matchState({ phase: 'finished', places: PLACES }), now)).toEqual(nothing);
  });

  it('offers nothing to a player who is not the host, and nothing outside a party', () => {
    expect(partyOffers(matchState({ you: MEMBER }), now)).toEqual(nothing);
    expect(partyOffers(rankedState({ you: viewer({ isHost: true }) }), now)).toEqual(nothing);
  });
});

describe('seating', () => {
  it('is nothing in a match without teams', () => {
    expect(seating(matchState())).toBeNull();
  });

  it('lists each team in the order of the players, and who has none', () => {
    const state = matchState({
      settings: settings({ teams: 'best' }),
      teams: [teamRow(0, { health: null }), teamRow(1, { health: null })],
      players: [player('neel', { team: 1 }), player('sam'), player('ana', { team: 0 }), player('kit', { team: 1 })],
    });
    const seats = seating(state)!;
    expect(seats.teams.map((team) => team.map((member) => member.username))).toEqual([['ana'], ['neel', 'kit']]);
    expect(seats.unseated.map((member) => member.username)).toEqual(['sam']);
  });
});

describe('partyJoinRound', () => {
  const under = (change = {}) => matchState({ you: MEMBER, phase: 'playing', round: 1, places: PLACES, roundStartsAt: at(-5), roundEndsAt: at(25), ...change });

  it('is the round after the one being played', () => {
    expect(partyJoinRound(under(), now)).toBe(2);
    expect(partyJoinRound(under({ roundEndsAt: null }), now)).toBe(2);
  });

  it('is the round after the one being revealed', () => {
    expect(partyJoinRound(under({ phase: 'reveal', revealEndsAt: at(6) }), now)).toBe(2);
  });

  it('is nothing while a round is still getting ready: the player is in time for it', () => {
    expect(partyJoinRound(under({ roundStartsAt: at(3) }), now)).toBeNull();
  });

  it('is nothing for a player who has guessed in this match before: they are coming back to it', () => {
    const earlier = [{ round: 0, guesses: [guessRow('neel', 3000), guessRow('sam', 2000)] }];
    expect(partyJoinRound(under({ results: earlier }), now)).toBeNull();
    expect(partyJoinRound(under({ players: [player('sam'), player('neel', { guessed: true })] }), now)).toBeNull();
    // a row with no guess in it is what a round they were not there for looks like
    expect(partyJoinRound(under({ results: [{ round: 0, guesses: [noGuess('neel'), guessRow('sam', 2000)] }] }), now)).toBe(2);
  });

  it('is nothing before the first round, in a lobby, at the end, and outside a party', () => {
    expect(partyJoinRound(under({ phase: 'preparing' }), now)).toBeNull();
    expect(partyJoinRound(matchState(), now)).toBeNull();
    expect(partyJoinRound(under({ phase: 'finished' }), now)).toBeNull();
    expect(partyJoinRound(under({ kind: 'unranked' }), now)).toBeNull();
  });
});
