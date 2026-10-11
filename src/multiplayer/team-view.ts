import type { MatchState, Team } from './client.ts';
import { START_HEALTH, teamRoundScores } from './state.ts';

/** Pure reading of a match's two teams: their points, and in 2v2 their health. No requests, no DOM. */

/** In 2v2 the team with the lower round score loses the gap times this. */
const TEAM_DAMAGE = 1.3;

export interface TeamRow {
  team: Team;
  /** the viewer's own team */
  isYours: boolean;
  /** what the team made of the round asked for: its best guess or its average, as the match scores teams. Null when no round was asked for */
  round: number | null;
  /** the team's points over every revealed round, as the server counts them */
  total: number;
  /** true once the match is over and this team's members are its winners */
  won: boolean;
}

export interface TeamHealthRow {
  team: Team;
  isYours: boolean;
  health: number;
  /** what the round asked for took off this team */
  lost: number;
  /** 0 to 1 of the starting health, for the bar */
  share: number;
}

const revealed = (state: MatchState, round: number | null): round is number => round !== null && state.results.some((result) => result.round === round);

/**
 * The two teams of a 2v2 or of a party with teams, team 1 first: empty for every other match.
 * `round` is the revealed round whose team scores to show, or null for none. Totals are the
 * server's own (`teams`), which leave out a kicked player and count a late joiner as it does.
 */
export function teamRows(state: MatchState, round: number | null): TeamRow[] {
  const scores = revealed(state, round) ? teamRoundScores(state, round) : null;
  const winners = new Set(state.outcome?.winners ?? []);
  return (state.teams ?? []).map((row) => ({
    team: row.team,
    isYours: state.you.team === row.team,
    round: scores === null ? null : scores[row.team],
    total: row.total,
    won: state.players.some((player) => player.team === row.team && winners.has(player.username)),
  }));
}

/** What one revealed round takes off a team: the gap to the other team's score times 1.3, when the other scored more. */
function damageIn(state: MatchState, round: number, team: Team): number {
  const scores = teamRoundScores(state, round);
  return Math.max(0, Math.round((scores[team === 0 ? 1 : 0] - scores[team]) * TEAM_DAMAGE));
}

/** The health a team went into a round with: what the rounds before it left of the 5000 it started on. */
function healthBefore(state: MatchState, round: number, team: Team): number {
  return state.results
    .map((result) => result.round)
    .filter((earlier) => earlier < round)
    .sort((a, b) => a - b)
    .reduce((health, earlier) => Math.max(0, health - damageIn(state, earlier, team)), START_HEALTH);
}

/**
 * Health in a 2v2, team 1 first: empty where teams have none. The health is the server's own.
 * `round` is the revealed round whose damage to show, or null for none: what the team went into
 * that round with, less what it has now.
 */
export function teamHealthRows(state: MatchState, round: number | null): TeamHealthRow[] {
  return (state.teams ?? []).flatMap((row) => {
    if (row.health === null) {
      return [];
    }
    return [
      {
        team: row.team,
        isYours: state.you.team === row.team,
        health: row.health,
        lost: revealed(state, round) ? Math.max(0, healthBefore(state, round, row.team) - row.health) : 0,
        share: Math.min(1, Math.max(0, row.health / START_HEALTH)),
      },
    ];
  });
}
