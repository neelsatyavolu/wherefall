import type { SavedGame } from '../account/input.js';
import type { StoredGame, StoredRound } from '../db/games.js';
import { distanceKm, scoreForDistance } from '../match/scoring.js';
import { checkPlaces, type CommunityRow, type Place } from '../places/check.js';

type Round = SavedGame['rounds'][number];

export interface CheckedGame {
  /** The game as it will be stored. */
  game: StoredGame;
  /** Its places as the server knows them, in the order played. */
  places: Place[];
  /** Which of the two lists the places are from; null for a map a player made. */
  list: number | null;
}

/**
 * The round as it will be stored: on the place as the server knows it, with
 * the distance and the score the server works out from where the guess was.
 * A hint halves the score, rounding down. A round with no guess scores nothing.
 */
function scoredRound(round: Round, place: Place, scaleKm: number): StoredRound {
  const hinted = round.hinted ?? false;
  const kept = { country: place.country, lng: place.lng, lat: place.lat, hinted };
  if (typeof round.guessLng !== 'number' || typeof round.guessLat !== 'number') {
    return { ...kept, distanceKm: null, score: 0, guessLng: null, guessLat: null };
  }
  const guess = { lng: round.guessLng, lat: round.guessLat };
  const distance = distanceKm(place, guess);
  const score = scoreForDistance(distance, scaleKm);
  return { ...kept, distanceKm: distance, score: hinted ? Math.floor(score / 2) : score, guessLng: guess.lng, guessLat: guess.lat };
}

/**
 * The game as it will be stored: every round on a place of the game's map as
 * the server has it, scored by the server on the scale the server gives the
 * map. Null when a place is not one of the map's. `community` is the map's
 * own places when the map is one a player made, and is the caller's to load.
 *
 * This stops made-up places, scores and scales; it cannot stop a player
 * reading the answer out of their own browser, which nothing in a browser
 * game can.
 */
export function checkedGame(game: SavedGame, community: readonly CommunityRow[] | null = null): CheckedGame | null {
  const checked = checkPlaces(game.map, game.rounds, community);
  if (!checked) {
    return null;
  }
  const { places, scaleKm, list } = checked;
  const rounds = places.flatMap((place, index) => {
    const round = game.rounds[index];
    return round ? [scoredRound(round, place, scaleKm)] : [];
  });
  const { map, mode, timeLimit, seed, daily } = game;
  return { game: { map, mode, timeLimit, seed, ...(daily === undefined ? {} : { daily }), rounds }, places, list };
}
