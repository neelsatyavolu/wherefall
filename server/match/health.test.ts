import { describe, expect, it } from 'vitest';
import { START_HEALTH, healthAfter, someoneIsOut } from './health.js';
import type { GuessRecord, PlayerRecord } from './types.js';

const player = (userId: string): PlayerRecord => ({ userId, username: userId, rating: 1000, seat: 0, team: null, lastSeenAt: 0, leftAt: null, joinedRound: 0, country: null, guest: false, ratedGames: 0, muted: [], pin: null, banned: false });
const guess = (userId: string, round: number, score: number): GuessRecord => ({ userId, round, lng: 0, lat: 0, distanceKm: 1, score });

const PLAYERS = [player('a'), player('b')];
const after = (guesses: GuessRecord[], rounds: number) => Object.fromEntries(healthAfter(PLAYERS, guesses, rounds));

describe('healthAfter', () => {
  it('starts both players at 5000', () => {
    expect(START_HEALTH).toBe(5000);
    expect(after([], 0)).toEqual({ a: 5000, b: 5000 });
  });

  it('takes the difference between the scores from the lower scorer, and nothing from the higher', () => {
    expect(after([guess('a', 0, 4000), guess('b', 0, 1500)], 1)).toEqual({ a: 5000, b: 2500 });
  });

  it('takes nothing from either when the scores are equal', () => {
    expect(after([guess('a', 0, 3000), guess('b', 0, 3000)], 1)).toEqual({ a: 5000, b: 5000 });
  });

  it('counts a round with no guess as a score of 0', () => {
    expect(after([guess('b', 0, 1200)], 1)).toEqual({ a: 3800, b: 5000 });
    expect(after([], 3)).toEqual({ a: 5000, b: 5000 });
  });

  it('adds the rounds up, each player losing the rounds they lost', () => {
    const guesses = [guess('a', 0, 5000), guess('b', 0, 4000), guess('a', 1, 1000), guess('b', 1, 3500), guess('a', 2, 2000), guess('b', 2, 2100)];
    expect(after(guesses, 1)).toEqual({ a: 5000, b: 4000 });
    expect(after(guesses, 2)).toEqual({ a: 2500, b: 4000 });
    expect(after(guesses, 3)).toEqual({ a: 2400, b: 4000 });
  });

  it('counts only the rounds asked for, so a round still being played shows nothing', () => {
    expect(after([guess('a', 0, 5000), guess('b', 0, 0), guess('a', 1, 5000)], 1)).toEqual({ a: 5000, b: 0 });
    expect(after([guess('a', 0, 100), guess('a', 1, 5000)], 1)).toEqual({ a: 5000, b: 4900 });
  });

  it('stops at 0', () => {
    expect(after([guess('a', 0, 5000), guess('a', 1, 5000)], 2)).toEqual({ a: 5000, b: 0 });
  });

  it('ignores a guess from someone who is not one of the players', () => {
    expect(after([guess('stranger', 0, 5000)], 1)).toEqual({ a: 5000, b: 5000 });
  });
});

describe('someoneIsOut', () => {
  it('is true once a player has no health left', () => {
    expect(someoneIsOut(healthAfter(PLAYERS, [guess('a', 0, 4999)], 1))).toBe(false);
    expect(someoneIsOut(healthAfter(PLAYERS, [guess('a', 0, 5000)], 1))).toBe(true);
  });
});
