import type { GuessRecord, PlayerRecord } from './types.js';

/** What both players of a ranked duel start with. */
export const START_HEALTH = 5000;

/**
 * Each player's health after the first `rounds` rounds of a ranked duel. In
 * every round the lower scorer loses the difference between the two scores; a
 * player who did not guess scored 0. Health only ever falls, and stops at 0.
 */
export function healthAfter(players: PlayerRecord[], guesses: GuessRecord[], rounds: number): Map<string, number> {
  const scoreOf = (userId: string, round: number): number => guesses.find((guess) => guess.userId === userId && guess.round === round)?.score ?? 0;
  const played = Array.from({ length: rounds }, (_unused, round) => round);
  const bestIn = (round: number): number => Math.max(0, ...players.map((player) => scoreOf(player.userId, round)));
  return new Map(
    players.map((player) => {
      const lost = played.reduce((sum, round) => sum + (bestIn(round) - scoreOf(player.userId, round)), 0);
      return [player.userId, Math.max(0, START_HEALTH - lost)];
    }),
  );
}

/** True once a player of the duel has no health left. */
export const someoneIsOut = (health: Map<string, number>): boolean => [...health.values()].some((left) => left <= 0);

/** A team's shared health in 2v2, and how much harder a lost round hits it than the difference alone. */
const TEAM_DAMAGE = 1.3;

/**
 * Each team's health after the first `rounds` rounds of a 2v2 match. A team's
 * round is its best member's score. The team with the lower one loses the
 * difference and three tenths more. Health only ever falls, and stops at 0.
 */
export function teamHealthAfter(players: PlayerRecord[], guesses: GuessRecord[], rounds: number): Map<0 | 1, number> {
  const teamOf = new Map(players.map((player) => [player.userId, player.team]));
  const bestOf = (team: 0 | 1, round: number): number =>
    Math.max(0, ...guesses.filter((guess) => guess.round === round && teamOf.get(guess.userId) === team).map((guess) => guess.score));
  const lostBy = (team: 0 | 1, other: 0 | 1): number =>
    Array.from({ length: rounds }, (_unused, round) => Math.round(Math.max(0, bestOf(other, round) - bestOf(team, round)) * TEAM_DAMAGE)).reduce(
      (sum, lost) => sum + lost,
      0,
    );
  return new Map([
    [0, Math.max(0, START_HEALTH - lostBy(0, 1))],
    [1, Math.max(0, START_HEALTH - lostBy(1, 0))],
  ]);
}
