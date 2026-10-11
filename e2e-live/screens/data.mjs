// What the stand-in servers are filled with for the review: enough players, games and days that
// every list, chart and table is drawn as it is when the site is busy.
import { FIVE_PLACES } from '../../e2e/match-server.ts';
import { friend } from '../../e2e/social-server.ts';
import { PARIS as PARIS_MAP, MINE } from '../../e2e/maps-server.ts';
import { dailySeed } from '../../e2e/place-rules.ts';
import { drawDaily } from '../../src/daily/draw.ts';
import { destination } from '../../src/game/geo.ts';
import { KIND_SETTINGS, PLACES, guest, matchState, player, rankedState, settings, teamRow, teamState, viewer } from '../../src/multiplayer/testing.ts';
import { RATING, ago, countryOf, crowd, day, person } from './world.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A friend as the lists hold one of the world's players: their own flag, level and league. */
const friendOf = (username, change = {}) => {
  const who = person(username);
  return friend(username, { country: who.country, level: who.level, league: who.league, ...change });
};

/** Friends of every standing: online and in a party, seen hours ago, never seen; a request each way and an invite. */
export const friendsList = () => ({
  friends: [
    friendOf('sam', { party: 'ABC123', online: true, lastSeenAt: ago(30_000) }),
    friendOf('ana', { lastSeenAt: ago(3 * HOUR_MS) }),
    friendOf('raj', { lastSeenAt: ago(2 * DAY_MS) }),
    // a name the world does not know: a friend who has never played
    friend('zoe'),
  ],
  incoming: ['kit'],
  outgoing: ['lee'],
  invites: [{ from: 'sam', code: 'ABC123' }],
});

export const NO_FRIENDS = { friends: [], incoming: [], outgoing: [], invites: [] };

/** The fourteen days before today, some missed. */
export const dailyHistory = () => Array.from({ length: 13 }, (_, i) => ({ date: day(13 - i), score: i % 4 === 0 ? null : 8000 + i * 450 }));

/** How far under a total the best of the days before it is, for that total to be a personal best by a little. */
const JUST_UNDER = 0.93;

/** The fourteen days before today for an account whose best daily was a little under `total`. */
export function dailyHistoryUnder(total) {
  const days = dailyHistory();
  const best = Math.max(...days.map((each) => each.score ?? 0));
  return days.map((each) => ({ ...each, score: each.score === null ? null : Math.round((each.score * JUST_UNDER * total) / best / 10) * 10 }));
}

/** What an account's records are when those days are all the dailies it has played. */
export function recordsOf(days) {
  const scores = days.flatMap((each) => (each.score === null ? [] : [each.score]));
  return { played: scores.length, best: Math.max(0, ...scores), average: scores.length === 0 ? 0 : Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) };
}

/** The three places of a day's daily on a list of places, as the game draws them. */
export const dailyPlacesOn = (places, date) =>
  drawDaily(
    places.locations.map(([id, lng, lat, country]) => ({ id, lng, lat, country })),
    dailySeed(date),
  );

/**
 * A visitor's daily result as this browser keeps it: on the day's places, with the token the server
 * answered its start with, which is what lets an account made later take it over. With no token
 * and no places it is a result as a browser kept it before starts had tokens: shown, and offered
 * to nobody.
 */
export const keptDaily = (date, scores, token = null, places = null) => {
  const rounds = scores.map((score, index) => {
    const place = places?.[index] ?? { country: 'FR', lng: 2, lat: 48 };
    return { ...(places ? { id: place.id } : {}), country: place.country, distanceKm: 100, score, lng: place.lng, lat: place.lat, guessLng: place.lng + 0.5, guessLat: place.lat + 0.5, hinted: false };
  });
  return JSON.stringify({ started: date, ...(token ? { token } : {}), results: [{ daily: date, ...(token ? { token } : {}), rounds }], claim: null });
};

/** Maps for the lists: one liked, one the player's own, and a few more by others. */
export function fillMaps(maps) {
  maps.maps = [{ ...PARIS_MAP, liked: true, likes: 4 }, { ...MINE, description: 'The west coast, north to south.', details: 'Lisbon to Porto along the water.' }];
  maps.addMany(3);
}

// --- matches ---------------------------------------------------------------------------------------

export const MEMBER = viewer();
export const HOST = viewer({ isHost: true, isResolver: true });
export const NO_HEALTH = [teamRow(0, { health: null }), teamRow(1, { health: null })];

