import './account.css';
import { REFUSALS } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { hrefFor } from './nav.ts';
import { errorBox, statusBox } from './status-box.ts';

/**
 * A session can end from somewhere else at any moment: the password was changed in another browser,
 * a recovery code was used, the account was deleted or banned, or it signed out everywhere. The
 * browser learns of it when the next thing it asks is refused with "Sign in first.". Every screen
 * of a signed-in player shows that refusal through this file, so each says the same thing (the
 * player is no longer signed in) and offers the same way on (signing in), and the rest of the page
 * hears of it and stops showing the account.
 */

/** who wants to hear that the session is over: the sidebar, and the account pane while it is open */
const watchers = new Set<() => void>();

/** True when a refusal is the server saying this browser has no session. */
export const isSessionEnded = (error: string): boolean => error === REFUSALS.signIn;

/** Calls `run` whenever a screen meets the end of the session. Returns what stops it being called. */
export function onSessionEnded(run: () => void): () => void {
  watchers.add(run);
  return () => {
    watchers.delete(run);
  };
}

/** Tells everything that watches that the session is over. */
export function announceSessionEnded(): void {
  for (const run of [...watchers]) {
    run();
  }
}

/** The way to sign in: the account pane, or the same in a new tab where leaving the page would lose work. */
function signInLink(className: string, newTab: boolean): HTMLAnchorElement {
  const attrs: Record<string, string> = newTab ? { href: hrefFor('account'), target: '_blank', rel: 'noopener' } : { href: hrefFor('account') };
  return el('a', { class: className, text: t(newTab ? 'session.signInNewTab' : 'account.login.name'), attrs });
}

/** The notice that stands where a signed-in player's screen was: no longer signed in, and the way back in. */
export function sessionEndedBox(): HTMLElement {
  return statusBox('idle', t('session.ended.label'), t('session.ended'), signInLink('button primary', false));
}

/**
 * What stands where something could not be loaded: the error with a way to ask again, or, when it
 * is the session that is gone, the notice above. Asking again cannot mend that, so it is not offered.
 */
export function refusalBox(error: string, retry?: () => void): HTMLElement {
  if (!isSessionEnded(error)) {
    return errorBox(error, retry);
  }
  announceSessionEnded();
  return sessionEndedBox();
}

/**
 * A refusal as words alone, for a place that can show nothing else (a status line of a match, whose
 * own poll offers the way to sign in a moment later): the server's words, or that the player is no
 * longer signed in.
 */
export function refusalText(error: string): string {
  if (!isSessionEnded(error)) {
    return error;
  }
  announceSessionEnded();
  return t('session.ended');
}

interface SayOptions {
  /** the player has unsaved work on this page: say it is still here, and open sign-in in a new tab */
  keepPage?: boolean;
}

/**
 * Writes a refusal into the line a control keeps for it: the server's words as sent, or, when it
 * is the session that is gone, that the player is no longer signed in, with the link to sign in.
 * An empty `error` empties the line.
 */
export function sayRefusal(line: HTMLElement, error: string, options: SayOptions = {}): void {
  if (!isSessionEnded(error)) {
    line.textContent = error;
    return;
  }
  const keepPage = options.keepPage === true;
  // one piece of running text, so the link follows the sentence where the line is a row of its parts
  line.replaceChildren(el('span', {}, t(keepPage ? 'session.ended.draft' : 'session.ended'), ' ', signInLink('session-link', keepPage)));
  announceSessionEnded();
}

/** A refusal as a line of its own, for a list or a row that keeps no line for one. */
export function refusalLine(error: string): HTMLElement {
  const line = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  sayRefusal(line, error);
  return line;
}
