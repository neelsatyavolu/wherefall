import './guesser.css';
import type { Continent } from '../game/continents.ts';
import { GUESSER_MAX_SCORE, scoreOf, type GuesserAnswer, type GuesserKind, type GuesserRun } from '../game/guesser.ts';
import { countryName } from '../game/locations.ts';
import { t } from '../i18n/index.ts';
import { el, formatScore } from './dom.ts';
import { flag } from './flag.ts';
import { figure, panelActions } from './panels.ts';
import { saveNoteLine, type SaveNote } from './status.ts';

/** What a button or an answer is called: a country's name, or a continent's. */
export const optionName = (kind: GuesserKind, option: string): string => (kind === 'country' ? countryName(option) : t(`continent.${option as Continent}`));

/** A country's flag ahead of its name. A continent has none. The name beside it says what it is, so the flag itself is not read out. */
function optionFlag(kind: GuesserKind, option: string): HTMLElement | null {
  const node = kind === 'country' ? flag(option) : null;
  node?.setAttribute('aria-hidden', 'true');
  return node;
}

export interface AnswerPanel {
  node: HTMLElement;
  /** The view has loaded: the buttons take presses from now on. */
  enable: () => void;
  /** Shows how the round went: the right button marked, a wrong pick marked, and the way on. */
  reveal: (answer: GuesserAnswer, isLast: boolean) => void;
  /** puts the keyboard on the way on */
  focusNext: () => void;
}

/**
 * The six buttons of a round, under the question. They are on screen from the start of the round,
 * so the screen keeps its shape while the view loads, and take presses once it has (`enable`).
 * One press is the round's answer: every button then stops taking presses, and `reveal` marks the
 * result.
 */
export function answerPanel(kind: GuesserKind, options: readonly string[], onPick: (option: string) => void, onNext: () => void): AnswerPanel {
  const buttons = new Map(
    options.map((option) => {
      const button = el(
        'button',
        { class: 'guesser-option', attrs: { type: 'button', 'data-option': option }, on: { click: () => onPick(option) } },
        optionFlag(kind, option),
        el('span', { class: 'guesser-name', text: optionName(kind, option) }),
      );
      button.disabled = true;
      return [option, button] as const;
    }),
  );
  const setDisabled = (disabled: boolean) =>
    buttons.forEach((button) => {
      button.disabled = disabled;
    });
  const verdict = el('p', { class: 'guesser-verdict', attrs: { role: 'status' } });
  const next = el('button', { class: 'button accent', attrs: { type: 'button', 'data-action': 'next' }, on: { click: onNext } });
  // a key held down from the answer must not carry on into the next round
  next.addEventListener('keydown', (event) => {
    if (event.repeat) {
      event.preventDefault();
    }
  });
  // the way on comes first, as on every panel; how the round went is beside it
  const foot = el('div', { class: 'guesser-foot' }, next, verdict);
  foot.hidden = true;
  const question = t(`guesser.${kind}.ask`);
  const node = el(
    'section',
    { class: 'panel guesser-panel', attrs: { 'aria-label': question } },
    el('p', { class: 'label', text: question }),
    el('div', { class: 'guesser-options' }, ...buttons.values()),
    foot,
  );

  const mark = (option: string, state: 'right' | 'wrong', word: string) => {
    const button = buttons.get(option);
    button?.setAttribute('data-state', state);
    button?.append(el('span', { class: 'tag', text: word }));
  };

  return {
    node,
    enable: () => setDisabled(false),
    reveal: (answer, isLast) => {
      setDisabled(true);
      mark(answer.answer, 'right', t('streakPlay.correct'));
      if (!answer.correct) {
        mark(answer.picked, 'wrong', t('guesser.wrong'));
      }
      const name = optionName(kind, answer.answer);
      verdict.textContent = answer.correct ? t('streakPlay.correctCountry', { country: name }) : t('guesser.itWas', { answer: name });
      verdict.dataset.state = answer.correct ? 'ok' : 'error';
      next.textContent = isLast ? t('result.seeSummary') : t('result.next');
      foot.hidden = false;
    },
    focusNext: () => next.focus(),
  };
}

interface SummaryHandlers {
  onPlayAgain: () => void;
  onHome: () => void;
}

function roundRow(kind: GuesserKind, answer: GuesserAnswer, index: number): HTMLElement {
  return el(
    'tr',
    { attrs: { 'data-correct': String(answer.correct) } },
    el('td', { class: 'num', text: String(index + 1) }),
    el('td', {}, optionFlag(kind, answer.answer), optionName(kind, answer.answer)),
    el('td', { class: answer.correct ? 'guesser-right' : 'guesser-missed', text: answer.correct ? t('streakPlay.correct') : optionName(kind, answer.picked) }),
  );
}

/** The end of a run: the score out of 10,000, each round's answer beside the player's, and what became of the score. */
export function guesserSummary(run: GuesserRun, saveNote: Promise<SaveNote>, handlers: SummaryHandlers): HTMLElement {
  return el(
    'section',
    { class: 'panel summary-panel guesser-summary', attrs: { 'aria-label': t('summary.label') } },
    figure(t('summary.finalScore'), formatScore(scoreOf(run)), ` / ${formatScore(GUESSER_MAX_SCORE)}`),
    // what became of the score, under the score: in sight without scrolling past ten rounds
    saveNoteLine(saveNote),
    el(
      'table',
      { class: 'rounds' },
      el('thead', {}, el('tr', {}, el('th', { class: 'num', text: '#' }), el('th', { text: t('guesser.answer') }), el('th', { text: t('guesser.yours') }))),
      el('tbody', {}, ...run.answers.map((answer, index) => roundRow(run.kind, answer, index))),
    ),
    panelActions(
      el('button', { class: 'button accent', text: t('play.again'), attrs: { type: 'button' }, on: { click: handlers.onPlayAgain } }),
      el('button', { class: 'button ghost', text: t('common.home'), attrs: { type: 'button' }, on: { click: handlers.onHome } }),
    ),
  );
}
