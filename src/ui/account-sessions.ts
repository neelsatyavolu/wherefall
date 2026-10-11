import { signOutEverywhere } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

/**
 * "Sign out everywhere": ends every session the account has, this browser's too, for a player who
 * left one signed in somewhere they should not have. A line says what it does. `onSignedOut` is
 * called once the server has done it, and the page is then a visitor's.
 */
export function signOutEverywhereSection(onSignedOut: () => void): HTMLElement {
  const error = errorLine();
  const button = el('button', { class: 'button ghost', text: t('sessions.everywhere'), attrs: { type: 'button' } });
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.textContent = '';
    const result = await signOutEverywhere();
    // On success the button stays off until the pane replaces it.
    if (result.ok) {
      onSignedOut();
      return;
    }
    button.disabled = false;
    sayRefusal(error, result.error);
  });
  return el(
    'section',
    { class: 'account-section settings', attrs: { 'aria-label': t('sessions.everywhere') } },
    el('h3', { class: 'label', text: t('sessions.everywhere') }),
    el('p', { class: 'fine', text: t('sessions.everywhere.note') }),
    el('div', { class: 'actions' }, button),
    error,
  );
}
