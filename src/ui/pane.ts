import './account.css';
import { getAccount, type AccountState } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import { playAsGuest } from '../multiplayer/client.ts';
import { el } from './dom.ts';
import { guestLine, guestNotice, visitorChoice } from './guest-parts.ts';
import { hrefFor } from './nav.ts';
import { announceSessionEnded } from './session-ended.ts';
import { bannedBox, errorBox } from './status-box.ts';

type Child = Node | string | null | false;

/** What the home screen shows beside the sidebar for one nav item. */
export interface Pane {
  node: HTMLElement;
  /** stops whatever the pane has running (polling, a place in a queue) when it is left */
  dispose?: () => void;
}

export type Account = NonNullable<AccountState['account']>;

/** Every pane opens the same way: its name, then one sentence on what it is, then its content. */
export function pane(title: string, lede: string | null, ...children: Child[]): HTMLElement {
  return el(
    'section',
    { class: 'pane-section' },
    el('header', { class: 'pane-head' }, el('h2', { class: 'pane-title', text: title }), lede ? el('p', { class: 'lede', text: lede }) : null),
    ...children,
  );
}

export const statusLine = (text: string) => el('p', { class: 'status-inline', text, attrs: { role: 'status' } });

/** A line of text that is announced when it changes; hidden while empty. */
export const errorLine = () => el('p', { class: 'account-error', attrs: { role: 'alert' } });

/** A fact about a game, as a line of data: its settings, a rating. */
export const factLine = (text: string) => el('p', { class: 'settings-line', text });

/** For a view reached from another one (a profile from a leaderboard, a game from the account): the way back. */
export function backButton(): HTMLButtonElement {
  return el('button', { class: 'button ghost back', text: t('pane.back'), attrs: { type: 'button' }, on: { click: () => history.back() } });
}

/** `note` says why a player is seeing it again when their session ran out. */
function signInNotice(what: string, note = ''): HTMLElement {
  return el(
    'div',
    { class: 'notice' },
    note ? el('p', { class: 'prose session-note', text: note, attrs: { role: 'status' } }) : null,
    el('p', { class: 'prose', text: t('pane.needsAccount', { what }) }),
    el('a', { class: 'button primary', text: t('common.signIn'), attrs: { href: hrefFor('account') } }),
  );
}

/** For an account a moderator has banned: nothing online works, and the page says so instead of failing action by action. */
export const bannedNotice = (): HTMLElement => bannedBox();

interface Gate {
  title: string;
  lede: string;
  /** shown under the lede to everyone, such as a mode's fixed settings */
  facts?: readonly string[];
  /** what the notice says needs an account: "Multiplayer", "Friends" */
  what: string;
}

/** Who a pane is built for: a signed-in player, or a guest by the name the server gave them. Never both. */
export interface Who {
  account: Account | null;
  guest: string | null;
}

/** What a gate hands the pane it lets in. */
export interface GateTools {
  /** true when the visitor became a guest on this very pane a moment ago: they asked to play, so the pane may start */
  fresh: boolean;
  /** the server said the session is over (`REFUSALS.signIn`): the pane is closed and the way back in is shown */
  ended: () => void;
}

/**
 * The account check every online pane opens with. Everyone is told what the pane is. A signed-in
 * player gets the pane itself, and so does a guest when `guests` is set; any other guest is told
 * what signing up adds, and a visitor is sent to the account pane or, when `guests` is set, offered
 * a game as a guest as well. Nobody is shown a control the server would refuse.
 */
function gated(gate: Gate, guests: boolean, build: (who: Who, tools: GateTools) => Pane, onSession?: () => void): Pane {
  const body = el('div', { class: 'pane-body' });
  let inner: Pane | null = null;
  let disposed = false;

  function open(who: Who, fresh: boolean): void {
    const ended = () => {
      inner?.dispose?.();
      inner = null;
      // the sidebar stops showing the account: through the pane's own way of saying so, or the one every screen shares
      (onSession ?? announceSessionEnded)();
      void load(t(who.guest === null ? 'session.ended' : 'guest.ended'));
    };
    inner = build(who, { fresh, ended });
    body.replaceChildren(...(who.guest === null ? [] : [guestLine(who.guest)]), inner.node);
  }

  /** Makes this browser a guest, then asks who it is again: a browser already signed in is told its own name. */
  async function becomeGuest(): Promise<string | null> {
    const made = await playAsGuest();
    if (disposed) {
      return null;
    }
    if (!made.ok) {
      return made.error;
    }
    onSession?.();
    void load('', true);
    return null;
  }

  async function load(note = '', fresh = false): Promise<void> {
    body.replaceChildren(statusLine(t('pane.checkingAccount')));
    const result = await getAccount();
    if (disposed) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load(note, fresh)));
      return;
    }
    const { account, guest } = result.data;
    if (account) {
      if (account.banned) {
        body.replaceChildren(bannedNotice());
      } else {
        open({ account, guest: null }, false);
      }
    } else if (guest === null) {
      body.replaceChildren(guests ? visitorChoice(note, becomeGuest) : signInNotice(gate.what, note));
    } else if (guests) {
      open({ account: null, guest }, fresh);
    } else {
      body.replaceChildren(guestNotice(guest));
    }
  }

  void load();

  const facts = (gate.facts ?? []).map(factLine);
  return {
    node: pane(gate.title, gate.lede, facts.length > 0 ? el('div', { class: 'facts' }, ...facts) : null, body),
    dispose: () => {
      disposed = true;
      inner?.dispose?.();
    },
  };
}

/** A pane only a signed-in player can use. A guest is told what signing up adds; a visitor is sent to the account pane. */
export function accountOnly(gate: Gate, build: (account: Account, tools: GateTools) => Pane): Pane {
  // the gate only lets an account through
  return gated(gate, false, (who, tools) => build(who.account!, tools));
}

/**
 * A pane a guest can use too: public unranked games and joining a party. A visitor is offered a
 * game as a guest beside signing in. `onSession` is called when who the browser is has changed.
 */
export function guestsWelcome(gate: Gate, build: (who: Who, tools: GateTools) => Pane, onSession?: () => void): Pane {
  return gated(gate, true, build, onSession);
}
