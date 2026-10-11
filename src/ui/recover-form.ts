import { PASSWORD_LIMITS } from '../account/actions.ts';
import { REFUSALS, recoverAccount } from '../account/client.ts';
import { tidyRecoveryCode } from '../account/recovery-code.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';

interface RecoverOptions {
  /** what was typed into the sign-in form, so it need not be typed again */
  username: string;
  /** the browser is signed in, and this is the account's new recovery code, to show once */
  onRecovered: (recoveryCode: string) => void;
  /** back to the sign-in form */
  onBack: () => void;
}

/** what the form is waiting on, if anything: getting in, or the restoring of a deleted account */
type Busy = 'send' | 'restore' | null;

const field = (label: string, input: HTMLInputElement, hint?: string) =>
  el('div', { class: 'account-field' }, el('label', { class: 'label', text: label, attrs: { for: input.id } }), input, hint ? el('p', { class: 'fine', text: hint }) : null);

function createControls(username: string) {
  return {
    username: el('input', {
      class: 'account-input',
      attrs: { id: 'recover-username', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', value: username },
    }),
    // a code is typed from a note or pasted: nothing here corrects it, and its spelling is tidied when it is sent
    code: el('input', {
      class: 'account-input recovery-input',
      attrs: { id: 'recover-code', name: 'recovery-code', type: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: '40' },
    }),
    password: el('input', {
      class: 'account-input',
      attrs: { id: 'recover-password', name: 'new-password', type: 'password', autocomplete: 'new-password', maxlength: String(PASSWORD_LIMITS.max) },
    }),
    submit: el('button', { class: 'button accent', attrs: { type: 'submit' } }),
    /** offered once the server has said the account was deleted and can be restored */
    restore: el('button', { class: 'button primary', attrs: { type: 'button' } }),
    back: el('button', { class: 'button ghost', text: t('recovery.back'), attrs: { type: 'button' } }),
    error: errorLine(),
  };
}

type Controls = ReturnType<typeof createControls>;

/** Brings the buttons in line with what is in flight and whether restoring is on offer. */
function sync(controls: Controls, busy: Busy, restorable: boolean): void {
  controls.submit.textContent = busy === 'send' ? t('account.login.busy') : t('recovery.submit');
  controls.submit.disabled = busy !== null;
  controls.restore.textContent = busy === 'restore' ? t('account.restore.busy') : t('account.restore');
  controls.restore.disabled = busy !== null;
  controls.restore.hidden = !restorable;
  controls.back.disabled = busy !== null;
}

/**
 * Forgot password, by recovery code: the username, the account's code and a new password. It stands
 * under the form that sends a reset link by email (see `forgot-form.ts`). The code may be
 * typed with or without its dashes, with spaces, in either case. Getting in spends the code, and
 * the server answers with a new one, which `onRecovered` is given to show. Every refusal is shown
 * in the server's words; when it says the account was deleted, the form offers to restore it with
 * the same three things.
 */
export function recoverForm(options: RecoverOptions): HTMLFormElement {
  const controls = createControls(options.username);
  const { username, code, password, error } = controls;
  let busy: Busy = null;
  let restorable = false;
  const draw = () => sync(controls, busy, restorable);

  const send = async (restore: boolean) => {
    if (busy !== null) {
      return;
    }
    if (username.value.trim() === '' || tidyRecoveryCode(code.value) === '' || password.value === '') {
      error.textContent = t('recovery.missing');
      return;
    }
    busy = restore ? 'restore' : 'send';
    restorable = false;
    error.textContent = '';
    draw();
    const result = await recoverAccount(username.value.trim(), tidyRecoveryCode(code.value), password.value, restore);
    // On success the form stays busy until it is replaced, so the spent code cannot be sent twice.
    if (result.ok) {
      options.onRecovered(result.data.recoveryCode);
      return;
    }
    busy = null;
    error.textContent = result.error;
    restorable = result.error === REFUSALS.deleted;
    draw();
  };

  controls.restore.addEventListener('click', () => void send(true));
  controls.back.addEventListener('click', options.onBack);
  draw();

  return el(
    'form',
    {
      class: 'account-form recover-form',
      attrs: { novalidate: '', 'aria-label': t('recovery.withCode') },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send(false);
        },
      },
    },
    el('div', { class: 'account-field' }, el('h3', { class: 'label', text: t('recovery.withCode') }), el('p', { class: 'fine', text: t('recovery.forgot.lede') })),
    field(t('account.username'), username),
    field(t('recovery.title'), code, t('recovery.codeHint')),
    field(t('account.newPassword'), password, t('account.newPasswordHint')),
    el('div', { class: 'actions' }, controls.submit, controls.restore, controls.back),
    error,
  );
}
