import type { MatchState } from './client.ts';
import { msUntil } from './state.ts';

/**
 * The one request more that a match is asked for when a reveal ends. The server sends a round's
 * place only when that round's five seconds of get-ready begin, and a full party is asked for every
 * four seconds: left to the pace, the place could arrive with a second to spare. Asked for as the
 * reveal ends, it arrives with the get-ready still ahead, and so does the final standing after the
 * last reveal. Polls are not limited by the server; this is one request a round for each player.
 */

export const REVEAL_ASK = {
  /** how long after the reveal's end, by this browser's reading of the server's clock, before the server is sure to have moved on */
  graceMs: 150,
  /** the request is made within this long of the end: a party of forty spreads over it and does not all ask in the same instant */
  withinMs: 1000,
} as const;

/** Names the reveal a state is in, so that it is asked about once. Null outside a reveal. */
export const revealKey = (state: MatchState): string | null => (state.phase === 'reveal' && state.revealEndsAt !== null ? `${state.round}@${state.revealEndsAt}` : null);

/**
 * When to ask once more, in ms from now: no sooner than just after the reveal ends, and no later
 * than `share` (0 to 1, this browser's own) of the way through the second after it. A request the
 * pace makes inside that window serves as well. Null outside a reveal.
 */
export function askAfterReveal(state: MatchState, serverNowMs: number, share: number): { fromMs: number; byMs: number } | null {
  if (revealKey(state) === null) {
    return null;
  }
  const { graceMs, withinMs } = REVEAL_ASK;
  const part = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const fromMs = msUntil(state.revealEndsAt, serverNowMs) + graceMs;
  return { fromMs, byMs: fromMs + Math.round(part * (withinMs - graceMs)) };
}
