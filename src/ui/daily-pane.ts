import './daily.css';
import { getAccount } from '../account/client.ts';
import { beginDaily } from '../daily/begin.ts';
import { claimOnce, takeClaimNote } from '../daily/claim.ts';
import { getDaily, type DailyState } from '../daily/client.ts';
import { lostDailies } from '../daily/lost.ts';
import { indicatorState, viewed, type IndicatorState, type Standing, type Viewed } from '../daily/view.ts';
import { visitorDailies } from '../daily/visitor-store.ts';
import { t } from '../i18n/index.ts';
import { actionBar } from './action-bar.ts';
import { copyButton } from './copy-button.ts';
import { dailyBoard, type Viewer } from './daily-board.ts';
import { distributionChart } from './daily-chart.ts';
import { countdown, headFacts, historyStrip, recordGrid, resultFigures } from './daily-parts.ts';
import { dailyShareText, dailyUrl } from './daily-words.ts';
import { el, withNodes } from './dom.ts';
import { forgetLocationSets } from './location-sets.ts';
import { hrefFor } from './nav.ts';
import { errorLine, pane, statusLine, type Pane } from './pane.ts';
import { errorBox } from './status-box.ts';

/** Everything the pane is drawn from. */
interface Shown {
  daily: DailyState;
  /** the account looking, or null for a visitor or a guest */
  viewer: Viewer | null;
  /** false when the account could not be read: nothing is then said about signing in */
  known: boolean;
  view: Viewed;
  /** true when results played before signing in could not be added to the account */
  claimFailed: boolean;
}

const signInLink = () => el('a', { text: t('common.signIn'), attrs: { href: hrefFor('account') } });
const withSignIn = (text: string) => el('p', { class: 'prose' }, ...withNodes(text, { signIn: signInLink() }));

function shareButton(daily: DailyState, standing: Standing): HTMLElement {
  return copyButton({
    label: t('summary.shareResult'),
    copied: t('summary.resultCopied'),
    text: () => dailyShareText({ date: daily.date, score: standing.score, maxScore: standing.maxScore, rounds: standing.rounds, beat: standing.beat }, dailyUrl()),
    fieldLabel: t('summary.resultLabel'),
  });
}

/** One attempt a day, and it is used: the result when there is one, else that it was begun and left. */
function spent(shown: Shown): HTMLElement[] {
  const { standing } = shown.view;
  if (!standing) {
    // begun and left; or played to the end and lost, when the site was updated under the game
    const why = lostDailies.is(shown.daily.date) ? t('daily.stale.spent') : t('daily.started');
    return [el('p', { class: 'prose', text: why }), el('p', { class: 'fine', text: t('daily.againNote') })];
  }
  const visitor = shown.known && !shown.viewer;
  // a result kept before starts were answered with tokens can never move to an account: it is not offered
  const keptHere = shown.view.claimable ? withSignIn(t('daily.visitor.done')) : el('p', { class: 'prose', text: t('daily.visitor.unclaimable') });
  return [
    ...resultFigures(standing),
    visitor ? keptHere : null,
    el('div', { class: 'actions' }, shareButton(shown.daily, standing)),
    el('p', { class: 'fine', text: t('daily.againNote') }),
  ].filter((node): node is HTMLElement => node !== null);
}

/** What a player who can still play is told: that a visitor's result stays in this browser, or that there is one attempt. */
function invitation(shown: Shown): HTMLElement {
  if (shown.viewer) {
    return el('p', { class: 'prose', text: t('daily.notPlayed') });
  }
  return shown.known ? withSignIn(t('daily.visitor.open')) : el('p', { class: 'prose', text: t('daily.firstCounts') });
}

/** Today's challenge: the day and its rules, the player's one attempt and what came of it, their streak and records, the day's scores and its leaderboard. */
export function dailyPane(onPlay: (daily: DailyState) => void, onState: (state: IndicatorState) => void = () => {}): Pane {
  const body = el('div', { class: 'pane-stack' });
  let disposed = false;
  /** stops what the pane showing has running: its clock, its leaderboard's requests */
  let stopParts: () => void = () => {};

  /**
   * Begins the one attempt, then starts the game. Everyone's attempt begins on the server: an
   * account's is marked there, and anyone else is answered with a token that is kept in this
   * browser with the attempt (`beginDaily`), so the result can move to an account made later.
   */
  async function begin(shown: Shown, button: HTMLButtonElement, error: HTMLElement): Promise<void> {
    button.disabled = true;
    error.textContent = '';
    const outcome = await beginDaily(shown.daily.date);
    if (disposed) {
      return;
    }
    if (outcome === 'play') {
      // the three places are drawn from the list as the server has it now: a page left open since before
      // an update would draw others from the list it read then, and the server would refuse the result
      forgetLocationSets();
      onPlay(shown.daily);
    } else if (outcome === 'done') {
      // the result came in from somewhere else since this page was drawn
      void load();
    } else {
      error.textContent = outcome.error;
      button.disabled = false;
    }
  }

  function standing(shown: Shown): HTMLElement {
    const failed = shown.claimFailed ? errorBox(t('daily.claimFailed')) : null;
    if (shown.view.state !== 'open') {
      return el('div', { class: 'daily-you' }, failed, ...spent(shown));
    }
    const error = errorLine();
    const button = el('button', { class: 'button accent', text: t('daily.play'), attrs: { type: 'button' } });
    button.addEventListener('click', () => void begin(shown, button, error));
    return el('div', { class: 'daily-you' }, failed, invitation(shown), actionBar(error, button));
  }

  function draw(shown: Shown): void {
    const { daily, view } = shown;
    const clock = countdown(daily, () => void load());
    const board = dailyBoard(daily, shown.viewer);
    stopParts = () => {
      clock?.stop();
      board.dispose();
    };
    body.replaceChildren(
      ...[
        headFacts(daily, clock?.node ?? null),
        standing(shown),
        recordGrid(daily, view.state),
        historyStrip(view.history, daily.date),
        distributionChart(daily.distribution, view.standing?.score ?? null),
        board.node,
      ].filter((node): node is HTMLElement => node !== null),
    );
    onState(indicatorState(view.state, daily.streak));
  }

  async function load(): Promise<void> {
    stopParts();
    body.replaceChildren(statusLine(t('daily.loading')));
    const [first, account] = await Promise.all([getDaily(), getAccount()]);
    if (disposed) {
      return;
    }
    if (!first.ok) {
      body.replaceChildren(errorBox(first.error, () => void load()));
      return;
    }
    // when the account cannot be read, say nothing about it rather than guess
    const signedIn = account.ok ? account.data.account : null;
    const viewer = signedIn ? { username: signedIn.username, country: signedIn.country } : null;
    // results kept from before the account was made go to it first, and then the day is read again with them in it
    const claimed = viewer ? await claimOnce(viewer.username) : 'nothing';
    const again = claimed === 'claimed' ? await getDaily() : first;
    if (disposed) {
      return;
    }
    const daily = again.ok ? again.data : first.data;
    draw({ daily, viewer, known: account.ok, view: viewed(daily, viewer !== null, visitorDailies.read()), claimFailed: viewer !== null && takeClaimNote(viewer.username) });
  }

  void load();

  return {
    node: pane(t('nav.item.daily'), t('daily.lede'), body),
    dispose: () => {
      disposed = true;
      stopParts();
    },
  };
}
