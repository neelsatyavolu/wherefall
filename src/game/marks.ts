import { MAX_ROUND_SCORE } from './scoring.ts';

/** What a result says about a score beyond the number: the Perfect mark, confetti, stars and XP. */

/** a round this good or better gets confetti */
const CONFETTI_FROM = 4850;
/** the share of the most a game could score that earns two stars, and three */
const TWO_STARS_FROM = 0.5;
const THREE_STARS_FROM = 0.8;
const SCORE_PER_XP = 50;

export const isPerfect = (score: number): boolean => score >= MAX_ROUND_SCORE;

export const earnsConfetti = (score: number): boolean => score >= CONFETTI_FROM;

export type Stars = 1 | 2 | 3;

/** One to three stars for a finished game, by its share of the most it could have scored. */
export function starsFor(score: number, maxScore: number): Stars {
  const share = maxScore > 0 ? score / maxScore : 0;
  return share >= THREE_STARS_FROM ? 3 : share >= TWO_STARS_FROM ? 2 : 1;
}

/** The XP a round earns where rounds earn XP at all (not on community maps): its score over 50. */
export const roundXp = (score: number): number => Math.round(score / SCORE_PER_XP);
