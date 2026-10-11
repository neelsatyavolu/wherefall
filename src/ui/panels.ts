import type { LngLat } from '../game/geo.ts';
import { roundXp, starsFor } from '../game/marks.ts';
import { MAX_ROUND_SCORE } from '../game/scoring.ts';
import { shareText } from '../game/share.ts';
import { streetViewUrl } from '../imagery/google.ts';
import { totalScore, type RoundResult, type Session } from '../game/session.ts';
import { WORTH_MOURNING } from '../game/world-streak.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { copyButton } from './copy-button.ts';
import { countUp } from './count-up.ts';
import { el, formatScore } from './dom.ts';
import { showDistance } from './prefs.ts';
import { countryLabel, scoreMark, starRow } from './result-parts.ts';
import { clock } from './round-timer.ts';
import { errorMark, saveNoteLine, type SaveNote } from './status.ts';
import type { StreakNews } from './world-streak.ts';

/** A community map is made of Google panoramas, and Google is not always there: no key, or a quota used up. */
export const communityUnavailable = (): string => t('play.communityUnavailable');

/** A number or a name under its label. `mark` is a small note after it, such as "Perfect". */
export function figure(label: string, value: string | Node, detail?: string, mark?: Node | null): HTMLElement {
  return el(
    'div',
    { class: 'figure' },
    el('span', { class: 'label', text: label }),
    el('span', { class: 'figure-value' }, value, detail ? el('span', { class: 'figure-detail', text: detail }) : null, mark),
  );
}

/** For a round that is over: the place itself, to look around, in a new tab. Never offered while the round is in play. */
export function placeLink(place: LngLat): HTMLAnchorElement {
  return el('a', { class: 'place-link', text: t('result.openInMaps'), attrs: { href: streetViewUrl(place), target: '_blank', rel: 'noopener' } });
}

const distanceText = (result: RoundResult) => (result.distanceKm === null ? t('label.noGuess') : showDistance(result.distanceKm));

/**
 * What the round did to the country streak that world games keep in the background: how long it
 * is now, or that one of two or more was lost. Nothing is there until that is known, and nothing
 * at all when there is nothing to say (no streak, or the borders would not load).
 */
function streakLine(news: Promise<StreakNews | null>): HTMLElement {
  const line = el('p', { class: 'prose streak-line', attrs: { role: 'status' } });
  line.hidden = true;
  void news.then((known) => {
    const running = (known?.streak ?? 0) >= 1;
    if (known && (running || known.ended >= WORTH_MOURNING)) {
      line.textContent = running ? t('result.streak', { count: known.streak }) : t('result.streakEnded', { count: known.ended });
      line.dataset.streak = running ? 'running' : 'ended';
      line.hidden = false;
    }
  });
  return line;
}

/**
 * `streak` is set in a game that counts the background country streak: what this round did to it, once judged.
 * `fact` is set in the tutorial: one sentence about the place.
 */
