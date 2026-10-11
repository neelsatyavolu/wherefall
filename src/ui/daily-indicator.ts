import './daily.css';
import { claimOnce } from '../daily/claim.ts';
import { getDaily } from '../daily/client.ts';
import { indicatorState, viewed, type IndicatorState } from '../daily/view.ts';
import { visitorDailies } from '../daily/visitor-store.ts';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

const MARK_ID = 'daily-mark';

/** A shape for each state, so none is told by colour alone: a square (drawn by the stylesheet), an exclamation mark, a tick. */
const GLYPHS: Record<IndicatorState, string> = { open: '', atRisk: '!', done: '✓' };

const label = (state: IndicatorState): string => t(`daily.nav.${state}`);

export interface DailyIndicator {
  /** Shows a state, or nothing when it is not known. */
  set: (state: IndicatorState | null) => void;
  /**
   * Asks the server how today stands for whoever is signed in (`username`, or null for a visitor,
   * who goes by what this browser kept). An account is first given the results kept from before it
   * was made, which is the moment right after signing up.
   */
  refresh: (username: string | null) => Promise<void>;
}

/**
 * The mark beside the Daily item in the sidebar: not played, streak at risk, or played. It sits
 * after the link, which it describes, so the link keeps its own name and a screen reader says the
 * state after it; a pointer resting on the item shows it too.
 */
export function dailyIndicator(link: HTMLAnchorElement): DailyIndicator {
  const node = el('span', { class: 'daily-mark', attrs: { id: MARK_ID, role: 'img' } });
  node.hidden = true;
  link.setAttribute('aria-describedby', MARK_ID);
  link.after(node);
  /** goes up with each question, so a slow answer cannot overwrite a later one */
  let asked = 0;

  const set = (state: IndicatorState | null): void => {
    asked += 1;
    node.hidden = state === null;
    if (state === null) {
      node.removeAttribute('aria-label');
      link.removeAttribute('title');
      return;
    }
    node.dataset.state = state;
    node.textContent = GLYPHS[state];
    node.setAttribute('aria-label', label(state));
    link.title = label(state);
  };

  async function refresh(username: string | null): Promise<void> {
    const mine = ++asked;
    if (username !== null) {
      await claimOnce(username);
    }
    const daily = await getDaily();
    if (mine !== asked) {
      return;
    }
    set(daily.ok ? indicatorState(viewed(daily.data, username !== null, visitorDailies.read()).state, daily.data.streak) : null);
  }

  return { set, refresh };
}
