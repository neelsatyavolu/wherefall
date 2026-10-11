import { REFUSALS } from '../account/client.ts';
import { t } from '../i18n/index.ts';
import { joinParty, type MatchState } from '../multiplayer/client.ts';
import { friendAction, getFriends, pendingCount, type Friend, type FriendAction, type Friends } from '../social/client.ts';
import { el } from './dom.ts';
import { leagueName } from './league.ts';
import { navName } from './nav.ts';
import { accountOnly, errorLine, statusLine, type Pane } from './pane.ts';
import { presenceLine, refreshPresence } from './presence-line.ts';
import { playerName, profileLink } from './profile-link.ts';
import { askInRow } from './row-confirm.ts';
import { errorBox } from './status-box.ts';

/** How often the lists are asked for again while the pane is open: an invite only lasts ten minutes. */
const REFRESH_MS = 10_000;

interface FriendsHandlers {
  onMatch: (match: MatchState) => void;
  /** how many requests and invites are waiting, for the badge in the sidebar */
  onPending: (count: number) => void;
}

type Act = (run: () => ReturnType<typeof getFriends>) => Promise<void>;

const button = (text: string, label: string, run: () => void, kind = 'ghost') =>
  el('button', { class: `button ${kind}`, text, attrs: { type: 'button', 'aria-label': label }, on: { click: run } });

function section(title: string, rows: HTMLElement[]): HTMLElement | null {
  return rows.length === 0 ? null : el('section', { class: 'account-section', attrs: { 'aria-label': title } }, el('h3', { class: 'label', text: title }), el('ul', { class: 'player-list' }, ...rows));
}

const row = (...children: Array<Node | null>) => el('li', { class: 'player-row' }, ...children);
const actions = (...buttons: Array<Node | null>) => el('div', { class: 'row-actions' }, ...buttons);

/**
 * What can be done about a friend: join the party they are in, or remove them. Removing is a plain
 * button in the row, and is asked once more there before it happens; only that question is in the
 * danger colour, so a list of friends is not a column of red.
 */
function friendActions(friend: Friend, act: Act, join: (code: string) => void): HTMLElement {
  const { username } = friend;
  const node: HTMLElement = actions(
    friend.party ? button(t('party.join.submit'), t('friends.joinPartyOf', { name: username }), () => join(friend.party ?? '')) : null,
    button(t('common.remove'), t('friends.removeName', { name: username }), () =>
      askInRow(node, { question: t('friends.removeConfirm', { name: username }), yes: t('common.remove'), run: () => act(() => friendAction('remove', username)) }),
    ),
  );
  return node;
}

/**
 * The lists. One kind of button is filled on this pane: taking up a party invite, the only thing
 * here that will not wait. Everything else is a ghost.
 */
function lists(friends: Friends, act: Act, join: (code: string) => void): HTMLElement[] {
  const say = (action: FriendAction, username: string) => () => void act(() => friendAction(action, username));
  const all = [
    section(
      t('friends.invites'),
      friends.invites.map((invite) =>
        row(
          el('span', { class: 'player-name' }, profileLink(invite.from)),
          el('span', { class: 'tag', text: t('friends.invitedYou') }),
          actions(button(t('party.join.submit'), t('friends.joinPartyOf', { name: invite.from }), () => join(invite.code), 'primary')),
        ),
      ),
    ),
    section(
      t('friends.requests'),
      friends.incoming.map((name) =>
        row(
          el('span', { class: 'player-name' }, profileLink(name)),
          actions(button(t('friends.accept'), t('friends.acceptName', { name }), say('accept', name)), button(t('friends.decline'), t('friends.declineName', { name }), say('decline', name))),
        ),
      ),
    ),
    section(
      t('friends.list'),
      friends.friends.map((friend) =>
        row(
          el('span', { class: 'player-name' }, playerName(friend.username, { country: friend.country })),
          el('span', { class: 'tag', text: [t('friends.level', { level: friend.level }), leagueName(friend.league)].join(' · ') }),
          presenceLine(friend),
          friendActions(friend, act, join),
        ),
      ),
    ),
    section(
      t('friends.sent'),
      // removing is also how a player takes back a request of their own
      friends.outgoing.map((name) => row(el('span', { class: 'player-name' }, profileLink(name)), actions(button(t('common.cancel'), t('friends.cancelRequest', { name }), say('remove', name))))),
    ),
  ].filter((node) => node !== null);
  return all.length > 0 ? all : [el('p', { class: 'prose', text: t('friends.empty') })];
}

