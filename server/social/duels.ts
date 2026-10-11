/** A player's record in ranked duels, as their account and their profile show it. */
export interface DuelRecord {
  wins: number;
  losses: number;
  ties: number;
  /** Whole percent of all their duels, ties included, that they won. 0 before the first. */
  winRate: number;
  /** Their place on the rating board, or null when they are not on it. */
  rank: number | null;
}

export function duelRecord(counts: { duelWins: number; duelLosses: number; duelTies: number }, rank: number | null): DuelRecord {
  const { duelWins: wins, duelLosses: losses, duelTies: ties } = counts;
  const played = wins + losses + ties;
  return { wins, losses, ties, winRate: played === 0 ? 0 : Math.round((100 * wins) / played), rank };
}