/** A party about to play, seen by "neel": its host unless `you` says otherwise. */
export const partyGame = (change = {}) => matchState({ players: [player('neel', { country: 'IN' }), player('sam', { country: 'GB' })], phase: 'preparing', places: PLACES, ...change });

/** A public unranked game of eight, seen by "neel". */
export const eightPlayers = (change = {}) =>
  matchState({
    id: 'm9',
    code: null,
    kind: 'unranked',
    phase: 'preparing',
    settings: KIND_SETTINGS.unranked,
    you: MEMBER,
    players: [player('neel', { country: 'IN' }), ...['ana', 'sam', 'kit', 'lee', 'mia', 'raj'].map((name) => player(name, { country: countryOf(name) })), guest(7302)],
    places: FIVE_PLACES,
    ...change,
  });

/** A ranked duel about to play: "neel" against "sam", each with a flag. */
export const duel = (change = {}) =>
  rankedState({
    id: 'm7',
    phase: 'preparing',
    you: MEMBER,
    places: FIVE_PLACES,
    players: [player('neel', { rating: RATING, health: 5000, country: 'IN' }), player('sam', { rating: person('sam').rating, health: 5000, country: 'GB' })],
    ...change,
  });

/** What that duel does to the two ratings when "sam" wins it. */
const DUEL_STAKE = 17;
export const RATING_CHANGES = [
  { username: 'neel', before: RATING, after: RATING - DUEL_STAKE },
  { username: 'sam', before: person('sam').rating, after: person('sam').rating + DUEL_STAKE },
];

/** A 2v2 about to play, seen by "neel", whose teammate is "sam". */
export const twoVersusTwo = (change = {}) =>
  teamState({
    id: 'm8',
    phase: 'preparing',
    you: viewer({ team: 0 }),
    places: FIVE_PLACES,
    players: [player('neel', { team: 0, country: 'IN' }), player('sam', { team: 0, country: 'GB' }), player('ana', { team: 1, country: 'BR' }), player('kit', { team: 1, country: 'DE' })],
    ...change,
  });

/** A party of four in two teams, scored by each team's best guess. */
export const teamParty = (change = {}) =>
  partyGame({
    settings: settings({ teams: 'best' }),
    you: viewer({ isHost: true, isResolver: true, team: 0 }),
    players: [player('neel', { team: 0, country: 'IN' }), player('sam', { team: 0, country: 'GB' }), player('ana', { team: 1, country: 'BR' }), player('kit', { team: 1, country: 'DE' })],
    teams: NO_HEALTH,
    ...change,
  });

/** Twenty players: the host, accounts with and without a country, and guests. `seated` puts some of them on teams. */
export const twenty = (seated) => [
  player('neel', { country: 'IN', team: seated ? 0 : null }),
  ...Array.from({ length: 13 }, (_, index) => player(`player_${String(index + 1).padStart(2, '0')}`, { country: index % 3 === 0 ? 'DE' : null, team: !seated || index % 3 === 2 ? null : index % 2 })),
  ...Array.from({ length: 6 }, (_, index) => guest(7300 + index, { team: seated && index % 2 === 0 ? 1 : null })),
];

/** A full party in its lobby with teams, no timer and twenty rounds, locked, seen by its host. */
export const fullLobby = () =>
  matchState({ settings: settings({ teams: 'best', timeLimit: 0, rounds: 20 }), teams: NO_HEALTH, you: viewer({ isHost: true, isResolver: true, team: 0 }), players: twenty(true), locked: true });

/** A full party about to play, without teams. */
export const fullParty = (change = {}) => partyGame({ players: twenty(false), ...change });

/** a party is full at forty */
const FULL_PARTY = 40;
/** one in this many of a full party's other players is a guest */
const A_GUEST_IN = 6;
/** in a lobby still picking teams, one in this many has none yet */
const UNSEATED_IN = 5;

/**
 * Forty players, a school class: the host "neel", players of the world with and without a country,
 * and a guest among every six. `seats` puts them on two teams: `all` of them, or all but `some`.
 */
export function forty(seats = 'none') {
  const others = crowd(FULL_PARTY - 1).map((each, index) => (index % A_GUEST_IN === 4 ? guest(7300 + index) : player(each.username, { country: each.country })));
  const teamOf = (index) => (seats === 'none' || (seats === 'some' && index % UNSEATED_IN === 3) ? null : index % 2);
  return [player('neel', { country: 'IN' }), ...others].map((each, index) => ({ ...each, team: teamOf(index) }));
}

