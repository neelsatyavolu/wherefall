import { EMAIL_LIMITS, PASSWORD_LIMITS, setEmail } from '../account/actions.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

export const emailInput = (id: string) =>
  el('input', {
    class: 'account-input',
    attrs: { id, name: 'email', type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: 'false', maxlength: String(EMAIL_LIMITS.max) },
  });

const field = (label: string, input: HTMLInputElement) =>
  el('div', { class: 'account-field' }, el('label', { class: 'label', text: label, attrs: { for: input.id } }), input);

/**
 * The account's email, on the account pane: where reset links are sent, or that there is nowhere
 * to send one. Adding an email to an account that has none takes the address alone; changing one
 * takes the current password too, since the address is a way back into the account. Like the
 * password form it starts as one button, and the form opens in its place.
 */
export function emailSection(current: string | null): HTMLElement {
  const body = el('div', { class: 'account-section' });
  const email = emailInput('account-email');
  const password = el('input', {
    class: 'account-input',
    attrs: { id: 'email-password', name: 'email-password', type: 'password', autocomplete: 'current-password', maxlength: String(PASSWORD_LIMITS.max) },
  });
  const open = el('button', { class: 'button ghost', attrs: { type: 'button', 'aria-expanded': 'false' } });
  const submit = el('button', { class: 'button primary', attrs: { type: 'submit' } });
  const cancel = el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' } });
  const done = el('p', { class: 'fine', attrs: { role: 'status' } });
  const error = errorLine();
  const passwordField = field(t('account.currentPassword'), password);
  let has = current;

  /** What the account has, said plainly: an address, or none and what that means. */
  const standing = () => el('p', { class: has === null ? 'prose recovery-none' : 'fine', text: has === null ? t('email.none') : t('email.has', { email: has }) });
  const opener = el('div', { class: 'actions' }, open);

  const send = async () => {
    done.textContent = '';
    const changing = has !== null;
    if (email.value.trim() === '' || (changing && password.value === '')) {
      error.textContent = t(changing ? 'email.missing.password' : 'email.missing');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const result = await setEmail(email.value.trim(), changing ? password.value : undefined);
    submit.disabled = false;
    if (!result.ok) {
      sayRefusal(error, result.error);
      return;
    }
    has = result.data.email;
    show(false);
    done.textContent = t('email.saved');
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
    field(t('email.new'), email),
    passwordField,
    el('div', { class: 'actions' }, submit, cancel),
    error,
  );

  /** Opens the form, or closes it, emptied, and gives the keyboard back to the button that opened it. */
  function show(opened: boolean): void {
    const label = t(has === null ? 'email.add' : 'email.change');
    open.textContent = label;
    submit.textContent = label;
    email.value = '';
    password.value = '';
    error.textContent = '';
    done.textContent = '';
    passwordField.hidden = has === null;
    open.setAttribute('aria-expanded', String(opened));
    body.replaceChildren(standing(), opened ? form : opener, done);
    (opened ? email : open).focus();
  }

  open.addEventListener('click', () => show(true));
  cancel.addEventListener('click', () => show(false));
  open.textContent = t(has === null ? 'email.add' : 'email.change');
  body.replaceChildren(standing(), opener, done);

  return el('section', { class: 'account-section settings', attrs: { 'aria-label': t('account.email') } }, el('h3', { class: 'label', text: t('account.email') }), body);
}

/**
 * Asked of a player who has just signed in to an account with no email: the address, Save, and
 * "Not now". It stands where the account will, and is no more in the way than that: either answer
 * calls `onDone`, and the rest of the site is a click away throughout. It is asked again the next
 * time they sign in, until an address is saved.
 */
export function emailPrompt(onDone: () => void): HTMLFormElement {
  const email = emailInput('prompt-email');
  const submit = el('button', { class: 'button accent', text: t('email.save'), attrs: { type: 'submit' } });
  const later = el('button', { class: 'button ghost', text: t('email.notNow'), attrs: { type: 'button' }, on: { click: onDone } });
  const error = errorLine();

  const send = async () => {
    if (email.value.trim() === '') {
      error.textContent = t('email.missing');
      return;
    }
    submit.disabled = true;
    later.disabled = true;
    submit.textContent = t('email.save.busy');
    error.textContent = '';
    const result = await setEmail(email.value.trim());
    // On success the form stays busy until it is replaced, so it cannot be sent twice.
    if (result.ok) {
      onDone();
      return;
    }
    submit.disabled = false;
    later.disabled = false;
    submit.textContent = t('email.save');
    sayRefusal(error, result.error);
  };

  return el(
    'form',
    {
      class: 'account-form email-prompt',
      attrs: { novalidate: '', 'aria-label': t('email.prompt.title') },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    el('div', { class: 'account-field' }, el('h3', { class: 'label', text: t('email.prompt.title') }), el('p', { class: 'fine', text: t('email.prompt') })),
    field(t('account.email'), email),
    el('div', { class: 'actions' }, submit, later),
    error,
  );
}
