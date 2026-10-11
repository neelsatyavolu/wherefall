import { expect, type Page } from '@playwright/test';
import type { MatchOutcome, MatchState } from '../src/multiplayer/client.ts';
import { KIND_SETTINGS, guest, matchState, outcome, player, rankedState, settings, teamRow, teamState, viewer } from '../src/multiplayer/testing.ts';
import { mockServices } from './fixtures.ts';
import { play, roundReady } from './helpers.ts';
import { CATALOGS, type Catalog } from './language-checks.ts';
import { FIVE_PLACES, MatchServer, signIn } from './match-server.ts';

/**
 * The matches the design checks are made on, each seen by the signed-in "neel" with its first
 * round under way: a ranked duel, a public game of eight, a party of twenty with "neel" its host
 * and no timer, a full party of forty (and one in two teams), a 2v2, and a party of six in two
 * teams. The names are as long as names get.
 */

export type SceneName = 'ranked' | 'eight' | 'twenty' | 'forty' | 'fortyTeams' | 'team' | 'teamParty';

export interface Scene {
  state: MatchState;
  /** every name a player typed, which no catalog has */
  names: string[];
  /** what each player scores in the round that is revealed */
  scores: Record<string, number>;
  /** how the match ends */
  outcome: MatchOutcome;
}

/**
 * How long a change on the server may take to be seen on the page. A match of more than twenty
 * players is asked for every four seconds, so the wait for one poll is longer than a test's usual five.
 */
export const SEEN_MS = 12_000;

const COUNTRIES = ['PL', 'BR', 'JP', 'DE', 'FR', 'IN', 'MX', 'SE', 'KR', 'NG'] as const;
const LONG_NAMES = ['aleksandra_wojcik_92', 'maximilian_wanderer', 'ana', 'kit', 'yuki_tanaka', 'o', 'bartholomew_fitzroy', 'sam'];

/** `count` other players: long names, short ones, and a guest among every six. */
function others(count: number): MatchState['players'] {
  return Array.from({ length: count }, (_, index) => {
    const country = COUNTRIES[index % COUNTRIES.length]!;
    if (index % 6 === 4) {
      return guest(4800 + index);
    }
    const base = LONG_NAMES[index % LONG_NAMES.length]!;
    return player(index < LONG_NAMES.length ? base : `${base.slice(0, 16)}_${index}`, { country });
  });
}

const playing = { phase: 'playing', places: FIVE_PLACES } as const;
/** every other player scores a little less than the one before; "neel" comes in near the top */
const spread = (state: MatchState): Record<string, number> => Object.fromEntries(state.players.map((p, index) => [p.username, p.username === 'neel' ? 4321 : Math.max(0, 4900 - index * 230)]));

function ranked(): Scene {
  const rival = 'aleksandra_wojcik_92';
  const state = rankedState({
    ...playing,
    id: 'm2',
    you: viewer(),
    players: [player('neel', { rating: 1016, health: 5000, country: 'US' }), player(rival, { rating: 1004, health: 5000, country: 'PL' })],
  });
  return {
    state,
    names: ['neel', rival],
    scores: { neel: 4321, [rival]: 1100 },
    outcome: outcome(['neel'], { ratingChanges: [{ username: 'neel', before: 1016, after: 1033 }, { username: rival, before: 1004, after: 987 }] }),
  };
}

function eight(): Scene {
  const players = [...others(7), player('neel', { country: 'US' })];
  const state = matchState({ ...playing, id: 'm3', code: null, kind: 'unranked', settings: KIND_SETTINGS.unranked, you: viewer(), players });
  return { state, names: players.map((p) => p.username), scores: spread(state), outcome: outcome([players[0]!.username]) };
}

function twenty(): Scene {
  const players = [player('neel', { country: 'US' }), ...others(19)];
  const state = matchState({ ...playing, id: 'm4', settings: settings({ timeLimit: 0, rounds: 5 }), you: viewer({ isHost: true }), players });
  return { state, names: players.map((p) => p.username), scores: spread(state), outcome: outcome([players[1]!.username]) };
}

function team(): Scene {
  const mates = ['neel', 'maximilian_wanderer', 'aleksandra_wojcik_92', 'kit'];
  const state = teamState({
    ...playing,
    id: 'm5',
    you: viewer({ team: 0 }),
    players: mates.map((name, index) => player(name, { team: index < 2 ? 0 : 1, country: COUNTRIES[index]! })),
  });
  return { state, names: mates, scores: { neel: 4321, maximilian_wanderer: 2100, aleksandra_wojcik_92: 3900, kit: 800 }, outcome: outcome(['neel', 'maximilian_wanderer']) };
}

function teamParty(): Scene {
  const names = ['neel', 'maximilian_wanderer', 'yuki_tanaka', 'aleksandra_wojcik_92', 'kit', 'bartholomew_fitzroy'];
  const state = matchState({
    ...playing,
    id: 'm6',
    settings: settings({ teams: 'average', timeLimit: 120 }),
    you: viewer({ team: 0 }),
    players: names.map((name, index) => player(name, { team: index < 3 ? 0 : 1, country: COUNTRIES[index]! })),
    teams: [teamRow(0, { health: null }), teamRow(1, { health: null })],
  });
  return { state, names, scores: spread(state), outcome: outcome(names.slice(3)) };
}

