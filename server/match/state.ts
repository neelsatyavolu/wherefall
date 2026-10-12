import { healthAfter, teamHealthAfter } from './health.js';
import { hasTeams, isActive, isCoop, pickerOf, sideTotals } from './machine.js';
import type { GuessRecord, MatchRecord, MatchState, PlayerRecord, Snapshot } from './types.js';

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * How many rounds every player may see the guesses of. The round being
 * played is not one of them: it joins when it is revealed.
 */
function revealedRounds(match: MatchRecord): number {
  if (match.places === null || match.phase === 'lobby' || match.phase === 'preparing') {
    return 0;
  }
  return match.phase === 'playing' ? match.round : match.round + 1;
}

/** Each team's standing over the revealed rounds, where there are teams. */
function teamsOf(match: MatchRecord, players: PlayerRecord[], guesses: GuessRecord[], revealed: number): MatchState['teams'] {
  if (!hasTeams(match)) {
    return null;
  }
  const totals = sideTotals(match, players, guesses, revealed);
  const health = match.kind === 'team' ? teamHealthAfter(players, guesses, revealed) : null;
  return ([0, 1] as const).map((team) => ({ team, health: health?.get(team) ?? null, total: totals.get(`team${team}`) ?? 0 }));
}

/**
 * Where the asker's teammates (in co-op, everyone else) have their pins in
 * the round being played: their guess once they have made it, otherwise
 * where they last said their pin was. Never an opponent's, and nothing
 * outside a round.
 */
function matesOf({ match, players, guesses }: Snapshot, you: PlayerRecord): MatchState['mates'] {
  const together = isCoop(match) || (hasTeams(match) && you.team !== null);
  if (match.phase !== 'playing' || !together) {
    return [];
  }
  return players
    .filter((player) => player.team === you.team && player.userId !== you.userId)
    .flatMap((mate) => {
      const guess = guesses.find((made) => made.userId === mate.userId && made.round === match.round);
      const pin = guess ?? (mate.pin?.round === match.round ? mate.pin : null);
      return pin ? [{ username: mate.username, lng: pin.lng, lat: pin.lat, guessed: guess !== undefined }] : [];
    });
}

/** The chat the asker may see: nothing from players they muted, and nothing said to the other team only. */
function chatFor(match: MatchRecord, you: PlayerRecord): MatchState['chat'] {
  return match.chat
    .filter((entry) => !you.muted.includes(entry.userId) && (entry.scope !== 'team' || entry.team === you.team))
    .map(({ id, username, text, emote, at, scope }) => ({ id, username, text, emote, at, scope: scope ?? 'all' }));
}

/** What one of the match's players is told about it. */
export function matchState(snapshot: Snapshot, you: PlayerRecord, now: number): MatchState {
  const { match, players, guesses } = snapshot;
  const revealed = revealedRounds(match);
  const guessOf = (userId: string, round: number): GuessRecord | undefined =>
    guesses.find((guess) => guess.userId === userId && guess.round === round);
  const roundIsOpen = match.phase === 'playing' || match.phase === 'reveal';
  // Health follows the revealed rounds only, like the totals, so it gives nothing away about the round being played.
  const health = match.kind === 'ranked' ? healthAfter(players, guesses, revealed) : null;

  return {
    id: match.id,
    code: match.code,
    kind: match.kind,
    phase: match.phase,
    settings: match.settings,
    locked: match.locked,
    seed: match.seed,
    serverNow: new Date(now).toISOString(),
    round: match.round,
    roundStartsAt: iso(match.roundStartsAt),
    roundEndsAt: iso(match.roundEndsAt),
    revealEndsAt: iso(match.revealEndsAt),
    you: {
      username: you.username,
      isHost: match.kind === 'party' && match.resolverId === you.userId,
      isResolver: match.resolverId === you.userId,
      team: you.team,
      guest: you.guest,
      muted: players.filter((player) => you.muted.includes(player.userId)).map((player) => player.username),
    },
    players: players.map((player) => ({
      username: player.username,
      country: player.country,
      guest: player.guest,
      team: player.team,
      total: guesses.filter((guess) => guess.userId === player.userId && guess.round < revealed).reduce((sum, guess) => sum + guess.score, 0),
      guessed: roundIsOpen && guessOf(player.userId, match.round) !== undefined,
      active: isActive(player, now),
      rating: match.kind === 'ranked' ? player.rating : null,
      health: health?.get(player.userId) ?? null,
    })),
    teams: teamsOf(match, players, guesses, revealed),
    picker: pickerOf(match, players)?.username ?? null,
    mates: matesOf(snapshot, you),
    // Only the places reached so far: the ones still to come are nobody's to read ahead.
    places: match.places === null ? null : match.places.slice(0, match.round + 1),
    results: Array.from({ length: revealed }, (_unused, round) => ({
      round,
      guesses: players.map((player) => {
        const guess = guessOf(player.userId, round);
        return {
          username: player.username,
          lng: guess?.lng ?? null,
          lat: guess?.lat ?? null,
          distanceKm: guess?.distanceKm ?? null,
          score: guess?.score ?? 0,
        };
      }),
    })),
    outcome: match.outcome,
    chat: chatFor(match, you),
    movedToQueue: match.movedToQueue,
  };
}
