import './account.css';
import { getAccount, type AccountState } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { guestNotice } from './guest-parts.ts';
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
  /** what the notice says needs an account: "Multiplayer", "Friends", "Playing" */
  what: string;
}

/** What a gate hands the pane it lets in. */
export interface GateTools {
  /** the server said the session is over (`REFUSALS.signIn`): the pane is closed and the way back in is shown */
  ended: () => void;
}

/** Where a gate shows what it has to say, and what it does for a player it lets in. */
interface Door {
  /** shown in the pane's place: the line while the server is asked, its error, or the notice for someone it is closed to */
  shut: (shown: HTMLElement) => void;
  open: (account: Account) => void;
  /** true once the pane has been left: an answer that comes after is dropped */
  left: () => boolean;
}

/**
 * The account check every pane that plays opens with: playing takes an account. A signed-in player
 * is let in; a visitor is sent to the account pane, and a guest left from before playing took an
 * account is told what signing up adds. A pane of online play is closed to a banned account as
 * well; playing alone is not. `note` says why a player is seeing the notice again.
 */
async function admit(gate: Gate, online: boolean, door: Door, note = ''): Promise<void> {
  door.shut(statusLine(t('pane.checkingAccount')));
  const result = await getAccount();
  if (door.left()) {
    return;
  }
  if (!result.ok) {
    door.shut(errorBox(result.error, () => void admit(gate, online, door, note)));
    return;
  }
  const { account, guest } = result.data;
  if (!account) {
    door.shut(guest === null ? signInNotice(gate.what, note) : guestNotice(guest));
  } else if (online && account.banned) {
    door.shut(bannedNotice());
  } else {
    door.open(account);
  }
}

/**
 * A pane of online play, which only a signed-in player can use. Everyone is told what the pane is;
 * nobody is shown a control the server would refuse.
 */
export function accountOnly(gate: Gate, build: (account: Account, tools: GateTools) => Pane): Pane {
  const body = el('div', { class: 'pane-body' });
  let inner: Pane | null = null;
  let disposed = false;

  const door: Door = {
    shut: (shown) => body.replaceChildren(shown),
    open: (account) => {
      const ended = () => {
        inner?.dispose?.();
        inner = null;
        // the sidebar stops showing the account
        announceSessionEnded();
        void admit(gate, true, door, t('session.ended'));
      };
      inner = build(account, { ended });
      body.replaceChildren(inner.node);
    },
    left: () => disposed,
  };
  void admit(gate, true, door);

  const facts = (gate.facts ?? []).map(factLine);
  return {
    node: pane(gate.title, gate.lede, facts.length > 0 ? el('div', { class: 'facts' }, ...facts) : null, body),
    dispose: () => {
      disposed = true;
      inner?.dispose?.();
    },
  };
}

/**
 * A pane that starts a game alone, which takes an account too. The pane is built whole, under its
 * own name, for a signed-in player; until the server has said who is looking, and for anyone it
 * does not know, `gate` gives the name and the line it stands under.
 */
export function playersOnly(gate: Gate, build: () => Pane): Pane {
  // a stack like any other of the column, so what it holds keeps the pane's measure
  const host = el('div', { class: 'pane-body' });
  let inner: Pane | null = null;
  let disposed = false;

  void admit(gate, false, {
    shut: (shown) => host.replaceChildren(pane(gate.title, gate.lede, shown)),
    open: () => {
      inner = build();
      host.replaceChildren(inner.node);
    },
    left: () => disposed,
  });

  return {
    node: host,
    dispose: () => {
      disposed = true;
      inner?.dispose?.();
    },
  };
}
