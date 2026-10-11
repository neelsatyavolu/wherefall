import type { LocationSet, MapId } from '../game/locations.ts';
import {
  DEFAULT_OPTIONS,
  MODES,
  ROUND_COUNTS,
  modeName,
  type Challenge,
  type GameOptions,
  type Mode,
  type RoundCount,
} from '../game/settings.ts';
import { t } from '../i18n/index.ts';
import { actionBar } from './action-bar.ts';
import { choiceRow, describeSettings } from './choice-row.ts';
import { el, withNodes } from './dom.ts';
import { mapPicker } from './map-picker.ts';
import { roundsProblem, type MapPreset } from './map-preset.ts';
import { errorLine, pane, type Pane } from './pane.ts';
import { prefs } from './prefs.ts';
import { timeControl } from './time-control.ts';

interface SingleplayerHandlers {
  onStart: (options: GameOptions) => void;
  onAcceptChallenge: (challenge: Challenge) => void;
  /** the list of places in use, for the regions and countries that can be played */
  loadPlaces: () => Promise<LocationSet>;
  onTutorial: () => void;
}

const INTRO = ['intro.step.1', 'intro.step.2', 'intro.step.3'] as const;

/** Three lines for a first visit. Dismissing it is remembered in this browser. */
function intro(onTutorial: () => void): HTMLElement | null {
  if (prefs.introSeen()) {
    return null;
  }
  const section = el(
    'section',
    { class: 'intro', attrs: { 'aria-label': t('intro.title') } },
    el('p', { class: 'label', text: t('intro.title') }),
    el('ol', { class: 'intro-steps' }, ...INTRO.map((step) => el('li', { text: t(step) }))),
    // both quiet: the pane's one filled button is the one that starts a game
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'button ghost', text: t('common.playTutorial'), attrs: { type: 'button' }, on: { click: onTutorial } }),
      el('button', {
        class: 'button ghost',
        text: t('intro.dismiss'),
        attrs: { type: 'button' },
        on: {
          click: () => {
            prefs.dismissIntro();
            section.remove();
          },
        },
      }),
    ),
  );
  return section;
}

function challengeCard(challenge: Challenge, onAccept: (challenge: Challenge) => void): HTMLElement {
  return el(
    'section',
    { class: 'challenge', attrs: { 'aria-label': t('singleplayer.challenge') } },
    el('p', { class: 'label', text: t('singleplayer.challengeSent') }),
    el('p', { class: 'challenge-detail', text: describeSettings(challenge) }),
    el('button', { class: 'button accent', text: t('singleplayer.playChallenge'), attrs: { type: 'button' }, on: { click: () => onAccept(challenge) } }),
  );
}

/** Road names on the guess map, hidden unless switched on. Kept in this browser, not in a challenge link: it is about this player's map. */
function roadNamesRow(): HTMLElement {
  return choiceRow<boolean>(
    t('singleplayer.roadNames'),
    'road-names',
    [
      { value: false, name: t('singleplayer.roadNames.off') },
      { value: true, name: t('singleplayer.roadNames.on') },
    ],
    prefs.roadNames(),
    (on) => prefs.setRoadNames(on),
  );
}

function setupForm(accent: boolean, preset: MapPreset | null, handlers: SingleplayerHandlers): HTMLElement {
  let options: GameOptions = { ...DEFAULT_OPTIONS };
  const error = errorLine();
  const update = (change: Partial<GameOptions>) => {
    options = { ...options, ...change };
    error.textContent = '';
  };
  return el(
    'form',
    {
      class: 'setup',
      on: {
        submit: (event) => {
          event.preventDefault();
          const problem = roundsProblem(preset, options.map, options.rounds);
          if (problem) {
            error.textContent = problem;
            return;
          }
          handlers.onStart(options);
        },
      },
    },
    // the same order wherever a game is set up: where, how, how long
    mapPicker('map', handlers.loadPlaces, (map: MapId) => update({ map }), preset),
    choiceRow<Mode>(t('label.mode'), 'mode', MODES.map((mode) => ({ value: mode, name: modeName(mode) })), options.mode, (mode) => update({ mode })),
    choiceRow<RoundCount>(
      t('label.rounds'),
      'rounds',
      ROUND_COUNTS.map((n) => ({ value: n, name: String(n) })),
      options.rounds,
      (rounds) => update({ rounds }),
    ),
    timeControl(t('label.timePerRound'), 'time', options.timeLimit, (timeLimit) => update({ timeLimit })),
    roadNamesRow(),
    actionBar(error, el('button', { class: accent ? 'button accent' : 'button primary', text: t('singleplayer.start'), attrs: { type: 'submit' } })),
  );
}

/** The options for a game alone, the challenge card when the address carries one, and the first-visit introduction. */
export function singleplayerPane(challenge: Challenge | null, preset: MapPreset | null, handlers: SingleplayerHandlers): Pane {
  return {
    node: pane(
      t('nav.item.singleplayer'),
      t('singleplayer.lede'),
      intro(handlers.onTutorial),
      challenge && challengeCard(challenge, handlers.onAcceptChallenge),
      // one accent button a view: the challenge takes it when there is one
      setupForm(!challenge, preset, handlers),
      el(
        'p',
        { class: 'fine' },
        ...withNodes(t('singleplayer.credits'), {
          panoramax: el('a', { text: 'Panoramax', attrs: { href: 'https://panoramax.fr', target: '_blank', rel: 'noopener' } }),
          openfreemap: el('a', { text: 'OpenFreeMap', attrs: { href: 'https://openfreemap.org', target: '_blank', rel: 'noopener' } }),
        }),
      ),
    ),
  };
}