/** A full party of forty in its lobby, five rounds of two minutes, seen by its host "neel". */
export const fortyLobby = (change = {}) => matchState({ id: 'm40', settings: settings({ rounds: 5, timeLimit: 120 }), you: HOST, players: forty(), ...change });

/** That party picking two teams, a few players still without one. */
export const fortyTeamLobby = (change = {}) =>
  fortyLobby({ settings: settings({ rounds: 5, timeLimit: 120, teams: 'best' }), teams: NO_HEALTH, you: viewer({ isHost: true, isResolver: true, team: 0 }), players: forty('some'), ...change });

/** The party of forty about to play, without teams. */
export const fortyParty = (change = {}) => fortyLobby({ phase: 'preparing', places: FIVE_PLACES, ...change });

/** And in two teams of twenty. */
export const fortyTeamParty = (change = {}) =>
  fortyParty({ settings: settings({ rounds: 5, timeLimit: 120, teams: 'best' }), teams: NO_HEALTH, you: viewer({ isHost: true, isResolver: true, team: 0 }), players: forty('all'), ...change });

/** Each player's score for a round in which "neel" comes in at `place`: the others fall from the top in steps, in their order. */
export function scoresAround(players, place, top = 4950, step = 118) {
  const others = players.filter((each) => each.username !== 'neel');
  const order = [...others.slice(0, place - 1), players.find((each) => each.username === 'neel'), ...others.slice(place - 1)];
  return Object.fromEntries(order.map((each, index) => [each.username, Math.max(0, top - index * step)]));
}

/** A match in teams with each team's total as the rounds played so far make it: the best guess of the team in each. */
export function withTeamTotals(state) {
  const best = (team, guesses) => Math.max(0, ...guesses.filter((each) => state.players.find((p) => p.username === each.username)?.team === team).map((each) => each.score));
  return { ...state, teams: state.teams.map((row) => ({ ...row, total: state.results.reduce((sum, round) => sum + best(row.team, round.guesses), 0) })) };
}

/** Whoever has the highest total: the winner of a match that is over. */
export const leader = (players) => [...players].sort((a, b) => b.total - a.total)[0].username;

/** Each player's score for a round, falling from the first player to the last. */
export const fallingScores = (players, top = 5000, step = 240) => Object.fromEntries(players.map((p, index) => [p.username, Math.max(0, top - index * step)]));

/** the game's scoring on the world map (src/game/scoring.ts): 5,000 on the spot, falling off as e^(-10 × distance / 20,000 km) */
const MAX_ROUND_SCORE = 5000;
const WORLD_SCALE_KM = 20_000;
const DECAY = 10;
/** How far from the place a guess with this score was: the scoring run backwards. A score of nothing is most of the way round the world. */
const kmFor = (score) => (-WORLD_SCALE_KM / DECAY) * Math.log(Math.max(score, 1) / MAX_ROUND_SCORE);
/** turning by this much each time never lines two neighbours up */
const GOLDEN_ANGLE_DEG = 137.5;

/**
 * The round a stand-in match server has just revealed, with every guess where a player with that
 * score would have put it: as far from the place as the score says, each in a direction of their
 * own, so a good round is a cluster round the place with the worst guesses a continent away. The
 * mock itself lays the other players' guesses out in a row along one latitude, each said to be
 * 900 km off, and says the viewer's own was 321 km off whatever it scored, which no party of
 * players would do. The viewer's guess is moved too: where the scene happened to click says nothing
 * about the score the scene then gives it.
 */
export function spreadGuesses(state) {
  const last = state.results.at(-1);
  const place = last ? state.places[last.round] : undefined;
  if (!last || !place) {
    return state;
  }
  const guesses = last.guesses.map((each, index) => {
    if (each.lng === null) {
      return each;
    }
    const km = kmFor(each.score);
    return { ...each, ...destination(place, (index * GOLDEN_ANGLE_DEG) % 360, km), distanceKm: km };
  });
  return { ...state, results: [...state.results.slice(0, -1), { ...last, guesses }] };
}

/** Spreads the guesses of the round a scene has just had its match server reveal. */
export function spreadReveal(match) {
  match.state = spreadGuesses(match.state);
}
