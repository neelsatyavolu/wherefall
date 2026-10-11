import { PASSWORD_LIMITS, issueRecoveryCode } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { recoveryCodeBox } from './recovery-code-box.ts';
import { sayRefusal } from './session-ended.ts';

/**
 * The account's recovery code, on the account pane. The code itself is never here: the pane only
 * knows whether the account has one, and says so plainly when it has none (an account made before
 * there were codes). A new one is made after the current password and replaces the old; it is
 * shown once, in this section, until the player says they have it. Like the password form it
 * starts as one button, so the pane is not a form longer for a player who came for something else.
 */
export function recoverySection(hasCode: boolean): HTMLElement {
  const body = el('div', { class: 'account-section' });
  const password = el('input', {
    class: 'account-input',
    attrs: { id: 'recovery-password', name: 'recovery-password', type: 'password', autocomplete: 'current-password', maxlength: String(PASSWORD_LIMITS.max) },
  });
  const open = el('button', { class: 'button ghost', text: t('recovery.issue'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const submit = el('button', { class: 'button primary', text: t('recovery.issue'), attrs: { type: 'submit' } });
  const cancel = el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' } });
  const error = errorLine();
  let has = hasCode;

  /** What the account has, said plainly: a code, or none and what that means. */
  const standing = () => el('p', { class: has ? 'fine' : 'prose recovery-none', text: t(has ? 'recovery.has' : 'recovery.none') });
  const opener = el('div', { class: 'actions' }, open);

  const send = async () => {
    if (password.value === '') {
      error.textContent = t('recovery.issue.missing');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const result = await issueRecoveryCode(password.value);
    submit.disabled = false;
    if (!result.ok) {
      sayRefusal(error, result.error);
      return;
    }
    has = true;
    // the code takes the section's place until the player has it: it will not be shown again
    body.replaceChildren(recoveryCodeBox(result.data.recoveryCode, t('recovery.made.issued'), () => show(false)));
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
    el('div', { class: 'account-field' }, el('label', { class: 'label', text: t('account.currentPassword'), attrs: { for: password.id } }), password),
    el('div', { class: 'actions' }, submit, cancel),
    error,
  );

  /** Opens the form, or closes it, emptied, and gives the keyboard back to the button that opened it. */
  function show(opened: boolean): void {
    password.value = '';
    error.textContent = '';
    open.setAttribute('aria-expanded', String(opened));
    body.replaceChildren(standing(), opened ? form : opener);
    (opened ? password : open).focus();
  }

  open.addEventListener('click', () => show(true));
  cancel.addEventListener('click', () => show(false));
  body.replaceChildren(standing(), opener);

  return el('section', { class: 'account-section settings', attrs: { 'aria-label': t('recovery.title') } }, el('h3', { class: 'label', text: t('recovery.title') }), body);
}