export function resultPanel(result: RoundResult, credit: string, isLast: boolean, onNext: () => void, streak?: Promise<StreakNews | null>, fact?: string): HTMLElement {
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${(result.score / MAX_ROUND_SCORE) * 100}%`;

  return el(
    'section',
    { class: 'panel result-panel', attrs: { 'aria-label': t('result.label') } },
    el(
      'div',
      { class: 'figures' },
      figure(t('label.distance'), distanceText(result)),
      figure(t('label.points'), formatScore(result.score), ` / ${formatScore(MAX_ROUND_SCORE)}`, scoreMark(result.score)),
      figure(t('label.country'), countryLabel(result.location.country)),
    ),
    el('div', { class: 'bar' }, fill),
    result.guess ? null : el('p', { class: 'prose', text: t('result.timedOut') }),
    result.hinted ? el('p', { class: 'prose', text: t('result.hinted') }) : null,
    streak ? streakLine(streak) : null,
    fact ? el('p', { class: 'prose place-fact', text: fact }) : null,
    el('div', { class: 'panel-notes' }, placeLink(result.location), el('p', { class: 'fine', text: credit })),
    panelActions(
      el('button', {
        class: 'button accent',
        text: isLast ? t('result.seeSummary') : t('result.next'),
        attrs: { type: 'button', 'data-action': 'next' },
        on: { click: onNext },
      }),
    ),
  );
}

/**
 * The foot of a panel: what can be done from here. The first button is the one that moves play on
 * (the next round, the summary, another game; the way home where there is no more to play) and is
 * the panel's one accent button; the rest are ghosts, the way out last.
 */
export function panelActions(...buttons: Array<HTMLElement | null>): HTMLElement {
  return el('div', { class: 'actions panel-actions' }, ...buttons);
}

interface SummaryHandlers {
  onPlayAgain: () => void;
  onHome: () => void;
  challengeUrl: string;
  /** the map's name, for the text "Share result" copies */
  mapName: string;
  /** false where rounds earn no XP (a community map, the tutorial): the table then has no XP column */
  xp: boolean;
  /** what happened to the player's stats; shown once known, nothing when it resolves empty */
  saveNote: Promise<SaveNote>;
  /** set for the daily challenge, which is played once: no "Play again" and no challenge link, and "Share result" copies this text */
  daily?: { shareText: () => string; /** the daily's own part, under the line about the save: it fills itself in once the server has answered */ extras?: HTMLElement };
  /** set for the tutorial, which is nothing to share and is not played again: this foot (the ways into the game) in place of the ordinary one */
  ways?: HTMLElement;
}

/** The text "Share result" copies for a finished local game. */
export function shareResultText(session: Session, mapName: string, url: string): string {
  return shareText({
    title: t('share.title', { map: mapName }),
    score: totalScore(session),
    maxScore: session.rounds.length * MAX_ROUND_SCORE,
    roundScores: session.results.map((result) => result.score),
    url,
    formatNumber,
  });
}

const numCell = (text: string, ...children: Array<Node | null>) => el('td', { class: 'num' }, text, ...children);
const numHead = (text: string) => el('th', { class: 'num', text });

/** The summary's table: a row a round, with the time it took where it was timed and the XP it earned where rounds earn any. */
function roundsTable(results: readonly RoundResult[], xp: boolean): HTMLElement {
  const timed = results.some((result) => result.timeMs !== undefined);
  const rows = results.map((result, index) =>
    el(
      'tr',
      {},
      numCell(String(index + 1)),
      el('td', {}, countryLabel(result.location.country)),
      numCell(distanceText(result)),
      timed ? numCell(result.timeMs === undefined ? '' : clock(Math.round(result.timeMs / 1000))) : null,
      numCell(formatScore(result.score), result.hinted ? el('span', { class: 'tag', text: t('tag.hint') }) : null),
      xp ? numCell(formatScore(roundXp(result.score))) : null,
    ),
  );
  const head = el('tr', {}, numHead('#'), el('th', { text: t('label.country') }), numHead(t('label.distance')), timed ? numHead(t('round.time')) : null, numHead(t('label.points')), xp ? numHead(t('label.xp')) : null);
  return el('table', { class: 'rounds' }, el('thead', {}, head), el('tbody', {}, ...rows));
}

export function summaryPanel(session: Session, handlers: SummaryHandlers): HTMLElement {
  const total = totalScore(session);
  const maxScore = session.rounds.length * MAX_ROUND_SCORE;
  const linkButton = copyButton({ label: t('summary.copyLink'), copied: t('common.linkCopied'), text: () => handlers.challengeUrl, fieldLabel: t('summary.linkLabel') });
  const shareButton = copyButton({
    label: t('summary.shareResult'),
    copied: t('summary.resultCopied'),
    text: () => handlers.daily?.shareText() ?? shareResultText(session, handlers.mapName, handlers.challengeUrl),
    fieldLabel: t('summary.resultLabel'),
  });

  // the score counts up to its total; the label says the total at once, for a screen reader
  const score = el('span', { attrs: { 'aria-label': formatScore(total) } });
  countUp(score, total, formatScore);

  return el(
    'section',
    { class: 'panel summary-panel', attrs: { 'aria-label': t('summary.label') } },
    figure(t('summary.finalScore'), score, ` / ${formatScore(maxScore)}`),
    starRow(starsFor(total, maxScore)),
    // what became of the score, under the score: in sight without scrolling, however many rounds the table has
    saveNoteLine(handlers.saveNote),
    handlers.daily?.extras ?? null,
    roundsTable(session.results, handlers.xp),
    // sharing is something to do with the result, not a way on: it is in the panel's own part, which scrolls, with the line that says what it gives away
    handlers.ways ? null : el('p', { class: 'prose', text: handlers.daily ? t('daily.summary.share') : t('summary.share') }),
    handlers.ways ? null : el('div', { class: 'share-actions' }, shareButton, handlers.daily ? null : linkButton),
    // the foot is the way on and the way out, and no more: two buttons fit one row in any language. The daily is played once, so the way home is what comes next
    handlers.ways ??
      (handlers.daily
        ? panelActions(el('button', { class: 'button accent', text: t('common.home'), attrs: { type: 'button' }, on: { click: handlers.onHome } }))
        : panelActions(
            el('button', { class: 'button accent', text: t('play.again'), attrs: { type: 'button' }, on: { click: handlers.onPlayAgain } }),
            el('button', { class: 'button ghost', text: t('common.home'), attrs: { type: 'button' }, on: { click: handlers.onHome } }),
          )),
  );
}

/**
 * A message over the screen with what can be done about it; the first action is the filled one.
 * `failed` marks it as a failure (a view that would not load, places that could not be found).
 */
export function noticePanel(message: string, actions: Array<{ name: string; run: () => void }>, failed = false): HTMLElement {
  return el(
    'section',
    { class: 'panel notice-panel', attrs: { role: 'alert' } },
    failed ? errorMark() : null,
    el('p', { class: 'prose', text: message }),
    el(
      'div',
      { class: 'actions' },
      ...actions.map((action, index) =>
        el('button', { class: index === 0 ? 'button primary' : 'button ghost', text: action.name, attrs: { type: 'button' }, on: { click: action.run } }),
      ),
    ),
  );
}
