// Playing other people in wave 6: a party of forty in its lobby and through a round, reactions
// that float by the roster, a party closed to guests, the typical wait of a queue, and a report
// from the final standing that asks what it is about.
import { matchState, outcome, player, settings, viewer } from '../../src/multiplayer/testing.ts';
import { MEMBER, eightPlayers, fallingScores, fortyLobby, fortyParty, fortyTeamLobby, fortyTeamParty, leader, partyGame, scoresAround, spreadReveal, withTeamTotals } from './data.mjs';
import { falling, withRoundsPlayed } from './online.mjs';
import { GUEST_NAME, askToKick, bring, button, enterMatch, finalStanding as final, guess, leaveMap, lobbyTitle as lobby, openPane, refusal, roundReady, roundResult as result } from './setup.mjs';

const FULL = { fullPage: true };
/** a match of more than twenty players is asked for every four seconds: what the server changes is seen within two polls */
const SEEN_MS = 12_000;
/** a reaction comes up a little way as it appears, and is gone a few seconds later */
const FLOAT_RISE_MS = 400;
const FLOAT_GONE_MS = 8000;
/** forty players' scores for a round: falling from the first to the last, no two rounds alike */
const fallingForty = (index, round) => Math.max(0, 4950 - index * 118 - ((round * 37 + index * 11) % 5) * 60);
/** the host "neel" is the first of the forty, and no better than most of them: in the rounds played they come in about here */
const HOSTS_PLACE = 13;
const fortyPlayed = (index, round) => fallingForty((index + HOSTS_PLACE - 1) % 40, round);
/** a party of forty plays five rounds: four are played, and the fifth is the one on screen */
const LAST_ROUND = 4;

const rows = (s) => s.page.locator('.lobby-players .player-row');
const floats = (s) => s.page.locator('.reaction-float');

async function fortyLobbyScenes(run) {
  await run.scene('lobby: forty players, as the host', {}, async (s) => {
    const state = fortyLobby();
    const asked = state.players[2].username;
    await enterMatch(s, state);
    await lobby(s).waitFor();
    await s.capture('lobby-forty-players-as-host', () => rows(s).nth(39).waitFor(), FULL);
    await s.capture('lobby-forty-players-top-of-the-screen');
    await s.capture('lobby-forty-players-list-scrolled-to-its-end', async () => {
      await s.page.locator('.lobby-players .player-list').first().evaluate((list) => list.scrollTo(0, list.scrollHeight));
      await bring(s.page.locator('.lobby-players'));
    });
    await s.capture('lobby-forty-players-kick-asked-in-the-row', async () => {
      await s.page.locator('.lobby-players .player-list').first().evaluate((list) => list.scrollTo(0, 0));
      const row = rows(s).filter({ hasText: asked });
      await askToKick(s, row, asked);
      await row.getByRole('button', { name: s.say('host.kickYes') }).waitFor();
      await bring(row);
    });
  });

  await run.scene('lobby: forty players, as a player', {}, async (s) => {
    await enterMatch(s, fortyLobby({ you: MEMBER }));
    await lobby(s).waitFor();
    await s.capture('lobby-forty-players-as-a-player-waiting-for-the-host', () => rows(s).nth(39).waitFor(), FULL);
    await s.capture('lobby-forty-players-as-a-player-top-of-the-screen');
  });

  await run.scene('lobby: forty players picking two teams', {}, async (s) => {
    await enterMatch(s, fortyTeamLobby());
    await lobby(s).waitFor();
    await s.capture('lobby-forty-players-two-teams-and-some-without-one', () => rows(s).nth(39).waitFor(), FULL);
    await s.capture('lobby-forty-players-two-teams-top-of-the-screen');
  });
}

