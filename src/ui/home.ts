import './shell.css';
import { getAccount } from '../account/client.ts';
import type { DailyState } from '../daily/client.ts';
import type { IndicatorState } from '../daily/view.ts';
import type { GuesserKind } from '../game/guesser.ts';
import type { LocationSet } from '../game/locations.ts';
import { parseChallenge, type Challenge, type GameOptions } from '../game/settings.ts';
import { t, tn } from '../i18n/index.ts';
import { getQueue, leaveMatch, type MatchState } from '../multiplayer/client.ts';
import { getFriends, pendingCount } from '../social/client.ts';
import { aboutPane } from './about-pane.ts';
import { accountPane } from './account.ts';
import { dailyIndicator } from './daily-indicator.ts';
import { dailyPane } from './daily-pane.ts';
import { el } from './dom.ts';
import { friendsPane } from './friends-pane.ts';
import { guestBadge } from './guest-parts.ts';
import { guesserPane } from './guesser-pane.ts';
import { leaderboardsPane } from './leaderboards-pane.ts';
import { mapEditorPane } from './map-editor-pane.ts';
import { mapPage } from './map-page.ts';
import { readPreset } from './map-preset.ts';
import { mapsPane } from './maps-pane.ts';
import { createPartyPane, joinPartyPane, queuePane } from './multiplayer-panes.ts';
import { install, watchInstall } from '../pwa.ts';
import { moderationPane } from './moderation-pane.ts';
import { NAV_GROUPS, RESTRICTED, hrefFor, navFor, navGroupName, navName, partyCode, sameView, type NavId, type View } from './nav.ts';
import { onlineCount } from './online-count.ts';
import type { Pane } from './pane.ts';
import { profilePane } from './profile-pane.ts';
import type { Snap } from './providers.ts';
import { onSessionEnded } from './session-ended.ts';
import { singleplayerPane } from './singleplayer-pane.ts';
import { streakPane, type StreakSetup } from './streak-pane.ts';

export interface HomeHandlers {
  onStart: (options: GameOptions) => void;
  onAcceptChallenge: (challenge: Challenge) => void;
  onStreak: (setup: StreakSetup) => void;
  /** start a Country Guesser or a Continent Guesser run */
  onGuesser: (kind: GuesserKind) => void;
  /** a party was created or joined (its state), or a queue found a match (its id) */
  onMatch: (match: MatchState | string) => void;
  /** go back into a match the player is still in, by its id */
  onRejoin: (matchId: string) => void;
  /** play the two-round guided game */
  onTutorial: () => void;
  onDaily: (daily: DailyState) => void;
  /** go to an address inside the app, such as a player's profile; `state` rides along in the history entry */
  onNavigate: (href: string, state?: unknown) => void;
  /** the map editor's Street View lookup; null when this site has no Google imagery, which community maps are made of */
  snapper: (() => Promise<Snap>) | null;
  /** the list of places in use, for the maps that can be played */
  loadPlaces: () => Promise<LocationSet>;
}

export interface Home {
  node: HTMLElement;
  /** Shows a view. Does nothing when it is already showing. */
  show: (view: View) => void;
  dispose: () => void;
}

/**
 * A pane can still have a request out when the player moves on (a party being created, a queue
 * answering). Its handlers then do nothing, so a late reply cannot pull the player into a match.
 */
function whileShown(handlers: HomeHandlers, shown: () => boolean): HomeHandlers {
  const guard =
    <T>(run: (value: T) => void) =>
    (value: T) => {
      if (shown()) {
        run(value);
      }
    };
  return {
    ...handlers,
    onStart: guard(handlers.onStart),
    onAcceptChallenge: guard(handlers.onAcceptChallenge),
    onStreak: guard(handlers.onStreak),
    onGuesser: guard(handlers.onGuesser),
    onMatch: guard(handlers.onMatch),
    onTutorial: () => {
      if (shown()) {
        handlers.onTutorial();
      }
    },
    onDaily: guard(handlers.onDaily),
  };
}

interface Session {
  /** shows how many friend requests and invites are waiting */
  setPending: (count: number) => void;
  /** marks the Daily item: not played today, streak at risk, or played */
  setDaily: (state: IndicatorState) => void;
  /** asks the server again who is signed in and what is waiting for them */
  refresh: () => void;
}

