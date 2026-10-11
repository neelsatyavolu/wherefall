import { describe, expect, it } from 'vitest';
import { afterMatch, chatView, leagueFor, reactionsSince, returnsToQueue, versusOf, xpEarned, xpForRound } from './match-view.ts';
import { KIND_SETTINGS, PLACES, chatEntry, guessRow, guest, matchState, outcome, player, rankedState, settings, teamRow, teamState, viewer } from './testing.ts';

const unranked = (change = {}) => matchState({ kind: 'unranked', code: null, settings: KIND_SETTINGS.unranked, you: viewer(), ...change });

describe('xpForRound', () => {
  it('is the score over fifty in a public game and a 2v2', () => {
    expect(xpForRound(unranked(), 4200)).toBe(84);
    expect(xpForRound(teamState(), 5000)).toBe(100);
  });

  it('is double in a ranked duel', () => {
    expect(xpForRound(rankedState(), 4200)).toBe(168);
    expect(xpForRound(rankedState(), 0)).toBe(0);
  });

  it('is nothing in a party, and nothing for a guest anywhere', () => {
    expect(xpForRound(matchState(), 5000)).toBeNull();
    expect(xpForRound(unranked({ you: viewer({ username: 'Guest #4821', guest: true }) }), 5000)).toBeNull();
  });
});

describe('xpEarned', () => {
  const results = [
    { round: 0, guesses: [guessRow('neel', 4200), guessRow('sam', 3000)] },
    { round: 1, guesses: [guessRow('sam', 2500)] },
    { round: 2, guesses: [guessRow('neel', 5000), guessRow('sam', 100)] },
  ];

  it("adds up the player's own rounds, round by round", () => {
    expect(xpEarned(unranked({ results }))).toBe(184);
    expect(xpEarned(rankedState({ results }))).toBe(368);
  });

  it('is null where the match earns none', () => {
    expect(xpEarned(matchState({ results }))).toBeNull();
  });
});

describe('returnsToQueue', () => {
  const dodged = (by: string) => rankedState({ phase: 'finished', outcome: outcome([], { dodgedBy: by }) });

  it('is true for the player who stayed when the other left before it began', () => {
    expect(returnsToQueue(dodged('sam'))).toBe(true);
  });

  it('is false for the player who left, and for any other ending', () => {
    expect(returnsToQueue(dodged('neel'))).toBe(false);
    expect(returnsToQueue(rankedState({ phase: 'finished', places: PLACES, outcome: outcome(['sam']) }))).toBe(false);
    expect(returnsToQueue(rankedState())).toBe(false);
  });
});

describe('afterMatch', () => {
  it('offers the same queue again after a matchmade game', () => {
    expect(afterMatch(unranked())).toEqual({ again: 'unranked', lobby: false, party: false });
    expect(afterMatch(rankedState())).toEqual({ again: 'ranked', lobby: false, party: false });
    expect(afterMatch(teamState())).toEqual({ again: 'team', lobby: false, party: false });
  });

  it("gives a party's host the way back to its lobby, and nobody a queue", () => {
    expect(afterMatch(matchState())).toEqual({ again: null, lobby: true, party: true });
    expect(afterMatch(matchState({ you: viewer() }))).toEqual({ again: null, lobby: false, party: true });
  });
});

describe('leagueFor', () => {
  it('follows the thresholds of the contract', () => {
    expect([0, 799, 800, 999, 1000, 1299, 1300, 1799, 1800, 2400].map(leagueFor)).toEqual([
      'Trekker',
      'Trekker',
      'Explorer',
      'Explorer',
      'Voyager',
      'Voyager',
      'Nomad',
      'Nomad',
      'Legend',
      'Legend',
    ]);
  });
});

describe('versusOf', () => {
  const duel = rankedState({ phase: 'playing', players: [player('neel', { rating: 1016, health: 5000, country: 'IN' }), player('sam', { rating: 780, health: 5000 })] });
  const starting = { kind: 'starting', round: 0, startsInMs: 4000, msLeft: 60_000 } as const;

  it('names both players of a ranked duel while its first round gets ready', () => {
    expect(versusOf(duel, starting)).toEqual([
      { username: 'neel', country: 'IN', rating: 1016, league: 'Voyager', isYou: true },
      { username: 'sam', country: null, rating: 780, league: 'Trekker', isYou: false },
    ]);
  });

  it('is over once the round starts, and is not shown before a later round', () => {
    expect(versusOf(duel, { kind: 'guessing', round: 0, msLeft: 60_000 })).toBeNull();
    expect(versusOf(duel, { ...starting, round: 1 })).toBeNull();
    expect(versusOf(duel, { kind: 'preparing', resolve: false })).toBeNull();
  });

  it('is for ranked duels only', () => {
    expect(versusOf(unranked({ phase: 'playing' }), starting)).toBeNull();
    expect(versusOf(teamState({ phase: 'playing' }), starting)).toBeNull();
  });
});