async function fortyMatchScenes(run) {
  await run.scene('party of forty: round, who has guessed, reveal, final standing', {}, async (s) => {
    await enterMatch(s, withRoundsPlayed(fortyParty(), LAST_ROUND, fortyPlayed), LAST_ROUND);
    await roundReady(s.page);
    await s.capture('match-round-forty-players');
    await s.capture('match-waiting-who-has-guessed-forty-players', async () => {
      await guess(s);
      await button(s, 'match.guessSent').waitFor();
      s.match.state.players.slice(1, 27).forEach((each) => s.match.opponentGuesses(each.username));
      await leaveMap(s);
      await s.page.waitForResponse((reply) => reply.url().includes('/api/match?id='), { timeout: SEEN_MS });
    });
    await s.capture('match-reveal-forty-players-last-round', async () => {
      s.match.revealScores(scoresAround(s.match.state.players, HOSTS_PLACE - 2));
      spreadReveal(s.match);
      await result(s).waitFor({ timeout: SEEN_MS });
    });
    await s.capture('match-final-standing-forty-players', async () => {
      s.match.finish(outcome([leader(s.match.state.players)]));
      await final(s).waitFor({ timeout: SEEN_MS });
    });
  });

  await run.scene('party of forty in two teams: reveal and final standing', {}, async (s) => {
    await enterMatch(s, withTeamTotals(withRoundsPlayed(fortyTeamParty(), LAST_ROUND, fortyPlayed)), LAST_ROUND);
    await roundReady(s.page);
    await s.capture('match-reveal-forty-players-in-two-teams', async () => {
      await guess(s);
      s.match.revealScores(scoresAround(s.match.state.players, HOSTS_PLACE - 2));
      spreadReveal(s.match);
      await result(s).waitFor({ timeout: SEEN_MS });
    });
    await s.capture('match-final-standing-forty-players-in-two-teams', async () => {
      const { players, teams } = s.match.state;
      const [won] = [...teams].sort((a, b) => b.total - a.total);
      s.match.finish(outcome(players.filter((each) => each.team === won.team).map((each) => each.username)));
      await final(s).waitFor({ timeout: SEEN_MS });
    });
  });
}

async function reactionScenes(run) {
  await run.scene('reactions floating: while guessing, by the roster, over a reveal', {}, async (s) => {
    const gone = () => floats(s).first().waitFor({ state: 'detached', timeout: FLOAT_GONE_MS });
    const floating = async () => {
      await floats(s).last().waitFor();
      await s.page.waitForTimeout(FLOAT_RISE_MS);
    };
    await enterMatch(s, withRoundsPlayed(eightPlayers(), 1, falling), 1);
    await roundReady(s.page);
    // caught while they stand there: a reaction is gone again in a few seconds
    await s.capture(
      'match-reaction-floating-while-guessing',
      async () => {
        s.match.say('ana', null, 'gl');
        await floating();
      },
      { still: false },
    );
    // a wide screen lists up to three under the roster; a phone has room for the newest beside the roster's one line
    await s.capture(
      s.phone ? 'match-reaction-floating-beside-the-roster-line' : 'match-reactions-floating-under-the-roster-three-at-once',
      async () => {
        await gone();
        await guess(s);
        await button(s, 'match.guessSent').waitFor();
        ['ana', 'sam'].forEach((name) => s.match.opponentGuesses(name));
        await leaveMap(s);
        await s.page.locator('.roster').waitFor();
        [['sam', 'nice'], ['kit', 'wow'], ['mia', 'gg']].forEach(([name, word]) => s.match.say(name, null, word));
        await floating();
      },
      { still: false },
    );
    await s.capture(
      'match-reaction-floating-over-a-reveal',
      async () => {
        await gone();
        s.match.revealScores(scoresAround(s.match.state.players, 3, 4700, 420));
        spreadReveal(s.match);
        await result(s).waitFor();
        s.match.say('lee', null, 'gg');
        await floating();
      },
      { still: false },
    );
  });
}