/** Builds the pane for one view. The address is read here, so a pane always matches the link that opened it. */
function buildPane(view: View, handlers: HomeHandlers, session: Session): Pane {
  switch (view.pane) {
    case 'singleplayer':
      return singleplayerPane(parseChallenge(location.search), readPreset(history.state), handlers);
    case 'moderation':
      return moderationPane();
    case 'streak':
      return streakPane(handlers.onStreak);
    case 'country':
    case 'continent':
      return guesserPane(view.pane, handlers.onGuesser);
    case 'about':
      return aboutPane();
    case 'ranked':
    case 'unranked':
    case 'team':
      return queuePane(view.pane, handlers.onMatch, session.refresh);
    case 'create':
      return createPartyPane(handlers.onMatch, handlers.loadPlaces, readPreset(history.state));
    case 'join':
      return joinPartyPane(partyCode(location.search), handlers.onMatch, session.refresh);
    case 'daily':
      return dailyPane(handlers.onDaily, session.setDaily);
    case 'leaderboards':
      return leaderboardsPane();
    case 'friends':
      return friendsPane({ onMatch: handlers.onMatch, onPending: session.setPending });
    case 'account':
      return accountPane(session.refresh, handlers.onTutorial);
    case 'profile':
      return profilePane(view.username);
    case 'maps':
      return mapsPane(handlers);
    case 'map':
      return mapPage(view.slug, { onNavigate: handlers.onNavigate, googleReady: handlers.snapper !== null });
    case 'editor':
      return mapEditorPane(view.slug, handlers);
  }
}

function buildNav() {
  const links = new Map<NavId, HTMLAnchorElement>();
  const badge = el('span', { class: 'badge' });
  badge.hidden = true;
  const groups = NAV_GROUPS.map((group) =>
    el(
      'div',
      { class: 'nav-group' },
      el('p', { class: 'label nav-label', text: navGroupName(group.id) }),
      el(
        'ul',
        {},
        ...group.items.map((item) => {
          const link = el('a', { class: 'nav-item', attrs: { href: hrefFor(item.id) } }, navName(item.id), item.id === 'friends' ? badge : null);
          links.set(item.id, link);
          const row = el('li', {}, link);
          // an item for some players only stays out of sight until the account says it is theirs
          row.hidden = RESTRICTED.includes(item.id);
          return row;
        }),
      ),
    ),
  );
  const nav = el('nav', { class: 'nav', attrs: { id: 'main-nav', 'aria-label': t('home.nav') } }, ...groups);
  // on a phone the list folds away behind this button, which names the pane that is showing
  const current = el('span', { class: 'menu-current' });
  const word = el('span', { class: 'menu-word', text: t('home.menu') });
  const toggle = el('button', { class: 'menu-toggle', attrs: { type: 'button', 'aria-controls': nav.id, 'aria-expanded': 'false' } }, current, word);
  // where the browser allows installing the site as an app, the offer sits at the foot of the list
  const installButton = el('button', { class: 'nav-item install', text: t('home.install'), attrs: { type: 'button' }, on: { click: () => void install() } });
  watchInstall((available) => {
    installButton.hidden = !available;
  });
  nav.append(installButton);
  const setOpen = (open: boolean) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    // the word says what a tap does next
    word.textContent = t(open ? 'home.menuClose' : 'home.menu');
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  return { nav, toggle, links, badge, current, setOpen };
}

/** For a signed-in player who is still in a match (a reload, a closed tab): go back in, or leave it for good. */
function resumeBanner(matchId: string, onRejoin: (id: string) => void): HTMLElement {
  const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  // leaving is for good, so it is the one in the danger colour; going back in is the filled button beside it
  const leave = el('button', { class: 'button danger', text: t('home.resume.leave'), attrs: { type: 'button' } });
  const banner = el(
    'section',
    { class: 'resume', attrs: { 'aria-label': t('home.resume.label') } },
    el('p', { class: 'prose', text: t('home.resume.text') }),
    el('div', { class: 'actions' }, el('button', { class: 'button primary', text: t('home.resume.rejoin'), attrs: { type: 'button' }, on: { click: () => onRejoin(matchId) } }), leave),
    error,
  );
  leave.addEventListener('click', async () => {
    leave.disabled = true;
    const left = await leaveMatch(matchId);
    if (left.ok) {
      banner.remove();
    } else {
      leave.disabled = false;
      error.textContent = left.error;
    }
  });
  return banner;
}

/**
 * The home screen: a sidebar of nav links and, beside it, the pane for the selected one. The links
 * are plain `#item` anchors, so the browser keeps the history; the caller listens for the address
 * changing and calls `show`.
 */
