import { PASSWORD_LIMITS, changePassword } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

const passwordInput = (id: string, autocomplete: string) =>
  el('input', { class: 'account-input', attrs: { id, name: id, type: 'password', autocomplete, maxlength: String(PASSWORD_LIMITS.max) } });

const field = (label: string, input: HTMLInputElement, hint?: string) =>
  el('div', { class: 'account-field' }, el('label', { class: 'label', text: label, attrs: { for: input.id } }), input, hint ? el('p', { class: 'fine', text: hint }) : null);

/**
 * Changes the account's password: the current one, then the new one. The server decides whether
 * either will do, and a refusal is shown in its words. This browser stays signed in; every other
 * one is signed out, which the hint under the new password says. It starts as one button, as
 * deleting the account does; the form opens in its place and can be closed again.
 */
export function passwordForm(): HTMLElement {
  const current = passwordInput('current-password', 'current-password');
  const next = passwordInput('new-password', 'new-password');
  const open = el('button', { class: 'button ghost', text: t('account.changePassword'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const submit = el('button', { class: 'button primary', text: t('account.changePassword'), attrs: { type: 'submit' } });
  const cancel = el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' } });
  const done = el('p', { class: 'fine', attrs: { role: 'status' } });
  const error = errorLine();

  const send = async () => {
    done.textContent = '';
    if (current.value === '' || next.value === '') {
      error.textContent = t('account.passwordMissing');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const result = await changePassword(current.value, next.value);
    submit.disabled = false;
    if (!result.ok) {
      sayRefusal(error, result.error);
      return;
    }
    show(false);
    done.textContent = t('account.passwordChanged');
  };

  const form = el(
    'form',
    {
      class: 'account-form',
      attrs: { novalidate: '' },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    field(t('account.currentPassword'), current),
    field(t('account.newPassword'), next, t('account.newPasswordHint')),
    el('div', { class: 'actions' }, submit, cancel),
    error,
  );
  const opener = el('div', { class: 'actions' }, open);

  /** Opens the form, or closes it, emptied, and gives the keyboard back to the button that opened it. */
  function show(opened: boolean): void {
    form.hidden = !opened;
    opener.hidden = opened;
    open.setAttribute('aria-expanded', String(opened));
    current.value = '';
    next.value = '';
    error.textContent = '';
    done.textContent = '';
    (opened ? current : open).focus();
  }

  open.addEventListener('click', () => show(true));
  cancel.addEventListener('click', () => show(false));
  form.hidden = true;
  return el('section', { class: 'account-section settings' }, el('h3', { class: 'label', text: t('account.changePassword') }), opener, form, done);
}
