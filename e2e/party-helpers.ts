import { expect, type Locator, type Page } from '@playwright/test';
import { type MatchState } from '../src/multiplayer/client.ts';
import { PLACES, guest, matchState, player, settings, teamRow, teamState, viewer } from '../src/multiplayer/testing.ts';
import { mockServices } from './fixtures.ts';
import { placePin } from './helpers.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';

/** What the two specs of parties and teams share: the matches they are played on, the ways into them, and where things are on the page. */

/** "neel" as a player who is not the host */
export const MEMBER = viewer();
export const NO_HEALTH = [teamRow(0, { health: null }), teamRow(1, { health: null })];

export const result = (page: Page) => page.getByRole('region', { name: 'Round result' });
export const final = (page: Page) => page.getByRole('region', { name: 'Final standing' });
export const lobbyTitle = (page: Page) => page.getByRole('heading', { name: 'Party', exact: true });
export const lobbyRows = (page: Page) => page.locator('.lobby-players .player-row');
export const lobbyRow = (page: Page, name: string) => lobbyRows(page).filter({ hasText: name });

/**
 * Opens a player's actions where their row has folded them behind its button of three dots: a narrow
 * row (a phone, a team's box, the Host panel). `label` is that button's name, `Actions for sam` in English.
 */
export const openActions = (scope: Page | Locator, label: string) => scope.getByRole('button', { name: label, exact: true }).click();
export const names = (page: Page) => page.locator('.lobby-players .player-name');
export const settingsLine = (page: Page) => page.locator('.lobby-settings .settings-line');
export const team = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
export const hostPanel = (page: Page) => page.getByRole('complementary', { name: 'Host controls' });
export const foldedChat = (page: Page) => page.getByRole('complementary', { name: 'Chat' });
export const teamHealth = (page: Page) => page.getByRole('complementary', { name: 'Team health' });
export const roundNote = (page: Page) => page.locator('.round-note');
export const rounds = (page: Page) => page.getByRole('slider', { name: 'Rounds' });
export const time = (page: Page) => page.getByRole('slider', { name: 'Time per round' });

export async function sendGuess(page: Page, at: { x: number; y: number }): Promise<void> {
  await placePin(page, at);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guess sent' })).toBeDisabled();
}

/** Puts the signed-in "neel" in the server's match, lobby or round, by way of the home screen's Rejoin. */
export async function enter(page: Page, server: MatchServer, rejoin = 'Rejoin match'): Promise<void> {
  server.matchFound(server.state.id);
  await signIn(page, 'neel', 1016);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: rejoin }).click();
}

/** A party with its places posted, about to play, seen by "neel": its host unless `you` says otherwise. */
export const partyGame = (change: Partial<MatchState> = {}) => matchState({ players: [player('neel'), player('sam')], phase: 'preparing', places: PLACES, ...change });

/** A party with teams: "neel" and "sam" against "ana" and "kit". */
export const teamParty = (mode: 'best' | 'average', change: Partial<MatchState> = {}) =>
  partyGame({
    settings: settings({ teams: mode }),
    you: viewer({ team: 0 }),
    players: [player('neel', { team: 0 }), player('sam', { team: 0 }), player('ana', { team: 1 }), player('kit', { team: 1 })],
    teams: NO_HEALTH,
    ...change,
  });

/** A 2v2 about to play, seen by "neel", whose teammate is "sam". */
export const twoVersusTwo = () => teamState({ id: 'm8', phase: 'preparing', you: viewer({ team: 0 }), places: FIVE_PLACES });

export const seat = (state: MatchState, username: string, to: 0 | 1): MatchState => ({ ...state, players: state.players.map((p) => (p.username === username ? { ...p, team: to } : p)) });

/** Twenty players: the host, accounts with and without a country, and guests, some on a team. */
export const TWENTY = [
  player('neel', { team: 0 }),
  ...Array.from({ length: 13 }, (_, index) => player(`player_${String(index + 1).padStart(2, '0')}`, { country: index % 3 === 0 ? 'DE' : null, team: index % 3 === 2 ? null : ((index % 2) as 0 | 1) })),
  ...Array.from({ length: 6 }, (_, index) => guest(7300 + index, { team: index % 2 === 0 ? 1 : null })),
];
export const TWENTY_NAMES = TWENTY.map((p) => p.username);
export const fullParty = () => matchState({ settings: settings({ teams: 'best', timeLimit: 0, rounds: 20 }), teams: NO_HEALTH, you: viewer({ isHost: true, isResolver: true, team: 0 }), players: TWENTY, locked: true });