export function renderHome(initial: View, handlers: HomeHandlers, checkResume: boolean): Home {
  const { nav, toggle, links, badge, current: menuCurrent, setOpen } = buildNav();
  const dailyMark = dailyIndicator(links.get('daily')!);
  // how many players are online; asking is also the heartbeat that marks this player as seen
  const online = onlineCount();
  const resumeHost = el('div', { class: 'resume-host' });
  // a guest's name, where there is one, with the way to sign up
  const guestHost = el('div', { class: 'guest-host' });
  const paneHost = el('div', { class: 'pane-host' });
  let current: { view: View; pane: Pane } | null = null;
  /** goes up each time a pane is replaced or the home screen is left */
  let shown = 0;
  let disposed = false;

  const session: Session = {
    setPending: (count) => {
      badge.hidden = count === 0;
      badge.textContent = count === 0 ? '' : String(count);
      badge.setAttribute('aria-label', tn('home.waiting', count));
    },
    setDaily: dailyMark.set,
    refresh: () => void refresh(true),
  };

  /**
   * Asks who is signed in; for a player, what is waiting on the friends pane and, when `resume` is
   * set, whether a match is still open. That last check is for a fresh page or a fresh sign-in:
   * straight after leaving a match the server may not have heard yet.
   */
  async function refresh(resume: boolean): Promise<void> {
    const account = await getAccount();
    if (disposed) {
      return;
    }
    // the Daily item is marked for whoever is looking (a new account first takes over the dailies its player kept as a visitor); the daily pane marks it itself
    if (account.ok && current?.view.pane !== 'daily') {
      void dailyMark.refresh(account.data.account?.username ?? null);
    }
    const moderator = account.ok && Boolean(account.data.account?.moderator);
    for (const id of RESTRICTED) {
      const row = links.get(id)?.parentElement;
      if (row) {
        row.hidden = !moderator;
      }
    }
    const guest = account.ok ? account.data.guest : null;
    guestHost.replaceChildren(...(guest === null ? [] : [guestBadge(guest)]));
    if (!account.ok || !account.data.account) {
      session.setPending(0);
      resumeHost.replaceChildren();
      // a guest has no friends to ask about, but can be in a match that a reload should lead back to
      const queue = guest !== null && resume ? await getQueue() : null;
      if (!disposed && queue?.ok && !queue.data.queued && queue.data.matchId !== null) {
        resumeHost.replaceChildren(resumeBanner(queue.data.matchId, handlers.onRejoin));
      }
      return;
    }
    const [friends, queue] = await Promise.all([getFriends(), resume ? getQueue() : null]);
    if (disposed) {
      return;
    }
    session.setPending(friends.ok ? pendingCount(friends.data) : 0);
    const open = queue?.ok && !queue.data.queued ? queue.data.matchId : null;
    if (resume) {
      resumeHost.replaceChildren(...(open ? [resumeBanner(open, handlers.onRejoin)] : []));
    }
  }

  function show(view: View): void {
    setOpen(false);
    if (current && sameView(current.view, view)) {
      return;
    }
    current?.pane.dispose?.();
    const mine = ++shown;
    current = { view, pane: buildPane(view, whileShown(handlers, () => shown === mine), session) };
    const marked = navFor(view);
    links.forEach((link, id) => {
      if (id === marked) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
    menuCurrent.textContent = marked === null ? t('home.profile') : navName(marked);
    paneHost.replaceChildren(current.pane.node);
  }

  const node = el(
    'div',
    { class: 'shell' },
    el('aside', { class: 'sidebar' }, el('h1', { class: 'wordmark' }, 'Wherefall', el('span', { class: 'caret', attrs: { 'aria-hidden': 'true' } })), guestHost, toggle, nav, online.node),
    el('main', { class: 'pane' }, el('div', { class: 'pane-column' }, resumeHost, paneHost)),
  );
  // a link to somewhere in the app (a profile, a map's page) opens in place, keeping the browser's history
  node.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-nav]') : null;
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      handlers.onNavigate(link.getAttribute('href') ?? '');
    }
  });

  show(initial);
  void refresh(checkResume);
  // a pane was told the session is over (the password changed elsewhere, the account signed out
  // everywhere): the sidebar asks again who is looking, and stops showing what was the account's
  const unwatch = onSessionEnded(() => void refresh(false));

  return {
    node,
    show,
    dispose: () => {
      disposed = true;
      shown += 1;
      unwatch();
      online.dispose();
      current?.pane.dispose?.();
    },
  };
}
