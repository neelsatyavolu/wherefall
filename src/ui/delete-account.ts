import { PASSWORD_LIMITS, deleteAccount } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';
import { longDay } from './stat-grid.ts';
import { statusBox } from './status-box.ts';

/**
 * What is shown in place of the account once it is deleted: the day it can be restored until, and
 * the way to the sign-in form, which is where restoring happens.
 */
export function deletedNotice(restoreUntil: string, onSignIn: () => void): HTMLElement {
  const signIn = el('button', { class: 'button primary', text: t('account.deleted.signIn'), attrs: { type: 'button' }, on: { click: onSignIn } });
  const note = statusBox('idle', t('account.deleted.label'), t('account.deleted', { date: longDay(restoreUntil) }), signIn);
  // it takes the pane's place the moment the account is gone, so it is said at once
  note.setAttribute('role', 'alert');
  return note;
}

/** The confirmation: what deleting does, said plainly, and the password it asks for. */
function confirmation(onDeleted: (restoreUntil: string) => void, onCancel: () => void): HTMLElement {
  const password = el('input', {
    class: 'account-input',
    attrs: { id: 'delete-password', name: 'delete-password', type: 'password', autocomplete: 'current-password', maxlength: String(PASSWORD_LIMITS.max) },
  });
  const submit = el('button', { class: 'button danger', text: t('account.delete.confirm'), attrs: { type: 'submit' } });
  // beside the deleting, keeping the account is the filled button
  const cancel = el('button', { class: 'button primary', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: onCancel } });
  const error = errorLine();

  const send = async () => {
    if (password.value === '') {
      error.textContent = t('account.delete.missing');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const result = await deleteAccount(password.value);
    // On success the form stays busy until the pane replaces it, so it cannot be sent twice.
    if (result.ok) {
      onDeleted(result.data.restoreUntil);
      return;
    }
    submit.disabled = false;
    sayRefusal(error, result.error);
  };

  return el(
    'form',
    {
      class: 'account-form delete-confirm',
      attrs: { novalidate: '' },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    el('p', { class: 'prose', text: t('account.delete.what') }),
    el('div', { class: 'account-field' }, el('label', { class: 'label', text: t('account.password'), attrs: { for: password.id } }), password),
    el('div', { class: 'actions' }, submit, cancel),
    error,
  );
}

/**
 * Deleting the account. It starts as one button; pressing it opens the confirmation in its place,
 * which can be cancelled. `onDeleted` is called with the day the account can be restored until,
 * once the server has deleted it and signed this browser out.
 */
export function deleteAccountSection(onDeleted: (restoreUntil: string) => void): HTMLElement {
  const body = el('div', { class: 'account-section' });
  const open = el('button', { class: 'button danger', text: t('account.delete'), attrs: { type: 'button' } });
  const closed = [el('p', { class: 'fine', text: t('account.delete.note') }), el('div', { class: 'actions' }, open)];

  const close = () => {
    body.replaceChildren(...closed);
    open.focus();
  };
  open.addEventListener('click', () => {
    const form = confirmation(onDeleted, close);
    body.replaceChildren(form);
    form.querySelector('input')?.focus();
  });
  body.replaceChildren(...closed);

  return el('section', { class: 'account-section settings' }, el('h3', { class: 'label', text: t('account.delete') }), body);
}
