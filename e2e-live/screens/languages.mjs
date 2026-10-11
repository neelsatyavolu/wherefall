// The main screens of one other language, on a phone, where its longer words have the least room.
import { dailyEntries } from '../../e2e/daily-server.ts';
import { historyGames } from '../../e2e/games-server.ts';
import { outcome } from '../../src/multiplayer/testing.ts';
import { RATING_CHANGES, dailyHistory, duel, fullLobby, spreadReveal, twoVersusTwo } from './data.mjs';
import { button, enterMatch, menuButton, finalStanding, guess, lobbyTitle, openPane, placePin, roundReady, roundResult, startChallenge } from './setup.mjs';

const FULL = { fullPage: true };

async function paneScenes(run) {
  await run.scene('panes: home, ranked, leaderboards, account, daily', {}, async (s) => {
    s.games.history = historyGames(40);
    s.daily.country = 'IN';
    s.daily.entries = dailyEntries(45);
    s.daily.records = { played: 11, best: 14_200, average: 9860 };
    s.daily.history = dailyHistory();
    s.daily.streak = { current: 4, best: 9, atRisk: true };
    const pane = (address, name, before) =>
      s.capture(
        name,
        async () => {
          await openPane(s, address);
          await before?.();
        },
        FULL,
      );
    await pane('/', 'pane-singleplayer');
    await s.capture('phone-menu-open', () => menuButton(s).click());
    await pane('/#ranked', 'pane-ranked-duel');
    await pane('/#leaderboards', 'pane-leaderboards');
    await pane('/#account', 'pane-account');
    await pane('/#daily', 'pane-daily-open-streak-at-risk');
    s.daily.save([4800, 3950, 2500]);
    await pane('/#daily', 'pane-daily-done-with-rank-and-history');
    await pane('/#create', 'pane-create-party-form');
  });

}

async function gameScenes(run) {
  await run.scene('round: map closed, map open, result, summary', {}, async (s) => {
    await startChallenge(s);
    await s.capture('round-map-closed');
    await s.capture('round-map-open-pin-placed', () => placePin(s));
    await s.capture('round-result', async () => {
      await button(s, 'round.guess').click();
      await s.page.getByRole('region', { name: s.say('result.label') }).waitFor();
    });
    await s.capture('game-summary', async () => {
      for (const next of ['result.next', 'result.next', 'result.seeSummary']) {
        await button(s, next).click();
        if (next === 'result.next') {
          await roundReady(s.page);
          await guess(s);
        }
      }
      await s.page.getByRole('region', { name: s.say('summary.label') }).waitFor();
    });
  });

}

async function matchScenes(run) {
  await run.scene('ranked duel: round, reveal, final standing', {}, async (s) => {
    await enterMatch(s, duel(), 0);
    await roundReady(s.page);
    await s.capture('ranked-round-with-health-bars');
    await s.capture('ranked-reveal', async () => {
      await guess(s);
      s.match.reveal(3100, 4650);
      spreadReveal(s.match);
      await roundResult(s).waitFor();
    });
    await s.capture('final-standing', async () => {
      s.match.finish(outcome(['sam'], { ratingChanges: RATING_CHANGES }));
      await finalStanding(s).waitFor();
    });
  });

  await run.scene('lobby with teams and host controls', {}, async (s) => {
    await enterMatch(s, fullLobby());
    await lobbyTitle(s).waitFor();
    await s.capture('lobby-twenty-players-with-teams', () => s.page.locator('.lobby-players .player-name').nth(19).waitFor(), FULL);
  });

  await run.scene('2v2: round with team health, reveal', {}, async (s) => {
    await enterMatch(s, twoVersusTwo(), 0);
    await roundReady(s.page);
    await s.capture('2v2-round-with-team-health');
    await s.capture('2v2-reveal', async () => {
      await guess(s);
      s.match.revealScores({ neel: 1000, sam: 2000, ana: 4000, kit: 500 });
      spreadReveal(s.match);
      await roundResult(s).waitFor();
    });
  });
}

export async function languageScenes(run) {
  await paneScenes(run);
  await gameScenes(run);
  await matchScenes(run);
}
