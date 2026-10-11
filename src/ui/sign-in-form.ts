import { REFUSALS, login, register, restoreAccount, type Result } from '../account/client.ts';
import { countryFromLocale } from '../account/countries.ts';
import { t } from '../i18n/index.ts';
import { choicesClass } from './choice-row.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { recoverForm } from './recover-form.ts';

type FormMode = 'login' | 'register';
/** what the form is waiting on, if anything: its own request, or the restoring of a deleted account */
type Busy = 'send' | 'restore' | null;

const FORM_MODES: readonly FormMode[] = ['login', 'register'];

/** How a recovery code came to be made: with a new account, or by getting back in with the one before it. */
export type CodeFrom = 'signup' | 'recovered';

export interface SignInHandlers {
  /** the browser has a session */
  onSignedIn: () => void;
  /** the browser has a session, and with it a recovery code that is shown this once */
  onCode: (recoveryCode: string, from: CodeFrom) => void;
}

function createControls() {
  const radio = (mode: FormMode) => el('input', { attrs: { type: 'radio', name: 'account-mode', value: mode } });
  return {
    radios: { login: radio('login'), register: radio('register') } satisfies Record<FormMode, HTMLInputElement>,
    username: el('input', {
      class: 'account-input',
      attrs: { id: 'account-username', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20' },
    }),
    password: el('input', {
      class: 'account-input',
      attrs: { id: 'account-password', name: 'password', type: 'password', autocomplete: 'current-password', maxlength: '200' },
    }),
    usernameHint: el('p', { class: 'fine', text: t('account.usernameHint') }),
    passwordHint: el('p', { class: 'fine', text: t('account.passwordHint') }),
    submit: el('button', { class: 'button accent', attrs: { type: 'submit' } }),
    error: errorLine(),
    /** offered once the server has said the account was deleted and can be restored */
    restore: el('button', { class: 'button primary', attrs: { type: 'button' } }),
    /** for signing in only: the way in by recovery code */
    forgot: el('button', { class: 'button ghost', text: t('recovery.forgot'), attrs: { type: 'button' } }),
  };
}

type Controls = ReturnType<typeof createControls>;

function layoutForm(controls: Controls): HTMLFormElement {
  const field = (label: string, input: HTMLInputElement, hint: HTMLElement) =>
    el('div', { class: 'account-field' }, el('label', { class: 'label', text: label, attrs: { for: input.id } }), input, hint);
  return el(
    'form',
    { class: 'account-form', attrs: { novalidate: '' } },
    el(
      'fieldset',
      { class: 'choice-row' },
      el('legend', { class: 'label', text: t('common.signIn') }),
      el(
        'div',
        { class: choicesClass(FORM_MODES.map((mode) => t(`account.${mode}.name`))) },
        ...FORM_MODES.map((mode) => el('label', { class: 'choice' }, controls.radios[mode], el('span', { text: t(`account.${mode}.name`) }))),
      ),
    ),
    field(t('account.username'), controls.username, controls.usernameHint),
    field(t('account.password'), controls.password, controls.passwordHint),
    el('div', { class: 'actions' }, controls.submit, controls.restore, controls.forgot),
    controls.error,
  );
}

/** Brings every control in line with the mode, what is in flight, and whether restoring is on offer. */
function sync(controls: Controls, mode: FormMode, busy: Busy, restorable: boolean): void {
  const registering = mode === 'register';
  controls.radios[mode].checked = true;
  controls.usernameHint.hidden = !registering;
  controls.passwordHint.hidden = !registering;
  controls.password.setAttribute('autocomplete', registering ? 'new-password' : 'current-password');
  controls.submit.textContent = busy === 'send' ? t(`account.${mode}.busy`) : t(`account.${mode}.name`);
  controls.submit.disabled = busy !== null;
  controls.restore.textContent = busy === 'restore' ? t('account.restore.busy') : t('account.restore');
  controls.restore.disabled = busy !== null;
  controls.restore.hidden = !restorable;
  controls.forgot.hidden = registering;
  controls.forgot.disabled = busy !== null;
}

/**
 * One form for both signing in and creating an account. A new account is given the country of the
 * browser's language, which the player can change afterwards, and a recovery code, which `onCode`
 * is handed to show the one time it is sent. Signing in to an account deleted in the last 30 days
 * is refused, and the form then offers to restore it. "Forgot password" puts the recovery form in
 * this one's place, with the way back.
 */
export function signInForm(handlers: SignInHandlers): HTMLElement {
  const controls = createControls();
  const { radios, username, password, error } = controls;
  let mode: FormMode = 'login';
  let busy: Busy = null;
  let restorable = false;
  const draw = () => sync(controls, mode, busy, restorable);

  // only a new account is answered with a recovery code
  const requests: Record<FormMode | 'restore', () => Promise<Result<{ username: string; recoveryCode?: string }>>> = {
    login: () => login(username.value, password.value),
    register: () => register(username.value, password.value, countryFromLocale(navigator.language)),
    restore: () => restoreAccount(username.value, password.value),
  };

  const send = async (what: FormMode | 'restore') => {
    if (busy !== null) {
      return;
    }
    // Checked here, not by disabling the button as the fields change: a password
    // manager can fill both fields without the page ever hearing about it.
    if (username.value.trim() === '' || password.value === '') {
      error.textContent = t('account.missing');
      return;
    }
    busy = what === 'restore' ? 'restore' : 'send';
    restorable = false;
    error.textContent = '';
    draw();
    const result = await requests[what]();
    // On success the form stays busy until it is replaced, so it cannot be sent twice.
    if (result.ok) {
      const { recoveryCode } = result.data;
      if (recoveryCode === undefined) {
        handlers.onSignedIn();
      } else {
        handlers.onCode(recoveryCode, 'signup');
      }
      return;
    }
    busy = null;
    error.textContent = result.error;
    restorable = what !== 'register' && result.error === REFUSALS.deleted;
    draw();
  };

  for (const next of FORM_MODES) {
    radios[next].addEventListener('change', () => {
      mode = next;
      restorable = false;
      error.textContent = '';
      draw();
    });
  }
  controls.restore.addEventListener('click', () => void send('restore'));
  draw();

  const form = layoutForm(controls);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send(mode);
  });
  const host = el('div', { class: 'sign-in' }, form);

  controls.forgot.addEventListener('click', () => {
    const back = () => {
      host.replaceChildren(form);
      controls.forgot.focus();
    };
    const recover = recoverForm({ username: username.value.trim(), onRecovered: (code) => handlers.onCode(code, 'recovered'), onBack: back });
    host.replaceChildren(recover);
    recover.querySelector<HTMLInputElement>(username.value.trim() === '' ? '#recover-username' : '#recover-code')?.focus();
  });
  return host;
}
