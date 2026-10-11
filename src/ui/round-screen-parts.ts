import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { buildMapTools, icon } from './map-tools.ts';
import type { ScreenConfig } from './round-types.ts';

/** The round screen's elements. Kept apart from its behaviour so each stays readable. */

/** an arrow turning back on itself: back to where the round began */
const RETURN_ICON = ['M9 14 4 9l5-5', 'M4 9h10a5 5 0 0 1 0 10h-3'];

function hudCell(label: string, value: HTMLElement): HTMLElement {
  return el('div', { class: 'hud-cell' }, el('span', { class: 'label', text: label }), value);
}

export function buildParts(config: ScreenConfig) {
  const panoHost = el('div', { class: config.mode === 'nmpz' ? 'pano locked' : 'pano' });
  const mapHost = el('div', { class: 'map' });
  const countValue = el('span', { class: 'value' });
  const scoreValue = el('span', { class: 'value', text: '0' });
  const timeValue = el('span', { class: 'value' });
  const timeCell = hudCell(t('round.time'), timeValue);
  // the clock is in the HUD only while it has a time to show: a game with no timer has no empty cell
  timeCell.hidden = true;
  const status = el('p', { class: 'status', attrs: { role: 'status' } });
  const panelHost = el('div', { class: 'panel-host' });
  const compassLetter = el('span', { text: t('round.north') });
  const compassNeedle = el('div', { class: 'compass-needle' }, compassLetter);
  const guessButton = el('button', { class: 'button accent guess', text: t('round.placePin'), attrs: { type: 'button' } });
  guessButton.disabled = true;
  const mapTools = buildMapTools();
  // the bar under the map: Guess, kept clear of the map itself, and on a phone the way to close the map beside it
  const mapClose = el('button', { class: 'button ghost map-close', text: t('round.closeMap'), attrs: { type: 'button' } });
  const guessBar = el('div', { class: 'guess-bar' }, mapClose, guessButton);
  const mapPanel = el('div', { class: 'map-panel' }, mapHost, mapTools.tools, mapTools.credit, guessBar);
  const mapToggle = el('button', { class: 'button primary map-toggle', text: t('round.openMap'), attrs: { type: 'button' } });
  // in words on a wide screen, as its drawing alone on a phone, where the words would reach the walk arrow
  const returnWords = t('round.returnToStart');
  const returnButton = el('button', { class: 'button ghost return', attrs: { type: 'button', title: returnWords } }, el('span', { class: 'tool-text', text: returnWords }));
  returnButton.prepend(icon(RETURN_ICON));
  returnButton.hidden = config.mode !== 'move';
  returnButton.disabled = true;
  const hintButton = el('button', { class: 'button ghost hint', attrs: { type: 'button', title: t('round.hintTitle') } });
  hintButton.hidden = !config.hint;
  const exitButton = el('button', { class: 'hud-exit', text: t('round.exit'), attrs: { type: 'button' } });
  const credit = el('span', { class: 'credit' });
  const mapValue = el('span', { class: 'value', text: config.mapName });
  const mapCell = hudCell(t('label.map'), mapValue);
  mapCell.classList.add('hud-map');
  const scoreCell = hudCell(t('label.score'), scoreValue);
  scoreCell.classList.add('hud-score');
  scoreCell.hidden = config.score === false;
  const hud = el('header', { class: 'hud' }, mapCell, hudCell(config.counter.label, countValue), scoreCell, timeCell, exitButton);
  // the compass shows which way the view faces, and a click on it faces north; with the view locked it only shows
  const compass = el('button', { class: 'compass', attrs: { type: 'button', 'aria-label': t('round.faceNorth'), title: t('round.faceNorth') } }, compassNeedle);
  compass.disabled = config.mode === 'nmpz';
  const panoTools = el('div', { class: 'pano-tools' }, compass, returnButton, hintButton, credit);
  const view = el('section', { class: 'play', attrs: { 'data-phase': 'loading' } }, panoHost, hud, panoTools, mapPanel, mapToggle, panelHost, status);
  return {
    view,
    hud,
    mapValue,
    panoHost,
    mapHost,
    countValue,
    scoreValue,
    scoreCell,
    timeValue,
    timeCell,
    status,
    panelHost,
    compass,
    compassLetter,
    compassNeedle,
    guessButton,
    mapPanel,
    mapToggle,
    mapClose,
    returnButton,
    hintButton,
    exitButton,
    credit,
    mapTools,
  };
}

/**
 * A yes-or-no question in a modal dialog. Resolves true only for the yes button; Escape answers no.
 * Yes is what cannot be taken back (leaving a game, ending a run, sending a report), so it is the
 * quiet one, in the colour of danger; no, which keeps things as they are, is the filled one.
 */
export function confirmDialog(host: HTMLElement, message: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    const yesButton = el('button', { class: 'button ghost danger', text: yes, attrs: { type: 'button' } });
    const noButton = el('button', { class: 'button primary', text: no, attrs: { type: 'button' } });
    const dialog = el('dialog', { class: 'confirm' }, el('p', { class: 'prose', text: message }), el('div', { class: 'actions' }, noButton, yesButton));
    let answer = false;
    yesButton.addEventListener('click', () => {
      answer = true;
      dialog.close();
    });
    noButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    host.append(dialog);
    dialog.showModal();
    noButton.focus();
  });
}
