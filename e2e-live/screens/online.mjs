// Playing other people: the queue, the party lobby, and a match of each kind from its first round
// to its final standing, with the chat, the host's controls and the notices a player can meet.
import { guessRow, guest, matchState, outcome, player, queueState, settings } from '../../src/multiplayer/testing.ts';
import { HOST, MEMBER, NO_HEALTH, RATING_CHANGES, duel, eightPlayers, fallingScores, friendsList, fullLobby, fullParty, partyGame, spreadReveal, teamParty, twoVersusTwo } from './data.mjs';
import { askToKick, button, enterMatch, finalStanding as final, guess, leaveMap, lobbyTitle as lobby, openMap, openPane, roundReady, roundResult as result, visit } from './setup.mjs';

const FULL = { fullPage: true };
/** long enough before a round starts for its get-ready screen to be photographed at rest */
const LONG_LEAD_MS = 30_000;

export const foldedChat = (s) => s.page.getByRole('complementary', { name: s.say('label.chat') });
const hostPanel = (s) => s.page.getByRole('complementary', { name: s.say('host.label') });
const notice = (s) => s.page.getByRole('alert').filter({ hasText: /\S/ }).first();

/** The rounds before the one being played, as the server would hold them: every player with a score in each. */
export function withRoundsPlayed(state, played, scoreOf) {
  const results = Array.from({ length: played }, (_, round) => ({
    round,
    guesses: state.players.map((p, index) => guessRow(p.username, scoreOf(index, round), { lng: -60 + index * 9, lat: 40 - index * 3, distanceKm: 400 + index * 310 })),
  }));
  const total = (index) => results.reduce((sum, each) => sum + each.guesses[index].score, 0);
  return { ...state, round: played, results, players: state.players.map((p, index) => ({ ...p, total: total(index) })) };
}

/** A score that falls from the first player to the last and wobbles from round to round. */
export const falling = (index, round) => Math.max(0, 4900 - index * 230 - ((round * 37 + index * 11) % 5) * 90);

/** Opens the folded chat of a match. */
export async function openChat(s) {
  await leaveMap(s);
  await foldedChat(s).getByRole('button', { name: new RegExp(`^${s.say('label.chat')}`) }).click();
  await foldedChat(s).getByRole('button', { name: s.say('chat.close') }).waitFor();
}

export const closeChat = (s) => foldedChat(s).getByRole('button', { name: s.say('chat.close') }).click();

async function queueScenes(run) {
  await run.scene('queue: looking, time waited, countdown, rating window', {}, async (s) => {
    const find = async (kind) => {
      await openPane(s, `/#${kind}`);
      await button(s, 'queue.find').click();
      await s.page.getByText(s.say('queue.looking')).waitFor();
    };
    await s.capture('queue-unranked-looking-with-time-waited', async () => {
      await find('unranked');
      s.match.queue = { ...s.match.queue, waiting: 3, since: s.match.time(-42_000) };
      await s.page.locator('.queue-waited').filter({ hasText: /0:4\d/ }).waitFor();
    });
    await s.capture('queue-unranked-countdown-to-the-start', async () => {
      s.match.queue = { ...s.match.queue, waiting: 4, startsAt: s.match.time(9000) };
      await s.page.getByText(new RegExp(s.say('queue.startingIn', { seconds: '\\d' }))).waitFor();
    });
    await s.capture('queue-ranked-time-waited-and-rating-window', async () => {
      await button(s, 'common.cancel').click();
      await find('ranked');
      s.match.queue = { ...s.match.queue, since: s.match.time(-75_000) };
      // the window has stopped widening: it is held at 400 either side
      await s.page.locator('.queue-window').filter({ hasText: /400/ }).waitFor();
    });
    await s.capture('queue-2v2-looking', async () => {
      await button(s, 'common.cancel').click();
      await find('team');
    });
  });

  await run.scene('queue: back in it after the opponent left a ranked duel', {}, async (s) => {
    s.match.leadMs = LONG_LEAD_MS;
    await enterMatch(s, duel(), 0);
    await s.capture('queue-ranked-opponent-left-back-in-the-queue', async () => {
      // the get-ready is counting down, wherever on the screen it is said
      await s.page.getByText(new RegExp(s.say('match.roundStartsIn', { seconds: '\\d+' }))).first().waitFor();
      s.match.dodge('sam');
      await s.page.getByText(s.say('queue.dodged')).waitFor();
    });
  });
}

