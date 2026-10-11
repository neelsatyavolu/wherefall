import './status.css';
import { el } from './dom.ts';
import type { FitPadding } from './guess-map.ts';

/**
 * What a match says about itself in a line: a dot, then the words. Made of the status pieces the
 * rest of the game uses (`status.css`, and `.status-inline` for a line in mono), so a countdown, a
 * note and a refusal look alike wherever they stand.
 */

/** Blue for something under way, green for good news, red for a failure, grey for something only worth knowing. */
export type LineState = 'live' | 'ok' | 'error' | 'note';

/** a phone, where a match folds away what a wide screen has room to show */
export const PHONE = '(max-width: 720px)';

export const onPhone = (): boolean => window.matchMedia(PHONE).matches;

const dot = () => el('span', { class: 'status-dot', attrs: { 'aria-hidden': 'true' } });

/**
 * A line of status. `mono` sets it in the mono face, for a countdown or a count; a sentence is
 * left in the face sentences are read in. Hidden while it has nothing to say.
 */
export function statusLine(state: LineState, mono = false) {
  const words = el('span', { class: mono ? 'status-inline' : 'status-words' });
  const node = el('p', { class: 'status-note match-status', attrs: { 'data-state': state } }, dot(), words);
  node.hidden = true;
  return {
    node,
    /** Written only when it differs, so a line that is read out is not read out again. */
    set(text: string, next: LineState = state): void {
      if (words.textContent !== text) {
        words.textContent = text;
      }
      node.dataset.state = next;
      node.hidden = text === '';
    },
  };
}

/** A line that never changes. */
export function statusNote(state: LineState, text: string, mono = false): HTMLElement {
  const line = statusLine(state, mono);
  line.set(text);
  return line.node;
}

/** The dot and the words of a line, for a control that is itself the line (what opens a folded list). */
export const statusParts = (text: HTMLElement): HTMLElement[] => [dot(), text];

const GAP = 16;

/**
 * Map padding that also keeps pins clear of what a match stands along the top of the screen: its
 * health, and on a phone the HUD and the chat button, which run the screen's width there. Only
 * what lies over the part of the map the padding leaves open counts.
 */
export function clearOfTop(view: HTMLElement, padding: FitPadding): FitPadding {
  const left = padding.left ?? 0;
  const right = window.innerWidth - (padding.right ?? 0);
  const bottoms = [...view.querySelectorAll<HTMLElement>('.hud, .health, .match-corner .button')]
    .map((part) => part.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.right > left && box.left < right)
    .map((box) => box.bottom + GAP);
  return { ...padding, top: Math.max(padding.top ?? 0, ...bottoms) };
}
