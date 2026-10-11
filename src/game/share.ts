import { MAX_ROUND_SCORE } from './scoring.ts';

/** A finished game as a few lines of text to paste somewhere: no place is given away, only how each round went. */

/** the share of a round's most that earns each colour, best first; anything lower is the last one */
const SQUARES: ReadonlyArray<readonly [from: number, square: string]> = [
  [0.8, '🟩'],
  [0.5, '🟨'],
  [0.2, '🟧'],
];
const LOWEST_SQUARE = '🟥';

/** One coloured square for a round: green from four fifths of the most, yellow from half, orange from a fifth, else red. */
export function shareSquare(score: number, roundMax: number = MAX_ROUND_SCORE): string {
  const share = roundMax > 0 ? score / roundMax : 0;
  return SQUARES.find(([from]) => share >= from)?.[1] ?? LOWEST_SQUARE;
}

export const shareSquares = (scores: readonly number[], roundMax: number = MAX_ROUND_SCORE): string => scores.map((score) => shareSquare(score, roundMax)).join('');

export interface ShareGame {
  /** the first line: the game's name and what was played, such as "Wherefall · World" */
  title: string;
  score: number;
  maxScore: number;
  /** each round's score, in the order played */
  roundScores: readonly number[];
  /** the most one round can score; 5,000 unless said */
  roundMax?: number;
  /** lines to put between the score and the squares, such as how many players were beaten; empty ones are left out */
  extra?: readonly string[];
  /** where the same game can be played */
  url: string;
  /** how to write a number; plain digits unless said */
  formatNumber?: (value: number) => string;
}

/** The text "Share result" copies: the title, the score out of the most, a square a round, and the link. */
export function shareText(game: ShareGame): string {
  const write = game.formatNumber ?? String;
  return [game.title, `${write(game.score)} / ${write(game.maxScore)}`, ...(game.extra ?? []), shareSquares(game.roundScores, game.roundMax), game.url]
    .filter((line) => line !== '')
    .join('\n');
}