async function lobbyScenes(run) {
  await run.scene('lobby: host of two, chat, friends to invite, settings form, pair queue', {}, async (s) => {
    s.social.friends = friendsList();
    const state = matchState({ you: HOST, players: [player('neel', { country: 'IN' }), player('sam', { country: 'GB' })] });
    await enterMatch(s, state);
    await lobby(s).waitFor();
    s.match.say('sam', 'ready when you are');
    s.match.say('neel', null, 'gg');
    await s.capture('lobby-host-two-players-chat-invites-and-2v2-pair-offer', () => s.page.getByText('ready when you are').waitFor(), FULL);
    await s.capture(
      'lobby-host-settings-form-open',
      async () => {
        await button(s, 'party.settings.change').click();
        await s.page.getByRole('form', { name: s.say('party.settings.form') }).waitFor();
      },
      FULL,
    );
    await s.capture('queue-2v2-as-a-pair-from-the-lobby', async () => {
      await s.page.getByRole('form', { name: s.say('party.settings.form') }).getByRole('button', { name: s.say('common.cancel') }).click();
      await button(s, 'party.pair.button').click();
      await s.page.getByText(s.say('party.pair.queued')).waitFor();
    });
  });

  await run.scene('lobby: twenty players, teams, host controls, locked', {}, async (s) => {
    await enterMatch(s, fullLobby());
    await lobby(s).waitFor();
    await s.capture('lobby-twenty-players-teams-host-controls-locked', () => s.page.locator('.lobby-players .player-name').nth(19).waitFor(), FULL);
    await s.capture('lobby-twenty-players-top-of-the-screen');
    await s.capture(
      'lobby-kick-confirmation',
      async () => {
        await askToKick(s, s.page.locator('.lobby-players .player-row').filter({ hasText: 'player_02' }), 'player_02');
        await button(s, 'host.kickYes').waitFor();
        await button(s, 'host.kickYes').evaluate((node) => node.scrollIntoView({ block: 'center' }));
      },
    );
  });

}

async function lobbyPlayerScenes(run) {
  await run.scene('lobby: a player picks a team and waits for the host', {}, async (s) => {
    const state = matchState({
      you: MEMBER,
      settings: settings({ teams: 'average', rounds: 12, timeLimit: 0, mode: 'nmpz', communication: 'reactions' }),
      teams: NO_HEALTH,
      players: [player('sam', { country: 'GB', team: 0 }), player('neel', { country: 'IN' }), player('ana', { country: 'BR', team: 1 }), player('kit', { country: 'DE' }), guest(7302, { team: 1 })],
    });
    await enterMatch(s, state);
    await lobby(s).waitFor();
    await s.capture('lobby-player-no-team-yet-reactions-only-waiting-for-host', undefined, FULL);
    await s.capture(
      'lobby-player-on-a-team',
      async () => {
        const second = s.say('team.name', { number: 2 });
        await button(s, 'party.team.joinLabel', { team: second }).click();
        await s.page.getByRole('region', { name: second, exact: true }).getByText(s.say('team.yours'), { exact: true }).waitFor();
      },
      FULL,
    );
  });

  await run.scene('lobby: a guest left in it from before playing took an account', {}, async (s) => {
    s.match.state = matchState({ you: s.match.state.you, players: [player('sam', { country: 'GB' }), player('ana', { country: 'BR' }), guest(4821)] });
    await s.capture(
      'lobby-with-a-guest-left-in-it',
      async () => {
        await openPane(s, '/?party=ABC123');
        await button(s, 'party.join.submit').click();
        await lobby(s).waitFor();
        s.match.say('sam', 'hello all');
        await s.page.getByText('hello all').waitFor();
      },
      FULL,
    );
  });

  await run.scene('joining a party under way', {}, async (s) => {
    s.match.leadMs = 0;
    s.match.state = withRoundsPlayed(matchState({ you: MEMBER, players: [player('sam', { country: 'GB' }), player('ana', { country: 'BR' })], places: partyGame().places }), 1, falling);
    s.match.startRound(1);
    await s.capture('late-join-standing-before-first-round', async () => {
      await openPane(s, '/?party=ABC123');
      await button(s, 'party.join.submit').click();
      await s.page.getByRole('region', { name: s.say('match.join.label') }).waitFor();
    });
  });
}

