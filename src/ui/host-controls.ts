import './host.css';
import { t } from '../i18n/index.ts';
import type { MatchPlayer } from '../multiplayer/client.ts';
import type { PlayerOffers } from '../multiplayer/party-view.ts';
import { el } from './dom.ts';
import { icon } from './map-tools.ts';

/**
 * What only a party's host has, as controls: a kick and a hand-over on each other player, the pick
 * of a co-op party, and the lock. Who is offered which is decided in `multiplayer/party-view.ts`; nothing here is drawn for
 * anyone else. The lobby puts these in its rows, a match in its Host panel (`match-host.ts`).
 */

/** Each resolves to an error to show, or null when the server took it. */
export interface HostHandlers {
  onKick: (username: string) => Promise<string | null>;
  onMakeHost: (username: string) => Promise<string | null>;
  onMakePicker: (username: string) => Promise<string | null>;
  onLock: (locked: boolean) => Promise<string | null>;
  onEndRound: () => Promise<string | null>;
}

/** Where a control's refusal is shown: the server's words, or an empty string to clear them. */
export type Report = (error: string) => void;

/** A button that sends one request: off while it is out, and its refusal handed to `report`. */
export function requestButton(className: string, text: string, label: string | null, run: () => Promise<string | null>, report: Report): HTMLButtonElement {
  const button = el('button', { class: className, text, attrs: label === null ? { type: 'button' } : { type: 'button', 'aria-label': label } });
  button.addEventListener('click', async () => {
    button.disabled = true;
    report('');
    const refused = await run();
    // a request that went through redraws whatever holds this button
    button.disabled = false;
    if (refused !== null) {
      report(refused);
    }
  });
  return button;
}

/** three dots: there is more to do with this player */
const MORE_ICON = ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'];

/**
 * A row of players that can carry the host's actions: who it is (`who`: the name, then its tags)
 * and, at the row's end, `actions`. One line and one height whatever the names: the name gives way
 * with an ellipsis, and the actions keep their place (`.host-row` in host.css).
 */
export function hostRow(who: Array<HTMLElement | null>, actions: HTMLElement | null): HTMLLIElement {
  return el('li', { class: 'player-row host-row' }, el('span', { class: 'player-who' }, ...who), actions);
}

/**
 * The host's actions on one player, or null when none is offered. In the row both are quiet
 * (ghosts): a list of forty must not be a wall of red. On a narrow row they stand behind one
 * button of three dots, which opens them under the name. Kick asks first, in the row itself: there
 * the way back is the filled button, and only the removal is in the colour of danger.
 */
export function playerActions(player: Pick<MatchPlayer, 'username'>, offers: PlayerOffers, handlers: Pick<HostHandlers, 'onKick' | 'onMakeHost' | 'onMakePicker'>, report: Report): HTMLElement | null {
  if (!offers.kick && !offers.makeHost && !offers.makePicker) {
    return null;
  }
  const name = player.username;
  const label = t('host.moreLabel', { name });
  const more = el('button', { class: 'button ghost host-more', attrs: { type: 'button', 'aria-label': label, title: label, 'aria-expanded': 'false' } });
  more.append(icon(MORE_ICON));
  const menu = el('div', { class: 'host-menu' });
  const node = el('div', { class: 'row-actions host-actions' }, more, menu);

  const setOpen = (open: boolean) => {
    node.classList.toggle('open', open);
    more.setAttribute('aria-expanded', String(open));
  };

  const showButtons = () => {
    const makeHost = offers.makeHost ? requestButton('button ghost', t('host.makeHost'), t('host.makeHostLabel', { name }), () => handlers.onMakeHost(name), report) : null;
    const makePicker = offers.makePicker ? requestButton('button ghost', t('host.makePicker'), t('host.makePickerLabel', { name }), () => handlers.onMakePicker(name), report) : null;
    const kick = offers.kick ? el('button', { class: 'button ghost', text: t('host.kick'), attrs: { type: 'button', 'aria-label': t('host.kickLabel', { name }) }, on: { click: showConfirm } }) : null;
    node.classList.remove('asking');
    menu.replaceChildren(...[makePicker, makeHost, kick].filter((button) => button !== null));
  };

  function showConfirm(): void {
    const keep = el('button', { class: 'button primary', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: showButtons } });
    const remove = requestButton('button danger', t('host.kickYes'), null, () => handlers.onKick(name), (error) => {
      report(error);
      if (error !== '') {
        showButtons();
      }
    });
    node.classList.add('asking');
    menu.replaceChildren(el('p', { class: 'host-confirm', text: t('host.kickConfirm', { name }), attrs: { role: 'alert' } }), el('div', { class: 'actions' }, keep, remove));
    keep.focus();
  }

  more.addEventListener('click', () => {
    // closing it also drops a question left open
    showButtons();
    setOpen(!node.classList.contains('open'));
  });

  showButtons();
  return node;
}

/** Closes the party to new players, or opens it again. `update` follows the party's lock. */
export function lockButton(onLock: HostHandlers['onLock'], report: Report) {
  let locked = false;
  const node = requestButton('button ghost', t('party.lock'), null, () => onLock(!locked), report);
  return {
    node,
    update(next: boolean): void {
      locked = next;
      const text = t(locked ? 'party.unlock' : 'party.lock');
      if (node.textContent !== text) {
        node.textContent = text;
      }
    },
  };
}
