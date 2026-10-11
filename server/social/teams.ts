/** A player's record in 2v2, as their account and their profile show it beside their duels. */
export interface TeamRecord {
  wins: number;
  losses: number;
  ties: number;
  /** Whole percent of all their 2v2 matches, ties included, that their team won. 0 before the first. */
  winRate: number;
}

export function teamRecord(counts: { teamWins: number; teamLosses: number; teamTies: number }): TeamRecord {
  const { teamWins: wins, teamLosses: losses, teamTies: ties } = counts;
  const played = wins + losses + ties;
  return { wins, losses, ties, winRate: played === 0 ? 0 : Math.round((100 * wins) / played) };
}
