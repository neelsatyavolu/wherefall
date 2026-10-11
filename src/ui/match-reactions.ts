import './match-reactions.css';
import { reactionsSince, type ChatView, type Reaction } from '../multiplayer/match-view.ts';
import { el } from './dom.ts';
import { plainName } from './guest-parts.ts';

/** How long a reaction stands over the round screen. Its fading in and out are part of this (see the keyframes). */
export const FLOAT_MS = 2600;
/** How many stand there at once. One more takes the oldest one's place, so a burst is a short list and never a heap. */
export const MAX_FLOATS = 3;

/**
 * Reactions as they are sent in a match, floating by the list of who has guessed: the sender's
 * flag and name and the word, there for a moment and then gone. They stand in the match's own rail
 * (under the list on a wide screen, beside its one line on a phone), in the flow of it, so they
 * are never on the HUD, the walk arrow, the pin map or its Guess bar. Nothing is shown where the
 * chat is off or hidden, or from a muted player (`reactionsSince`). Under reduced motion a
 * reaction appears and goes without moving or fading.
 */
export function reactionFloats() {
  // read out as they come: the chat's own list is folded away behind its button
  const node = el('div', { class: 'reaction-floats', attrs: { role: 'status' } });
  /** the newest entry looked at; null until the first view, which is only catching up */
  let seen: number | null = null;
  const timers = new Set<number>();

  function show(reaction: Reaction): void {
    const chip = el('p', { class: 'reaction-float' }, plainName(reaction.username, reaction.country, 'reaction-name'), el('span', { class: 'reaction-word', text: reaction.emote }));
    chip.style.animationDuration = `${FLOAT_MS}ms`;
    node.append(chip);
    while (node.childElementCount > MAX_FLOATS) {
      node.firstElementChild?.remove();
    }
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      chip.remove();
    }, FLOAT_MS);
    timers.add(timer);
  }

  return {
    node,
    /** Follows the match's chat: every reaction that is new since the last look floats once. */
    update(view: ChatView): void {
      if (seen !== null) {
        reactionsSince(view, seen).forEach(show);
      }
      seen = Math.max(seen ?? 0, view.entries.at(-1)?.id ?? 0);
    },
    destroy(): void {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      node.replaceChildren();
    },
  };
}