async function guestSwitchScenes(run) {
  await run.scene('party form: Allow guests, a lobby closed to guests', {}, async (s) => {
    const guests = () => s.page.getByRole('group', { name: s.say('party.guests') });
    await openPane(s, '/#create');
    await s.capture('pane-create-party-form-with-allow-guests', undefined, FULL);
    await s.capture('pane-create-party-allow-guests-switched-off', async () => {
      await guests().getByRole('radio', { name: s.say('account.switch.no') }).check();
      await bring(guests());
    });
    await s.capture(
      'lobby-closed-to-guests-accounts-only-a-guest-already-in-stays',
      async () => {
        await button(s, 'party.create.submit').click();
        await lobby(s).waitFor();
        s.match.addPlayer('sam', { country: 'GB' });
        s.match.addGuest(4821);
        await s.page.getByText(s.say('party.guests.stay')).waitFor();
      },
      FULL,
    );
    await s.capture(
      'lobby-settings-form-with-allow-guests',
      async () => {
        await button(s, 'party.settings.change').click();
        const form = s.page.getByRole('form', { name: s.say('party.settings.form') });
        await form.getByRole('group', { name: s.say('party.guests') }).waitFor();
      },
      FULL,
    );
  });

  await run.scene('a party for accounts only: a visitor who opens its link', { who: 'visitor' }, async (s) => {
    s.match.state = matchState({ settings: settings({ guests: false }), you: viewer({ username: GUEST_NAME, guest: true }), players: [player('sam', { country: 'GB' })] });
    await s.capture(
      'pane-join-party-accounts-only-notice-with-the-way-to-sign-up',
      async () => {
        await openPane(s, '/?party=ABC123');
        await button(s, 'guest.play').click();
        await button(s, 'party.join.submit').click();
        await s.page.locator('.status-box', { hasText: s.say('party.accountsOnly.label') }).waitFor();
      },
      FULL,
    );
  });
}

async function queueWaitScenes(run) {
  await run.scene('queue: the typical wait, in each wording', {}, async (s) => {
    const typical = (wait) => s.page.locator('.queue-typical', { hasText: s.say('queue.typical', { wait }) }).waitFor();
    const minutes = 3;
    s.match.typicalWait = 45;
    await s.capture('queue-unranked-typical-wait-usually-under-a-minute', async () => {
      await openPane(s, '/#unranked');
      await button(s, 'queue.find').click();
      await typical(s.say('queue.typical.underMinute'));
    });
    await s.capture('queue-unranked-typical-wait-about-three-minutes', async () => {
      s.match.typicalWait = minutes * 60 + 5;
      await typical(s.say('queue.typical.minutes.other', { count: minutes }));
    });
    await s.capture('queue-unranked-typical-wait-no-recent-games', async () => {
      s.match.typicalWait = null;
      await typical(s.say('queue.typical.none'));
    });
  });
}

async function reportScenes(run) {
  await run.scene('final standing: a report asks what it is about', {}, async (s) => {
    const state = withRoundsPlayed(partyGame({ you: MEMBER, players: [player('sam', { country: 'GB' }), player('neel', { country: 'IN' }), player('ana', { country: 'BR' })] }), 2, falling);
    const dialog = s.page.getByRole('dialog');
    await enterMatch(s, state, 2);
    await roundReady(s.page);
    await guess(s);
    s.match.revealScores(fallingScores(s.match.state.players, 4100, 900));
    spreadReveal(s.match);
    await result(s).waitFor();
    s.match.finish(outcome(['sam']));
    await final(s).waitFor();
    await s.capture('match-final-standing-report-question-with-its-categories', async () => {
      await final(s).getByRole('button', { name: s.say('common.reportPlayer', { name: 'sam' }) }).click();
      await dialog.getByRole('group', { name: s.say('report.category.legend') }).getByRole('radio').nth(3).waitFor();
    });
    await s.capture('match-final-standing-report-refused-nothing-chosen', async () => {
      await dialog.getByRole('button', { name: s.say('common.report'), exact: true }).click();
      await refusal(dialog).waitFor();
    });
    await s.capture('match-final-standing-player-reported', async () => {
      await dialog.getByRole('radio', { name: s.say('report.category.offensiveChat'), exact: true }).check();
      await dialog.getByRole('button', { name: s.say('common.report'), exact: true }).click();
      await final(s).getByRole('status').filter({ hasText: /\S/ }).first().waitFor();
    });
  });
}

export async function onlineScenes6(run) {
  await fortyLobbyScenes(run);
  await fortyMatchScenes(run);
  await reactionScenes(run);
  await guestSwitchScenes(run);
  await queueWaitScenes(run);
  await reportScenes(run);
}