async function duelScenes(run) {
  await run.scene('ranked duel: the versus intro', {}, async (s) => {
    s.match.leadMs = LONG_LEAD_MS;
    await enterMatch(s, duel(), 0);
    await s.capture('ranked-versus-intro', () => s.page.getByRole('complementary', { name: s.say('versus.label', { first: 'neel', second: 'sam' }) }).waitFor());
  });

  await run.scene('ranked duel: round, reveal, final standing', {}, async (s) => {
    await enterMatch(s, duel(), 0);
    await roundReady(s.page);
    await s.capture('ranked-round-with-health-bars');
    await s.capture('ranked-round-guess-sent-waiting-for-the-other-player', async () => {
      await guess(s);
      await button(s, 'match.guessSent').waitFor();
    });
    await s.capture('ranked-reveal-health-lost-and-double-xp', async () => {
      s.match.reveal(3100, 4650);
      spreadReveal(s.match);
      await result(s).waitFor();
    });
    await s.capture('ranked-final-standing-rating-changes-and-play-again', async () => {
      s.match.finish(outcome(['sam'], { ratingChanges: RATING_CHANGES }));
      await final(s).waitFor();
    });
    await s.capture('queue-ranked-after-play-again', async () => {
      await final(s).getByRole('button', { name: s.say('play.again') }).click();
      await s.page.getByText(s.say('queue.looking')).waitFor();
    });
  });
}

async function publicScenes(run) {
  await run.scene('unranked, eight players: who has guessed, reactions, reveal, final standing', {}, async (s) => {
    const state = withRoundsPlayed(eightPlayers(), 4, falling);
    await enterMatch(s, state, 4);
    await roundReady(s.page);
    await s.capture('match-waiting-who-has-guessed-eight-players', async () => {
      await guess(s);
      await button(s, 'match.guessSent').waitFor();
      ['ana', 'sam', 'kit'].forEach((name) => s.match.opponentGuesses(name));
      await leaveMap(s);
    });
    await s.capture('match-reactions-only-the-twenty-reactions', async () => {
      s.match.say('sam', null, 'gl');
      s.match.say('ana', null, 'nice');
      await openChat(s);
      await foldedChat(s).getByRole('button', { name: 'gg', exact: true }).click();
    });
    await s.capture('match-reveal-eight-players-last-round', async () => {
      await closeChat(s);
      s.match.revealScores(fallingScores(s.match.state.players, 5000, 520));
      spreadReveal(s.match);
      await result(s).waitFor();
    });
    await s.capture('match-final-standing-eight-players-xp-and-play-again', async () => {
      s.match.finish(outcome(['neel']));
      await final(s).waitFor();
    });
  });
}

async function partyScenes(run) {
  await run.scene('party of twenty: round, reveal, final standing, back to lobby', {}, async (s) => {
    const state = withRoundsPlayed(fullParty(), 2, falling);
    await enterMatch(s, state, 2);
    await roundReady(s.page);
    await s.capture('match-round-twenty-players-host-can-end-the-round');
    await s.capture('match-waiting-who-has-guessed-twenty-players', async () => {
      await guess(s);
      await button(s, 'match.guessSent').waitFor();
      s.match.state.players.slice(1, 12).forEach((p) => s.match.opponentGuesses(p.username));
      await leaveMap(s);
    });
    await s.capture('match-reveal-twenty-players', async () => {
      s.match.revealScores(fallingScores(s.match.state.players));
      spreadReveal(s.match);
      await result(s).waitFor();
    });
    await s.capture('match-final-standing-twenty-players-host-back-to-lobby', async () => {
      s.match.finish(outcome(['neel']));
      await final(s).waitFor();
    });
    await s.capture(
      'lobby-after-back-to-lobby-same-code',
      async () => {
        await final(s).getByRole('button', { name: s.say('match.backToLobby') }).click();
        await lobby(s).waitFor();
      },
      FULL,
    );
  });

  await run.scene('party as a player: the final standing asks them to stay', {}, async (s) => {
    const state = withRoundsPlayed(partyGame({ you: MEMBER, players: [player('sam', { country: 'GB' }), player('neel', { country: 'IN' }), player('ana', { country: 'BR' })] }), 2, falling);
    await enterMatch(s, state, 2);
    await roundReady(s.page);
    await s.capture('match-final-standing-party-player-stays-for-the-lobby', async () => {
      await guess(s);
      s.match.revealScores(fallingScores(s.match.state.players, 4100, 900));
      spreadReveal(s.match);
      await result(s).waitFor();
      s.match.finish(outcome(['sam']));
      await final(s).waitFor();
    });
  });

}