function friendsBody(handlers: FriendsHandlers, ended: () => void): Pane {
  const body = el('div', { class: 'pane-stack' });
  const error = errorLine();
  const input = el('input', {
    class: 'account-input',
    attrs: { id: 'friend-username', name: 'username', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '20' },
  });
  let disposed = false;
  let loaded = false;
  let drawn = '';

  function show(friends: Friends): void {
    loaded = true;
    handlers.onPending(pendingCount(friends));
    // the quiet refresh usually brings nothing new: leave the page, and the player's focus, alone then
    const key = JSON.stringify(friends);
    if (key === drawn) {
      // nothing new, but time has passed: "3 minutes ago" is written again
      refreshPresence(body);
      return;
    }
    drawn = key;
    body.replaceChildren(...lists(friends, act, (code) => void join(code)));
  }

  /** Runs a request that answers with the lists, and shows them or the reason it was refused. */
  const act: Act = async (run) => {
    error.textContent = '';
    const result = await run();
    if (disposed) {
      return;
    }
    if (result.ok) {
      show(result.data);
    } else if (result.error === REFUSALS.signIn) {
      over();
    } else if (loaded) {
      error.textContent = result.error;
    } else {
      body.replaceChildren(errorBox(result.error, () => void act(() => getFriends())));
    }
  };

  /** The session ended somewhere else (signed out in another tab, the account deleted): nothing is asked again, and the gate shows the way back in. */
  function over(): void {
    handlers.onPending(0);
    ended();
  }

  async function join(code: string): Promise<void> {
    const joined = await joinParty(code);
    if (joined.ok) {
      handlers.onMatch(joined.data);
    } else if (disposed) {
      return;
    } else if (joined.error === REFUSALS.signIn) {
      over();
    } else {
      error.textContent = joined.error;
    }
  }

  const form = el(
    'form',
    {
      class: 'inline-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          const username = input.value.trim();
          if (username !== '') {
            input.value = '';
            void act(() => friendAction('request', username));
          }
        },
      },
    },
    el('label', { class: 'label', text: t('friends.add.label'), attrs: { for: input.id } }),
    el('div', { class: 'inline-fields' }, input, el('button', { class: 'button ghost', text: t('friends.add.submit'), attrs: { type: 'submit' } })),
    error,
  );

  body.replaceChildren(statusLine(t('common.loadingFriends')));
  void act(() => getFriends());
  // a quiet refresh: a failure here keeps what is on screen, unless it is the session that is gone
  const quietly = async (): Promise<void> => {
    const result = await getFriends();
    if (disposed) {
      return;
    }
    if (result.ok) {
      show(result.data);
    } else if (result.error === REFUSALS.signIn) {
      over();
    }
  };
  const timer = window.setInterval(() => void quietly(), REFRESH_MS);

  return {
    node: el('div', { class: 'pane-stack' }, form, body),
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}

/** Friends: who is online or when they were last seen, requests both ways, who is in a party you could join, and invites that were sent to you. */
export function friendsPane(handlers: FriendsHandlers): Pane {
  return accountOnly(
    {
      title: navName('friends'),
      lede: t('friends.lede'),
      what: t('friends.what'),
    },
    (_account, tools) => friendsBody(handlers, tools.ended),
  );
}
