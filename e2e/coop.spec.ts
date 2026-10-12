import { expect, test } from '@playwright/test';
import { matchState, outcome, player, settings } from '../src/multiplayer/testing.ts';
import { placePin, play } from './helpers.ts';
import { MatchServer } from './match-server.ts';
import { enter, final, hostPanel, lobbyRow, openActions, partyGame, result, sendGuess, settingsLine, team } from './party-helpers.ts';

// Co-op: a party everyone plays together. One player, the picker, places the guess that counts;
// everyone else's pin is a suggestion the picker sees.

const COOP = settings({ teams: 'coop' });
const THREE = [player('neel'), player('sam'), player('ana')];
const HINT = "Everyone plays together. The picker places the guess that counts, and everyone else's pin is a suggestion.";

/** A co-op round is on screen and has started: its status line says who places the guess. */
async function coopRoundReady(page: Parameters<typeof play>[0], says: string): Promise<void> {
  await expect(play(page)).toHaveAttribute('data-phase', 'guessing');
  await expect(page.locator('.status')).toHaveText(says);
}

test('the host makes a party co-op and names the picker in the lobby', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = matchState({ players: [player('neel'), player('sam')] });
  await enter(page, server);

  await page.getByRole('button', { name: 'Change settings' }).click();
  const form = page.getByRole('form', { name: 'Party settings' });
  await form.getByRole('radio', { name: 'Co-op' }).check();
  await form.getByRole('button', { name: 'Save settings' }).click();
  expect(server.posted('configure').at(-1)).toEqual({ action: 'configure', matchId: 'm1', settings: COOP });
  await expect(settingsLine(page)).toHaveText('World · 3 rounds · 30 sec · move · chat · co-op');

  // one list, no teams to pick or shuffle, and what co-op is in a line under it
  await expect(team(page, 'Team 1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shuffle teams' })).toBeHidden();
  await expect(page.getByText(HINT)).toBeVisible();

  // the host picks until they name someone else
  await expect(lobbyRow(page, 'neel').locator('.tag')).toHaveText(['you, host', 'picker']);
  await expect(lobbyRow(page, 'neel').getByRole('button')).toHaveCount(0);
  await expect(lobbyRow(page, 'sam').getByRole('button')).toHaveText(['Make picker', 'Make host', 'Kick']);

  await page.getByRole('button', { name: 'Make sam the picker' }).click();
  expect(server.posted('picker')).toEqual([{ action: 'picker', matchId: 'm1', username: 'sam' }]);
  await expect(lobbyRow(page, 'sam').locator('.tag')).toHaveText(['picker']);
  await expect(lobbyRow(page, 'sam').getByRole('button')).toHaveText(['Make host', 'Kick']);

  // and can take the pick back, from their own row
  await expect(lobbyRow(page, 'neel').getByRole('button')).toHaveText(['Make picker']);
  await page.getByRole('button', { name: 'Make neel the picker' }).click();
  expect(server.posted('picker').at(-1)).toEqual({ action: 'picker', matchId: 'm1', username: 'neel' });
  await expect(lobbyRow(page, 'neel').locator('.tag')).toHaveText(['you, host', 'picker']);

  await page.getByRole('button', { name: 'Start match' }).click();
  expect(server.posted('start')).toHaveLength(1);
});

test('a player who is not the picker suggests with their pin, and the picker’s guess is everyone’s', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ settings: COOP, picker: 'sam', players: THREE });
  server.startRound(0);
  await enter(page, server);
  await coopRoundReady(page, 'sam places the guess. Your pin is a suggestion.');

  // the Guess button is the picker's: here it says so, pin or no pin
  const guess = page.getByRole('button', { name: 'sam guesses' });
  await expect(guess).toBeDisabled();
  await placePin(page, { x: 150, y: 150 });
  await expect.poll(() => server.pins.length).toBe(1);
  await expect(guess).toBeDisabled();

  // everyone's pin is on the map by name, the picker's among them
  server.matePin('sam', 10, 20);
  server.matePin('ana', -40, 10);
  await expect(page.locator('.pin-mate')).toHaveText(['sam', 'ana']);

  // sam guesses, and the round is over for everyone: one row, by the picker's name
  server.revealScores({ sam: 3000 });
  await expect(result(page)).toContainText('Next round in');
  const rows = result(page).getByRole('table', { name: 'Players' }).locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('td').first()).toHaveText('sampicker');
  await expect(rows).toContainText('3,000');
  expect(server.posted('guess')).toHaveLength(0);

  // the end has no winner and no table of points: what was made together, and who played
  server.finish(outcome([]));
  await expect(final(page)).toContainText('3,000 of 5,000 together.');
  await expect(final(page).getByRole('columnheader')).toHaveText(['Player', '']);
  await expect(final(page).locator('tbody tr')).toHaveCount(3);
  await expect(final(page).getByText('won')).toHaveCount(0);
});

test('the picker places the guess for everyone, and the host can pass the pick on during the match', async ({ page }) => {
  const server = await MatchServer.install(page);
  server.state = partyGame({ settings: COOP, picker: 'neel', players: THREE });
  server.startRound(0);
  await enter(page, server);
  await coopRoundReady(page, 'You place the guess for everyone.');

  await sendGuess(page, { x: 150, y: 150 });
  expect(server.posted('guess')).toHaveLength(1);
  server.revealScores({ neel: 4321 });
  const rows = result(page).getByRole('table', { name: 'Players' }).locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('td').first()).toHaveText('neelyoupicker');
  await expect(rows).toContainText('4,321');

  // the next round is someone else's to place: the host says whose
  await hostPanel(page).getByRole('button', { name: 'Host', exact: true }).click();
  await openActions(hostPanel(page), 'Actions for ana');
  await hostPanel(page).getByRole('button', { name: 'Make ana the picker' }).click();
  expect(server.posted('picker')).toEqual([{ action: 'picker', matchId: 'm1', username: 'ana' }]);
  server.startRound(1);
  await coopRoundReady(page, 'ana places the guess. Your pin is a suggestion.');
  await expect(page.getByRole('button', { name: 'ana guesses' })).toBeDisabled();
});
