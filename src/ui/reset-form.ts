import { PASSWORD_LIMITS } from '../account/actions.ts';
import { completePasswordReset } from '../account/reset.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';

interface ResetOptions {
  /** the token the reset link carried */
  token: string;
  /** the new password is set and the browser signed in */
  onDone: () => void;
  /** the player wants another link: to the form that sends one */
  onAgain: () => void;
}

/**
 * What a reset link opens: a new password, and Set. The server decides whether the link is still
 * good and whether the password will do, and a refusal is shown in its words. A link that is used,
 * old or cut short cannot be mended here, so the way to ask for a new one is always beside the
 * button. Setting the password signs this browser in and every other one out.
 */
export function resetForm(options: ResetOptions): HTMLFormElement {
  const password = el('input', {
    class: 'account-input',
    attrs: { id: 'reset-password', name: 'new-password', type: 'password', autocomplete: 'new-password', maxlength: String(PASSWORD_LIMITS.max) },
  });
  const submit = el('button', { class: 'button accent', text: t('recovery.submit'), attrs: { type: 'submit' } });
  const again = el('button', { class: 'button ghost', text: t('reset.again'), attrs: { type: 'button' }, on: { click: options.onAgain } });
  const error = errorLine();
  let busy = false;

  const send = async () => {
    if (busy) {
      return;
    }
    if (password.value === '') {
      error.textContent = t('reset.missing');
      return;
    }
    busy = true;
    submit.disabled = true;
    again.disabled = true;
    submit.textContent = t('account.login.busy');
    error.textContent = '';
    const result = await completePasswordReset(options.token, password.value);
    // On success the form stays busy until it is replaced, so the spent link cannot be sent twice.
    if (result.ok) {
      options.onDone();
      return;
    }
    busy = false;
    submit.disabled = false;
    again.disabled = false;
    submit.textContent = t('recovery.submit');
    error.textContent = result.error;
  };

  return el(
    'form',
    {
      class: 'account-form reset-form',
      attrs: { novalidate: '', 'aria-label': t('reset.title') },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    el('div', { class: 'account-field' }, el('h3', { class: 'label', text: t('reset.title') }), el('p', { class: 'fine', text: t('reset.lede') })),
    el(
      'div',
      { class: 'account-field' },
      el('label', { class: 'label', text: t('account.newPassword'), attrs: { for: password.id } }),
      password,
      el('p', { class: 'fine', text: t('account.newPasswordHint') }),
    ),
    el('div', { class: 'actions' }, submit, again),
    error,
  );
}
