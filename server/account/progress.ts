/** XP for each country got right in a country streak. */
export const STREAK_XP = 20;

const SCORE_PER_XP = 50;
const XP_PER_LEVEL_SQUARED = 250;

// Highest first: a rating is in the first league whose floor it reaches.
const LEAGUES = [
  { name: 'Legend', from: 1800 },
  { name: 'Nomad', from: 1300 },
  { name: 'Voyager', from: 1000 },
  { name: 'Explorer', from: 800 },
] as const;
const LOWEST_LEAGUE = 'Trekker';

/** XP for the rounds of a game: a fiftieth of each round's score, so 100 for a perfect round. */
export const xpForScores = (scores: readonly number[]): number => scores.reduce((sum, score) => sum + Math.round(score / SCORE_PER_XP), 0);

export const xpForStreak = (streak: number): number => streak * STREAK_XP;

/** Levels get further apart as they go: level 2 at 250 XP, 3 at 1000, 4 at 2250. */
export const levelFor = (xp: number): number => Math.floor(Math.sqrt(xp / XP_PER_LEVEL_SQUARED)) + 1;

export const leagueFor = (rating: number): string => LEAGUES.find((league) => rating >= league.from)?.name ?? LOWEST_LEAGUE;