async function partyTeamScenes(run) {
  await run.scene('party with teams: reveal and final standing', {}, async (s) => {
    await enterMatch(s, teamParty({ settings: settings({ teams: 'best', rounds: 1 }) }), 0);
    await roundReady(s.page);
    await s.capture('party-teams-round');
    await s.capture('party-teams-reveal-with-team-scores', async () => {
      await guess(s);
      s.match.revealScores({ neel: 4000, sam: 1000, ana: 3000, kit: 1000 });
      spreadReveal(s.match);
      await result(s).waitFor();
    });
    await s.capture('party-teams-final-standing-winning-team', async () => {
      s.match.finish(outcome(['neel', 'sam']));
      await final(s).waitFor();
    });
  });

  await run.scene('party host in a match: the Host panel, a kick, the leave dialog', {}, async (s) => {
    await enterMatch(s, partyGame({ players: [player('neel', { country: 'IN' }), player('sam', { country: 'GB' }), player('ana', { country: 'BR' }), guest(4821)] }), 0);
    await roundReady(s.page);
    await s.capture('match-host-panel-open', async () => {
      await hostPanel(s).getByRole('button', { name: s.say('host.title'), exact: true }).click();
      await hostPanel(s).getByRole('button', { name: s.say('party.lock') }).waitFor();
    });
    await s.capture('match-host-panel-row-actions-open', async () => {
      await hostPanel(s).getByRole('button', { name: s.say('host.moreLabel', { name: 'ana' }), exact: true }).click();
      await hostPanel(s).getByRole('button', { name: s.say('host.kickLabel', { name: 'ana' }), exact: true }).waitFor();
    });
    await s.capture('match-host-panel-kick-confirmation', async () => {
      await hostPanel(s).getByRole('button', { name: s.say('host.kickLabel', { name: 'ana' }), exact: true }).click();
      await hostPanel(s).getByRole('button', { name: s.say('host.kickYes') }).waitFor();
    });
    // a wide screen has room for both panels; on a phone the corner holds one, and the chat takes the host's place
    await s.capture(s.phone ? 'match-chat-open-in-place-of-the-host-panel' : 'match-host-panel-and-chat-both-open', async () => {
      await hostPanel(s).getByRole('button', { name: s.say('common.cancel') }).click();
      s.match.say('sam', 'which way is north');
      await foldedChat(s).getByRole('button', { name: new RegExp(`^${s.say('label.chat')}`) }).click();
      await foldedChat(s).getByText('which way is north').waitFor();
    });
    await s.capture('confirm-dialog-leave-match', async () => {
      await closeChat(s);
      if (await hostPanel(s).locator('.host-panel').isVisible()) {
        await hostPanel(s).getByRole('button', { name: s.say('host.title'), exact: true }).click();
      }
      await button(s, 'round.exit').click();
      await s.page.getByRole('dialog').waitFor();
    });
  });

}

async function untimedScenes(run) {
  /** A round with no timer, with what that means in view: on a phone it is folded until pressed. */
  const untimedRound = async (s, state, open) => {
    await enterMatch(s, state, 0);
    await roundReady(s.page);
    const label = s.page.locator('.round-bar').getByText(s.say('party.noTimer.label'));
    await label.waitFor();
    if (open && !(await s.page.locator('.round-note').isVisible())) {
      await label.click();
    }
  };
  const untimed = settings({ timeLimit: 0 });
  const asPlayer = { settings: untimed, you: MEMBER, players: [player('sam', { country: 'GB' }), player('neel', { country: 'IN' })] };

  await run.scene('party round with no timer: the host, then a player', {}, async (s) => {
    await s.capture('match-round-no-timer-host-can-end-it', () => untimedRound(s, partyGame({ settings: untimed }), true));
    await s.capture('match-round-no-timer-as-a-player', () => untimedRound(s, partyGame(asPlayer), true));
  });

  await run.scene('party round with no timer: the note folded on a phone', { only: 'phone' }, async (s) => {
    await s.capture('match-round-no-timer-note-folded', () => untimedRound(s, partyGame({ settings: untimed }), false));
  });

}

async function chatScenes(run) {
  await run.scene('chat in a party: messages, the mute list, a muted player', {}, async (s) => {
    await enterMatch(s, partyGame({ you: MEMBER, players: [player('sam', { country: 'GB' }), player('ana', { country: 'BR' }), player('neel', { country: 'IN' })] }), 0);
    await roundReady(s.page);
    s.match.say('sam', 'hello');
    s.match.say('ana', 'hi all, this one looks like the south of France');
    s.match.say('sam', null, 'think');
    await s.capture('match-chat-folded-with-new-messages', () => foldedChat(s).getByText(/\d/).first().waitFor());
    await s.capture('match-chat-open-messages-and-reactions', () => openChat(s));
    await s.capture('match-chat-mute-list-open', async () => {
      await foldedChat(s).getByText(s.say('chat.mute.title')).click();
      await foldedChat(s).getByRole('button', { name: s.say('chat.mute.label', { name: 'sam' }) }).waitFor();
    });
    await s.capture('match-chat-a-player-muted', async () => {
      await foldedChat(s).getByRole('button', { name: s.say('chat.mute.label', { name: 'sam' }) }).click();
      await foldedChat(s).getByRole('button', { name: s.say('chat.mute.undoLabel', { name: 'sam' }) }).waitFor();
    });
  });
}

