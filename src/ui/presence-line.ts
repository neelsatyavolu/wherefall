import './social.css';
import { presenceText, type Seen } from '../social/last-seen.ts';
import { el } from './dom.ts';

/** "Online", or when a player was last seen, behind a dot that is filled while they are online. */
export function presenceLine(who: Seen): HTMLElement {
  return el('span', { class: who.online ? 'presence online' : 'presence', text: presenceText(who), attrs: who.lastSeenAt === null ? {} : { 'data-seen': who.lastSeenAt } });
}

/**
 * Writes again every presence line under `root`: "3 minutes ago" goes stale on a page left open.
 * Each line is rewritten from the time it was drawn with, so nothing else on the page moves.
 */
export function refreshPresence(root: HTMLElement): void {
  for (const line of root.querySelectorAll<HTMLElement>('.presence')) {
    line.textContent = presenceText({ online: line.classList.contains('online'), lastSeenAt: line.dataset.seen ?? null });
  }
}