/** A full party: forty players with "neel" its host, on a timer. */
function forty(): Scene {
  const players = [player('neel', { country: 'US' }), ...others(39)];
  const state = matchState({ ...playing, id: 'm7', settings: settings({ timeLimit: 120, rounds: 5 }), you: viewer({ isHost: true }), players });
  return { state, names: players.map((p) => p.username), scores: spread(state), outcome: outcome([players[1]!.username]) };
}

/** A full party in two teams of twenty, "neel" its host. */
function fortyTeams(): Scene {
  const players = [player('neel', { country: 'US' }), ...others(39)].map((each, index) => ({ ...each, team: (index % 2) as 0 | 1 }));
  const state = matchState({
    ...playing,
    id: 'm8',
    settings: settings({ teams: 'best', timeLimit: 120, rounds: 5 }),
    you: viewer({ team: 0, isHost: true }),
    players,
    teams: [teamRow(0, { health: null }), teamRow(1, { health: null })],
  });
  return { state, names: players.map((p) => p.username), scores: spread(state), outcome: outcome(players.filter((p) => p.team === 1).map((p) => p.username)) };
}

export const SCENES: Record<SceneName, () => Scene> = { ranked, eight, twenty, forty, fortyTeams, team, teamParty };

/**
 * Every text on a scene's screens that a player typed and no catalog has: the names, the pieces a
 * long name is drawn in (it may go onto a second line after an underscore), and the three letters
 * a player's pin wears on the map.
 */
export const typedIn = (scene: Scene): string[] => [...scene.names, ...scene.names.flatMap((name) => name.split(/(?<=[_.-])/)), ...scene.names.map((name) => name.slice(0, 3).toUpperCase())];

/**
 * Opens the scene's match in `code`, with its first round ready to be played. The round lasts five
 * minutes unless the match has no timer. With `leadMs`, the round takes that long to start and is
 * not waited for: the get-ready (a duel's versus screen) is what is on the page. `account` changes
 * what the signed-in account is (its Hide chat setting, say).
 */
export async function openScene(page: Page, name: SceneName, code: string, leadMs?: number, account: Parameters<typeof signIn>[3] = {}): Promise<{ server: MatchServer; scene: Scene; say: Catalog }> {
  const scene = SCENES[name]();
  const say = CATALOGS[code]!;
  const server = await MatchServer.install(page);
  server.leadMs = leadMs ?? server.leadMs;
  server.state = scene.state;
  server.startRound(0, scene.state.settings.timeLimit === 0 ? 0 : 300_000);
  server.matchFound(scene.state.id);
  await signIn(page, 'neel', 1016, account);
  await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
  if (leadMs === undefined) {
    await roundReady(page);
  }
  return { server, scene, say };
}

/** Places a pin and sends it: through the map's sheet on a phone, which is closed again after. */
export async function guessInScene(page: Page, say: Catalog): Promise<void> {
  const phone = page.viewportSize()!.width <= 720;
  if (phone) {
    await page.getByRole('button', { name: say['round.openMap'] }).click();
  } else {
    await page.locator('.map-panel').hover();
  }
  await page.locator('.map-panel .maplibregl-canvas').click({ position: { x: 150, y: 150 } });
  await page.getByRole('button', { name: say['round.guess'], exact: true }).click();
  await expect(page.getByRole('button', { name: say['match.guessSent'] })).toBeDisabled();
  if (phone) {
    await page.getByRole('button', { name: say['round.closeMap'] }).click();
  }
}

/** The first `count` of the other players send their guesses. The round then runs on for five minutes, however few are left to guess. */
export function othersGuess(server: MatchServer, scene: Scene, count: number): void {
  scene.names
    .filter((name) => name !== 'neel')
    .slice(0, count)
    .forEach((name) => server.opponentGuesses(name));
  if (server.state.roundEndsAt !== null) {
    server.endRoundIn(300_000);
  }
}

/** Ends the round with the scene's scores. */
export async function revealScene(page: Page, server: MatchServer, scene: Scene): Promise<void> {
  server.revealScores(scene.scores);
  await expect(play(page)).toHaveAttribute('data-phase', 'result', { timeout: SEEN_MS });
}

export async function finishScene(page: Page, server: MatchServer, scene: Scene): Promise<void> {
  server.finish(scene.outcome);
  await expect(play(page)).toHaveAttribute('data-phase', 'summary', { timeout: SEEN_MS });
}

/** A scene's party back in its lobby, seen by "neel": its host unless `host` is false. `unseat` leaves every fifth player without a team. */
export function lobbyOf(name: SceneName, host = true, unseat = false): MatchState {
  const { state } = SCENES[name]();
  const players = unseat ? state.players.map((each, index) => (index % 5 === 3 ? { ...each, team: null } : each)) : state.players;
  return { ...state, phase: 'lobby', places: null, players, you: { ...state.you, isHost: host, isResolver: host } };
}

export async function openLobby(page: Page, state: MatchState, code = 'en'): Promise<{ server: MatchServer; say: Catalog }> {
  const say = CATALOGS[code]!;
  const server = await MatchServer.install(page);
  server.state = state;
  server.matchFound(state.id);
  await signIn(page, 'neel', 1016);
  await page.addInitScript((language) => localStorage.setItem('plonk.language', language), code);
  await mockServices(page);
  await page.goto('/');
  await page.getByRole('button', { name: say['home.resume.rejoin'] }).click();
  await expect(page.locator('.lobby-players .player-row').first()).toBeVisible();
  return { server, say };
}
