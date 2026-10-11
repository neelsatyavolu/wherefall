import { REFUSALS } from '../account/client.ts';
import type { LocationSet } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import { createParty, joinParty, type MatchSettings } from '../multiplayer/client.ts';
import { DEFAULT_PARTY } from '../multiplayer/party-view.ts';
import { el } from './dom.ts';
import { signUpLink } from './guest-parts.ts';
import type { MapPreset } from './map-preset.ts';
import { navName } from './nav.ts';
import { accountOnly, errorLine, guestsWelcome, type Pane } from './pane.ts';
import { partyForm } from './party-form.ts';
import type { EnterMatch } from './queue-pane.ts';
import { statusBox } from './status-box.ts';

/** The party panes: creating one and joining one. The form itself is in `party-form.ts`, the matchmaking panes in `queue-pane.ts`. */
export { queuePane } from './queue-pane.ts';

/** The settings for a private match. Creating it opens its lobby, where the code to share is. */
export function createPartyPane(onMatch: EnterMatch, loadPlaces: () => Promise<LocationSet>, preset: MapPreset | null): Pane {
  /** `ended` closes the pane and shows the way to sign in, when the server says the session is over. */
  const create = async (settings: MatchSettings, ended: () => void): Promise<string | null> => {
    const created = await createParty(settings);
    if (!created.ok) {
      if (created.error === REFUSALS.signIn) {
        ended();
        return null;
      }
      return created.error;
    }
    onMatch(created.data);
    return null;
  };
  return accountOnly(
    {
      title: navName('create'),
      lede: t('party.create.lede'),
      facts: [t('party.create.facts')],
      what: t('match.multiplayer'),
    },
    (_account, tools) => ({ node: partyForm({ name: 'party', initial: DEFAULT_PARTY, submit: t('party.create.submit'), loadPlaces, preset, onSubmit: (settings) => create(settings, tools.ended) }) }),
  );
}

/**
 * For a guest whose join was refused because the party's host has turned "Allow guests" off: that
 * the party is for accounts, and the way to one. The server can only say so once the join is tried.
 */
const accountsOnlyNotice = (): HTMLElement => statusBox('error', t('party.accountsOnly.label'), t('party.accountsOnly'), signUpLink('button primary'));

/** `onEnded` is called when the server says the session is over, which a guest's is after a day. */
function joinForm(code: string, onMatch: EnterMatch, onEnded: () => void): HTMLElement {
  const input = el('input', {
    class: 'account-input code-input',
    attrs: { id: 'party-code', name: 'code', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '12', value: code },
  });
  const error = errorLine();
  const submit = el('button', { class: 'button accent', text: t('party.join.submit'), attrs: { type: 'submit' } });

  const send = async () => {
    const typed = input.value.trim();
    if (typed === '') {
      error.textContent = t('party.join.empty');
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const joined = await joinParty(typed);
    if (joined.ok) {
      onMatch(joined.data);
      return;
    }
    if (joined.error === REFUSALS.signIn) {
      onEnded();
      return;
    }
    if (joined.error === REFUSALS.accountsOnly) {
      // asking again as a guest would be refused again: the notice takes the form's place
      form.replaceWith(accountsOnlyNotice());
      return;
    }
    submit.disabled = false;
    error.textContent = joined.error;
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
    el('div', { class: 'account-field' }, el('label', { class: 'label', text: t('common.partyCode'), attrs: { for: input.id } }), input),
    el('div', { class: 'actions' }, submit),
    error,
  );
  return form;
}

/**
 * A field for a party's code, already filled in when the address is a join link. A guest can join
 * a party too; `onSession` is called when a visitor becomes one here.
 */
export function joinPartyPane(code: string, onMatch: EnterMatch, onSession?: () => void): Pane {
  return guestsWelcome(
    {
      title: navName('join'),
      lede: t('party.join.lede'),
      facts: [t('party.join.facts')],
      what: t('match.multiplayer'),
    },
    (_who, tools) => ({ node: joinForm(code, onMatch, tools.ended) }),
    onSession,
  );
}
