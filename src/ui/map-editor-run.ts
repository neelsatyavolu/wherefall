import './maps.css';
import { formatNumber, t, tn } from '../i18n/index.ts';
import type { Draft } from '../social/map-editor.ts';
import { addPasted, emptyTally, type Lookups, type Tally } from '../social/map-paste-run.ts';
import type { Pasted } from '../social/map-paste.ts';
import { el } from './dom.ts';

/** What a run of looked-up places needs of the editor around it. */
export interface RunHooks {
  /** the map as it stands when a run starts; until the run ends, only the run changes it */
  draft: () => Draft;
  onChange: (draft: Draft) => void;
  /** told when a run starts and ends, so that nothing else changes the map meanwhile */
  onRunning: (running: boolean) => void;
  lookups: () => Promise<Lookups>;
}

/** What could not be read at all is counted in the words of where it came from: lines of a paste, entries of a file. */
export type UnreadKey = 'editor.pasted.unread' | 'editor.file.unread';

/** The lines of the summary, in the order they are read out. What was added is always said; the rest only when it happened. */
const REASONS = ['duplicate', 'none', 'noCountry', 'noPoint', 'full', 'failed', 'left'] as const;

function summaryLines(tally: Tally, unread: number, unreadKey: UnreadKey): HTMLElement[] {
  const line = (text: string) => el('li', { text });
  return [
    line(tn('editor.pasted.added', tally.added)),
    ...REASONS.filter((reason) => tally[reason] > 0).map((reason) => line(tn(`editor.pasted.${reason}`, tally[reason]))),
    ...(unread > 0 ? [line(tn(unreadKey, unread))] : []),
  ];
}

/**
 * A list of places being looked up, whether it was pasted or came in a file: how far it has got,
 * the button that stops it, and at the end what was added and what could not be, and why. Each
 * place is matched to the nearest panorama as a click on the map is. `summaryLabel` names the
 * summary for a screen reader; `onDraw` is told whenever a run starts or ends, so the form around
 * it can show or hide its own buttons.
 */
export function placesRun(hooks: RunHooks, summaryLabel: string, onDraw: () => void) {
  const stop = el('button', { class: 'button ghost', text: t('editor.pasteStop'), attrs: { type: 'button' } });
  const progress = el('p', { class: 'settings-line', attrs: { role: 'status' } });
  const bar = el('progress', { class: 'paste-progress' });
  const list = el('ul', { class: 'paste-summary' });
  const running = el('div', { class: 'paste-form' }, progress, bar);
  let stopAsked = false;
  let underWay = false;

  const draw = () => {
    stop.hidden = !underWay;
    running.hidden = !underWay;
    onDraw();
  };
  const showProgress = (done: number, total: number) => {
    progress.textContent = t('editor.pasteProgress', { done: formatNumber(done), total: formatNumber(total) });
    bar.max = total;
    bar.value = done;
  };

  /** Looks the places up and adds what it can. Resolves with the tally once the summary is shown. */
  async function start(pasted: Pasted, unreadKey: UnreadKey): Promise<Tally> {
    stopAsked = false;
    underWay = true;
    hooks.onRunning(true);
    list.replaceChildren();
    showProgress(0, pasted.places.length);
    draw();
    const watch = { onProgress: (done: number, total: number, draft: Draft) => (showProgress(done, total), hooks.onChange(draft)), stopped: () => stopAsked };
    // when the lookup itself cannot be loaded, nothing was looked up, and the summary says so
    const result = await hooks.lookups().then(
      (lookups) => addPasted(hooks.draft(), pasted.places, lookups, watch),
      () => ({ draft: hooks.draft(), tally: { ...emptyTally(), failed: pasted.places.length } }),
    );
    hooks.onChange(result.draft);
    underWay = false;
    hooks.onRunning(false);
    list.replaceChildren(...summaryLines(result.tally, pasted.unread, unreadKey));
    draw();
    return result.tally;
  }

  stop.addEventListener('click', () => (stopAsked = true));
  stop.hidden = true;
  running.hidden = true;

  return {
    stop,
    running,
    summary: el('div', { attrs: { role: 'status', 'aria-label': summaryLabel } }, list),
    start,
    /** Empties the summary: what it said was about a list that is no longer the one being added. */
    clear: () => list.replaceChildren(),
    halt: () => (stopAsked = true),
    isRunning: () => underWay,
  };
}
