import './social.css';
import { t, tn } from '../i18n/index.ts';
import { getOnline } from '../social/client.ts';
import { startPresence, type Presence, type PresenceEnv } from '../social/presence.ts';
import { el, formatScore } from './dom.ts';

/** The page itself: seen while its tab is the one showing, on the browser's clock. */
const PAGE: PresenceEnv = {
  visible: () => document.visibilityState === 'visible',
  onVisibility: (run) => {
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  },
  every: (ms, run) => {
    const timer = window.setInterval(run, ms);
    return () => clearInterval(timer);
  },
};

let presence: Presence | null = null;

/**
 * The one presence heartbeat of the page, started the first time it is asked for and never
 * stopped: a player in a game or a match is as much online as one on the home screen, so it keeps
 * going when the home screen is left.
 */
function heartbeat(): Presence {
  presence ??= startPresence(() => getOnline(), PAGE);
  return presence;
}

/**
 * How many players are online, as a quiet line for the sidebar. It shows nothing until the server
 * has answered, and nothing again after a call that failed.
 */
export function onlineCount(): { node: HTMLElement; dispose: () => void } {
  const node = el('p', { class: 'online-count' });
  node.hidden = true;
  const leave = heartbeat().subscribe((online) => {
    node.hidden = online === null;
    node.textContent = online === null ? '' : t('presence.count.short', { count: formatScore(online) });
    // the short form is what shows; the whole sentence is there for a pointer resting on it
    node.title = online === null ? '' : tn('presence.count', online);
  });
  return { node, dispose: leave };
}
