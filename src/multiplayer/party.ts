import { matchAction, type MatchState, type PartySettings, type Reply, type Team } from './client.ts';

/**
 * What only a party can be sent. All but `chooseTeam` are for its host; anyone else is told
 * "Only the host can do that." Each answers with the match, unchanged when the action does not
 * apply to the phase the party is in.
 */

/** Host, in the lobby: replaces the party's settings. */
export function configureParty(matchId: string, settings: PartySettings, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'configure', matchId, settings });
}

/** Any player, in the lobby of a party with teams: takes a seat on one of the two. */
export function chooseTeam(matchId: string, team: Team, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'team', matchId, team });
}

/** Host, in the lobby of a party with teams: splits the players at random into two even teams. */
export function shuffleTeams(matchId: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'shuffle', matchId });
}

/** Host, in any phase: puts a player out for good. Their guesses leave every round's results. */
export function kickPlayer(matchId: string, username: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'kick', matchId, username });
}

/** Host, in any phase but `preparing`: hands the party to another player, who must have an account. */
export function makeHost(matchId: string, username: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'host', matchId, username });
}

/** Host: closes the party to new players, or opens it again. */
export function lockParty(matchId: string, locked: boolean, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'lock', matchId, locked });
}

/** Host, while a round is being played: ends it now and reveals it. The way on when there is no timer. */
export function endRound(matchId: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'endRound', matchId });
}

/** Host of a finished party: takes everyone still there back to its lobby, with the same code and settings. */
export function backToLobby(matchId: string, fetchFn: typeof fetch = fetch): Reply<MatchState> {
  return matchAction(fetchFn, { action: 'lobby', matchId });
}