async function teamScenes(run) {
  await run.scene('2v2: team health, a teammate\'s pin, Team / All chat, reveal, final standing', {}, async (s) => {
    await enterMatch(s, twoVersusTwo(), 0);
    await roundReady(s.page);
    await s.capture('2v2-round-with-team-health');
    await s.capture('2v2-round-teammates-pin-on-the-map', async () => {
      s.match.matePin('sam', 10, 20);
      await openMap(s);
      await s.page.locator('.pin-mate').waitFor();
    });
    await s.capture('2v2-chat-with-the-team-all-switch', async () => {
      s.match.say('sam', 'it is Paris, I am sure', null, 'team');
      s.match.say('ana', 'good luck');
      await openChat(s);
      await foldedChat(s).getByRole('radio', { name: s.say('chat.scope.team') }).check();
      await foldedChat(s).getByText('good luck').waitFor();
    });
    await s.capture('2v2-reveal-team-health-lost', async () => {
      await closeChat(s);
      await guess(s);
      s.match.revealScores({ neel: 1000, sam: 2000, ana: 4000, kit: 500 });
      spreadReveal(s.match);
      await result(s).waitFor();
    });
    await s.capture('2v2-final-standing-the-other-team-won', async () => {
      s.match.finish(outcome(['ana', 'kit']));
      await final(s).waitFor();
    });
  });
}

async function noticeScenes(run) {
  await run.scene('notices: removed by the host', {}, async (s) => {
    await enterMatch(s, partyGame({ you: MEMBER, players: [player('sam', { country: 'GB' }), player('neel', { country: 'IN' })] }), 0);
    await roundReady(s.page);
    await s.capture('state-removed-from-the-party-by-the-host', async () => {
      s.match.kickYou();
      await notice(s).waitFor();
    });
  });

  await run.scene('notices: a guest session that ran out during a match', { who: 'guest' }, async (s) => {
    await enterMatch(s, eightPlayers({ you: s.match.state.you, players: [player('ana', { country: 'BR' }), player('sam', { country: 'GB' }), guest(4821)] }), 0);
    await roundReady(s.page);
    await s.capture('match-round-as-a-guest');
    await s.capture('state-guest-session-ended-during-a-match', async () => {
      s.match.session = 'none';
      await notice(s).waitFor();
    });
  });

}

async function matchErrorScenes(run) {
  await run.scene('errors: the connection lost during a match', {}, async (s) => {
    await enterMatch(s, partyGame(), 0);
    await roundReady(s.page);
    await s.capture('state-error-match-connection-lost', async () => {
      s.match.down = true;
      await s.page.getByText(new RegExp(s.say('common.connectionLost', { error: '' }).trim())).first().waitFor();
    });
  });

  await run.scene('errors: a match that cannot be loaded', {}, async (s) => {
    s.match.state = partyGame();
    s.match.matchFound('m1');
    await s.capture('state-error-match-could-not-be-loaded', async () => {
      await visit(s, '/');
      await button(s, 'home.resume.rejoin').waitFor();
      s.match.state = { ...s.match.state, id: 'gone' };
      await button(s, 'home.resume.rejoin').click();
      await notice(s).waitFor();
    });
  });

  await run.scene('errors: a search that ran out', {}, async (s) => {
    await s.capture('state-error-queue-search-ran-out', async () => {
      await openPane(s, '/#unranked');
      await button(s, 'queue.find').click();
      await s.page.getByText(s.say('queue.looking')).waitFor();
      s.match.queue = queueState();
      await s.page.getByText(s.say('queue.ranOut')).waitFor();
    });
  });
}

export async function onlineScenes(run) {
  await queueScenes(run);
  await lobbyScenes(run);
  await lobbyPlayerScenes(run);
  await duelScenes(run);
  await publicScenes(run);
  await partyScenes(run);
  await partyTeamScenes(run);
  await untimedScenes(run);
  await chatScenes(run);
  await teamScenes(run);
  await noticeScenes(run);
  await matchErrorScenes(run);
}