describe('chatView', () => {
  const entries = [chatEntry(1, 'sam', 'hello'), chatEntry(2, 'neel', null, { emote: 'gg' })];

  it('gives the lines, what may be sent, and the other players with who is muted', () => {
    const state = matchState({ chat: entries, you: viewer({ muted: ['sam'] }), players: [player('neel', { country: 'US' }), player('sam', { country: 'FR' }), guest(4821)] });
    expect(chatView(state, false)).toEqual({
      entries,
      you: 'neel',
      country: 'US',
      mode: 'chat',
      teamScope: false,
      guestNote: false,
      others: [
        { username: 'sam', country: 'FR', muted: true },
        { username: 'Guest #4821', country: null, muted: false },
      ],
    });
  });

  it('is off, with no note, for a player who has hidden chat', () => {
    expect(chatView(matchState({ chat: entries }), true)).toMatchObject({ mode: 'off', guestNote: false });
    expect(chatView(matchState({ you: viewer({ username: 'Guest #4821', guest: true }) }), true)).toMatchObject({ mode: 'off', guestNote: false });
  });

  it('tells a guest what signing up adds only where accounts can write', () => {
    const asGuest = viewer({ username: 'Guest #4821', guest: true });
    expect(chatView(matchState({ you: asGuest }), false)).toMatchObject({ mode: 'reactions', guestNote: true });
    expect(chatView(matchState({ you: asGuest, settings: settings({ communication: 'reactions' }) }), false)).toMatchObject({ mode: 'reactions', guestNote: false });
    expect(chatView(matchState({ you: asGuest, settings: settings({ communication: 'off' }) }), false)).toMatchObject({ mode: 'off', guestNote: false });
    expect(chatView(unranked({ you: asGuest }), false)).toMatchObject({ mode: 'reactions', guestNote: false });
  });

  it('has reactions alone in public games and ranked duels', () => {
    expect(chatView(unranked(), false).mode).toBe('reactions');
    expect(chatView(rankedState(), false).mode).toBe('reactions');
    expect(chatView(teamState(), false).mode).toBe('chat');
  });

  it('offers a message to the team alone in 2v2 and in a party with teams, to a player who is on one', () => {
    const teamed = { settings: settings({ teams: 'best' }), teams: [teamRow(0, { health: null }), teamRow(1, { health: null })] };
    expect(chatView(teamState(), false).teamScope).toBe(true);
    expect(chatView(matchState({ ...teamed, you: viewer({ team: 1 }) }), false).teamScope).toBe(true);
    // no team picked yet, no teams at all
    expect(chatView(matchState(teamed), false).teamScope).toBe(false);
    expect(chatView(matchState(), false).teamScope).toBe(false);
  });

  it('offers no team message where the player cannot write at all', () => {
    const teamed = { settings: settings({ teams: 'best', communication: 'reactions' as const }), teams: [teamRow(0, { health: null }), teamRow(1, { health: null })], you: viewer({ team: 0 }) };
    expect(chatView(matchState(teamed), false).teamScope).toBe(false);
    expect(chatView(teamState(), true).teamScope).toBe(false);
    expect(chatView(teamState({ you: viewer({ username: 'Guest #4821', guest: true, team: 0 }) }), false).teamScope).toBe(false);
  });
});

describe('reactionsSince', () => {
  const players = [player('neel', { country: 'US' }), player('sam', { country: 'FR' }), guest(4821)];
  const chat = [
    chatEntry(1, 'sam', 'hello'),
    chatEntry(2, 'sam', null, { emote: 'gg' }),
    chatEntry(3, 'neel', null, { emote: 'nice' }),
    chatEntry(4, 'Guest #4821', null, { emote: 'wow' }),
    chatEntry(5, 'sam', 'see you'),
  ];
  const view = (change = {}, hidden = false) => chatView(matchState({ chat, players, ...change }), hidden);

  it('gives the reactions that came after the last one seen, the player’s own among them, each with its sender’s flag', () => {
    expect(reactionsSince(view(), 0)).toEqual([
      { id: 2, username: 'sam', country: 'FR', emote: 'gg' },
      { id: 3, username: 'neel', country: 'US', emote: 'nice' },
      { id: 4, username: 'Guest #4821', country: null, emote: 'wow' },
    ]);
    expect(reactionsSince(view(), 3).map((reaction) => reaction.id)).toEqual([4]);
    expect(reactionsSince(view(), 5)).toEqual([]);
  });

  it('leaves written messages to the chat', () => {
    expect(reactionsSince(view({ chat: [chatEntry(1, 'sam', 'hello')] }), 0)).toEqual([]);
  });

  it('gives nothing to a player who has hidden chat, or in a party whose host turned it off', () => {
    expect(reactionsSince(view({}, true), 0)).toEqual([]);
    expect(reactionsSince(view({ settings: settings({ communication: 'off' }) }), 0)).toEqual([]);
  });

  it('leaves out a muted player, should the server ever send one of their lines', () => {
    expect(reactionsSince(view({ you: viewer({ muted: ['sam'] }) }), 0).map((reaction) => reaction.username)).toEqual(['neel', 'Guest #4821']);
  });

  it('has no flag for a player who has left the match', () => {
    expect(reactionsSince(view({ chat: [chatEntry(9, 'gone', null, { emote: 'bye' })] }), 0)).toEqual([{ id: 9, username: 'gone', country: null, emote: 'bye' }]);
  });
});
