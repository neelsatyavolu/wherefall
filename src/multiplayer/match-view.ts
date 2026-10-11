import { roundXp } from '../game/marks.ts';
import type { ChatEntry, Communication, MatchState, QueueKind } from './client.ts';
import { chatMode, type Stage } from './state.ts';

/**
 * Pure reading of a `MatchState` for what surrounds the rounds: the XP a round earns, the versus
 * intro, what the final screen offers, and what the chat shows. No requests, no DOM.
 */

/** A ranked duel pays this many times the XP of any other round. */
const RANKED_XP = 2;

/** The leagues by the rating each starts at, highest first, as the server names them. */
const LEAGUES: ReadonlyArray<readonly [from: number, name: string]> = [
  [1800, 'Legend'],
  [1300, 'Nomad'],
  [1000, 'Voyager'],
  [800, 'Explorer'],
  [0, 'Trekker'],
];

/** The league a rating falls in, by the server's name for it. */
export const leagueFor = (rating: number): string => LEAGUES.find(([from]) => rating >= from)?.[1] ?? 'Trekker';

/**
 * The XP one round's score earns this player in this match: the score over fifty, double in a
 * ranked duel. Null where rounds earn none: in a party, and for a guest anywhere.
 */
export function xpForRound(state: MatchState, score: number): number | null {
  if (state.you.guest || state.kind === 'party') {
    return null;
  }
  return roundXp(score) * (state.kind === 'ranked' ? RANKED_XP : 1);
}

/** The XP of every revealed round of the player's own, added up. Null where the match earns none. */
export function xpEarned(state: MatchState): number | null {
  if (xpForRound(state, 0) === null) {
    return null;
  }
  return state.results
    .flatMap((result) => result.guesses)
    .filter((guess) => guess.username === state.you.username)
    .reduce((sum, guess) => sum + (xpForRound(state, guess.score) ?? 0), 0);
}

/**
 * True for the player who stayed when the other left a ranked duel before anyone had guessed: the
 * server has already put them back in the ranked queue, so that is the screen they return to.
 */
export function returnsToQueue(state: MatchState): boolean {
  const dodgedBy = state.outcome?.dodgedBy ?? null;
  return state.kind === 'ranked' && state.phase === 'finished' && dodgedBy !== null && dodgedBy !== state.you.username;
}

export interface AfterMatch {
  /** the queue "Play again" joins, or null where the match came from no queue */
  again: QueueKind | null;
  /** true for a party's host, who can take everyone still there back to its lobby */
  lobby: boolean;
  /** true in a party, whose players stay in it for as long as its results are on screen */
  party: boolean;
}

/** What the final screen offers besides the way home. */
export function afterMatch(state: MatchState): AfterMatch {
  if (state.kind !== 'party') {
    return { again: state.kind, lobby: false, party: false };
  }
  return { again: null, lobby: state.you.isHost, party: true };
}

export interface VersusCard {
  username: string;
  country: string | null;
  rating: number | null;
  /** by the server's name for it; null for a player with no rating */
  league: string | null;
  isYou: boolean;
}

/**
 * The two players of a ranked duel, for the screen shown while its first round gets ready. Null at
 * every other moment: the intro lasts exactly as long as the server's get-ready does.
 */
export function versusOf(state: MatchState, stage: Stage): VersusCard[] | null {
  if (state.kind !== 'ranked' || stage.kind !== 'starting' || stage.round !== 0) {
    return null;
  }
  return state.players.map((player) => ({
    username: player.username,
    country: player.country,
    rating: player.rating,
    league: player.rating === null ? null : leagueFor(player.rating),
    isYou: player.username === state.you.username,
  }));
}

export interface ChatPlayer {
  username: string;
  country: string | null;
  /** true when this player's lines and reactions are being left out of the viewer's chat */
  muted: boolean;
}

/** Everything the chat draws from one state. */
export interface ChatView {
  entries: readonly ChatEntry[];
  /** the viewer, whose own lines are marked */
  you: string;
  /** the viewer's own country, for the flag by their name */
  country: string | null;
  /** messages and reactions, the reactions alone, or `off`, which hides the chat */
  mode: Communication;
  /** true for a guest where players with an account can write: the chat then says what signing up adds */
  guestNote: boolean;
  /** everyone else in the match, each of whom can be muted */
  others: readonly ChatPlayer[];
  /** true where a message can go to the player's own team alone: free chat, in a match with teams, for a player on one */
  teamScope: boolean;
}

/** A reaction to float over the round screen: who sent it, and the word. */
export interface Reaction {
  id: number;
  username: string;
  country: string | null;
  emote: string;
}

/**
 * The reactions that arrived after the entry with id `afterId`, oldest first, the viewer's own
 * among them. None where the chat is off (the match has none, or the account hides it), and none
 * from a muted player.
 */
export function reactionsSince(view: ChatView, afterId: number): Reaction[] {
  if (view.mode === 'off') {
    return [];
  }
  const muted = new Set(view.others.filter((player) => player.muted).map((player) => player.username));
  const countries = new Map(view.others.map((player) => [player.username, player.country]));
  return view.entries.flatMap((entry) =>
    entry.id > afterId && entry.emote !== null && !muted.has(entry.username)
      ? [{ id: entry.id, username: entry.username, country: (entry.username === view.you ? view.country : countries.get(entry.username)) ?? null, emote: entry.emote }]
      : [],
  );
}

/** Free chat exists in a party whose host allows it and in 2v2. */
const freeChat = (state: MatchState) => (state.kind === 'party' ? state.settings.communication === 'chat' : state.kind === 'team');

/** What the chat shows. `hidden` is the account's own "hide chat" setting, which turns it off everywhere. */
export function chatView(state: MatchState, hidden: boolean): ChatView {
  const mode = hidden ? 'off' : chatMode(state);
  return {
    entries: state.chat,
    you: state.you.username,
    country: state.players.find((player) => player.username === state.you.username)?.country ?? null,
    mode,
    teamScope: mode === 'chat' && state.teams !== null && state.you.team !== null,
    guestNote: !hidden && state.you.guest && freeChat(state),
    others: state.players
      .filter((player) => player.username !== state.you.username)
      .map((player) => ({ username: player.username, country: player.country, muted: state.you.muted.includes(player.username) })),
  };
}
