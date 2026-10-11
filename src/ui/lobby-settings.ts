import type { LocationSet } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import type { MatchSettings, MatchState } from '../multiplayer/client.ts';
import { partyOffers } from '../multiplayer/party-view.ts';
import { el } from './dom.ts';
import { lockButton, type HostHandlers, type Report } from './host-controls.ts';
import { partyForm, presetFor, settingsParts } from './party-form.ts';

/**
 * A lobby's settings: the line everyone reads, which follows every poll, whether the party is
 * locked, and for the host the way to change the settings and to lock the party.
 */

export interface SettingsHandlers {
  loadPlaces: () => Promise<LocationSet>;
  /** the host replaces the settings; resolves to an error to show, or null */
  onConfigure: (settings: MatchSettings) => Promise<string | null>;
  onLock: HostHandlers['onLock'];
}

/** The settings as one line of data. Each piece is a text of its own, so each is whole in every language. */
function settingsLine(settings: MatchSettings): Array<HTMLElement | string> {
  return settingsParts(settings).flatMap((part, index) => (index === 0 ? [el('span', { text: part })] : [' · ', el('span', { text: part })]));
}

/** `onForm` is told when the host's form opens and when it closes: while it is open, its Save is the screen's one accent button. */
export function lobbySettings(handlers: SettingsHandlers, report: Report, onForm: (open: boolean) => void = () => {}) {
  const line = el('p', { class: 'settings-line' });
  const lockedNote = el('p', { class: 'fine lobby-locked', text: t('party.locked.note'), attrs: { role: 'status' } });
  /** for the host of a party that has stopped taking guests: the ones already in are not put out by that */
  const guestsNote = el('p', { class: 'fine lobby-guests', text: t('party.guests.stay'), attrs: { role: 'status' } });
  const change = el('button', { class: 'button ghost', text: t('party.settings.change'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const lock = lockButton(handlers.onLock, report);
  const controls = el('div', { class: 'actions' }, change, lock.node);
  const formHost = el('div', { class: 'lobby-form' });
  const node = el('section', { class: 'account-section lobby-settings' }, el('h2', { class: 'label', text: t('lobby.settings') }), line, lockedNote, guestsNote, controls, formHost);
  let latest: MatchState | null = null;
  let drawn = '';

  const close = () => {
    formHost.replaceChildren();
    change.hidden = false;
    change.setAttribute('aria-expanded', 'false');
    onForm(false);
  };

  /** The form opens on the settings as they are now, and closes itself once the server has taken the new ones. */
  const open = (settings: MatchSettings) => {
    const save = async (next: MatchSettings) => {
      const refused = await handlers.onConfigure(next);
      if (refused === null) {
        close();
      }
      return refused;
    };
    change.hidden = true;
    change.setAttribute('aria-expanded', 'true');
    onForm(true);
    formHost.replaceChildren(
      partyForm({ name: 'lobby', initial: settings, submit: t('party.settings.save'), loadPlaces: handlers.loadPlaces, preset: presetFor(settings.map), onSubmit: save, onCancel: close }),
    );
  };

  change.addEventListener('click', () => {
    if (latest) {
      open(latest.settings);
    }
  });

  return {
    node,
    update(state: MatchState): void {
      latest = state;
      const key = JSON.stringify(state.settings);
      if (key !== drawn) {
        drawn = key;
        line.replaceChildren(...settingsLine(state.settings));
      }
      lockedNote.hidden = !state.locked;
      lock.update(state.locked);
      // the server's clock does not matter here: nothing in a lobby waits on it
      const offers = partyOffers(state, 0);
      lock.node.hidden = !offers.lock;
      guestsNote.hidden = !(offers.configure && !state.settings.guests && state.players.some((player) => player.guest));
      controls.hidden = !offers.configure && !offers.lock;
      if (!offers.configure) {
        // the party changed hands, or left its lobby: the form goes with the right to send it
        close();
        change.hidden = true;
      } else if (formHost.childElementCount === 0) {
        change.hidden = false;
      }
    },
  };
}
