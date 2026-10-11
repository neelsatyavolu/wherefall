import './status-box.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { hrefFor } from './nav.ts';

/** What a status is about: something failed or was refused, went well, is going on now, or is only so. */
export type StatusTone = 'error' | 'ok' | 'live' | 'idle';

/** An error is announced at once; anything else when the reader gets to it. */
const roleOf = (tone: StatusTone) => (tone === 'error' ? 'alert' : 'status');

/**
 * A status as DESIGN.md has it: a small dot and a mono label, in the tone's colour, then a sentence
 * that can be read and, where there is a way on, its buttons or links. For what a player must not
 * miss: a failure to load, a refusal, a ban. `label` is one or two words ("Error", "Banned").
 */
export function statusBox(tone: StatusTone, label: string, text: string, ...actions: Array<Node | null>): HTMLElement {
  const ways = actions.filter((action) => action !== null);
  return el(
    'section',
    { class: 'status-box', attrs: { role: roleOf(tone), 'data-tone': tone } },
    el('p', { class: 'status-box-label', text: label }),
    el('p', { class: 'status-box-text', text }),
    ways.length > 0 ? el('div', { class: 'actions' }, ...ways) : null,
  );
}

/** The way out of a failure that asking again can mend. */
export function retryButton(run: () => void): HTMLButtonElement {
  return el('button', { class: 'button primary', text: t('common.tryAgain'), attrs: { type: 'button' }, on: { click: run } });
}

/** Something could not be loaded or done: what the server or the browser said, and a way to ask again where one helps. */
export function errorBox(message: string, retry?: () => void): HTMLElement {
  return statusBox('error', t('status.error'), message, retry ? retryButton(retry) : null);
}

/** For an account a moderator has banned: nothing online works, and the page says so in one place with the way to what still does. */
export function bannedBox(): HTMLElement {
  return statusBox(
    'error',
    t('moderation.banned'),
    t('pane.banned'),
    el('a', { class: 'button primary', text: t('pane.playSingleplayer'), attrs: { href: hrefFor('singleplayer') } }),
  );
}
