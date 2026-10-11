import { REFUSALS } from '../account/client.ts';
import type { LocationSet } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import { createParty, joinParty, type MatchSettings } from '../multiplayer/client.ts';
import { DEFAULT_PARTY } from '../multiplayer/party-view.ts';
import { el } from './dom.ts';
import type { MapPreset } from './map-preset.ts';
import { navName } from './nav.ts';
import { accountOnly, errorLine, type Pane } from './pane.ts';
import { partyForm } from './party-form.ts';
import type { EnterMatch } from './queue-pane.ts';

/** The party panes: creating one and joining one. The form itself is in `party-form.ts`, the matchmaking panes in `queue-pane.ts`. */
export { queuePane } from './queue-pane.ts';

/** The settings for a private match. Creating it opens its lobby, where the code to share is. `preset` is asked for the map chosen elsewhere when the form is built. */
export function createPartyPane(onMatch: EnterMatch, loadPlaces: () => Promise<LocationSet>, preset: () => MapPreset | null): Pane {
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
    (_account, tools) => ({ node: partyForm({ name: 'party', initial: DEFAULT_PARTY, submit: t('party.create.submit'), loadPlaces, preset: preset(), onSubmit: (settings) => create(settings, tools.ended) }) }),
  );
}

/** `onEnded` is called when the server says the session is over. */
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

/** A field for a party's code, already filled in when the address is a join link. */
export function joinPartyPane(code: string, onMatch: EnterMatch): Pane {
  return accountOnly(
    {
      title: navName('join'),
      lede: t('party.join.lede'),
      facts: [t('party.join.facts')],
      what: t('match.multiplayer'),
    },
    (_account, tools) => ({ node: joinForm(code, onMatch, tools.ended) }),
  );
}
