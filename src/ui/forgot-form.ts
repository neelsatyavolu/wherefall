import { requestPasswordReset } from '../account/reset.ts';
import { language, t } from '../i18n/index.ts';
import { emailInput } from './account-email.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { recoverForm } from './recover-form.ts';

interface ForgotOptions {
  /** what was typed into the sign-in form, so it need not be typed again */
  username: string;
  /** the browser is signed in by recovery code, and this is the account's new one, to show once */
  onRecovered: (recoveryCode: string) => void;
  /** back to the sign-in form */
  onBack: () => void;
}

/**
 * Asks for a reset link by email: the address, and Send. The server answers the same whether or
 * not an account has the address, and so does this: a link is on its way if one does. The email is
 * written in the language the page is in. A refusal (not an address, too many requests, an email
 * that could not be sent) is shown in the server's words.
 */
function requestForm(): HTMLFormElement {
  const email = emailInput('reset-email');
  const submit = el('button', { class: 'button accent', text: t('reset.request.submit'), attrs: { type: 'submit' } });
  const sent = el('p', { class: 'fine', attrs: { role: 'status' } });
  const error = errorLine();
  let busy = false;

  const send = async () => {
    if (busy) {
      return;
    }
    sent.textContent = '';
    if (email.value.trim() === '') {
      error.textContent = t('email.missing');
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = t('reset.request.busy');
    error.textContent = '';
    const result = await requestPasswordReset(email.value.trim(), language());
    busy = false;
    submit.disabled = false;
    submit.textContent = t('reset.request.submit');
    if (result.ok) {
      sent.textContent = t('reset.request.sent');
    } else {
      error.textContent = result.error;
    }
  };

  return el(
    'form',
    {
      class: 'account-form reset-request-form',
      attrs: { novalidate: '', 'aria-label': t('reset.request.title') },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    el('div', { class: 'account-field' }, el('h3', { class: 'label', text: t('recovery.forgot') }), el('p', { class: 'fine', text: t('reset.request.lede') })),
    el('div', { class: 'account-field' }, el('label', { class: 'label', text: t('account.email'), attrs: { for: email.id } }), email),
    el('div', { class: 'actions' }, submit),
    sent,
    error,
  );
}

/**
 * Forgot password: the two ways back in. First a reset link sent to the account's email; under it
 * the recovery code, for a player who cannot get to that email or whose account has none. The way
 * back to the sign-in form is at the end of the second.
 */
export function forgotView(options: ForgotOptions): HTMLElement {
  return el('div', { class: 'forgot' }, requestForm(), recoverForm(options));
}
