import './party.css';
import { mapName, type LocationSet, type MapId } from '../game/locations.ts';
import { MODES, modeName, type Mode } from '../game/settings.ts';
import { t, tn } from '../i18n/index.ts';
import { COMMUNICATIONS, PARTY_LIMITS, TEAM_MODES, type Communication, type MatchSettings, type TeamMode } from '../multiplayer/client.ts';
import { clampRounds, partySettings } from '../multiplayer/party-view.ts';
import { choiceRow, timeName } from './choice-row.ts';
import { el } from './dom.ts';
import { mapPicker } from './map-picker.ts';
import { roundsProblem, type MapPreset } from './map-preset.ts';
import { actionBar } from './action-bar.ts';
import { errorLine } from './pane.ts';
import { describeSlider, slider } from './slider.ts';
import { timeControl } from './time-control.ts';

/** A party's settings as a form: what the host chooses when making the party, and can change in its lobby. */

export interface PartyFormOptions {
  /** the start of every field's name, so two forms never share one */
  name: string;
  /** what the form opens on */
  initial: MatchSettings;
  /** what the button that sends it says: it makes a party, or saves a change */
  submit: string;
  loadPlaces: () => Promise<LocationSet>;
  /** a map chosen somewhere else, which the map choice opens on */
  preset: MapPreset | null;
  /** takes the settings to the server; resolves to an error to show, or null when they were taken */
  onSubmit: (settings: MatchSettings) => Promise<string | null>;
  /** a way out without sending anything, where the form is not the whole pane */
  onCancel?: () => void;
}

const roundsName = (rounds: number) => tn('settings.rounds', rounds);

/**
 * How many rounds: 1 to 20, on a slider with a button either side for a single step, as the time
 * for a round is chosen. `onChange` is called with every new value.
 */
function roundsControl(legend: string, name: string, initial: number, onChange: (rounds: number) => void): HTMLElement {
  const { minRounds, maxRounds } = PARTY_LIMITS;
  let value = clampRounds(initial);
  const readout = el('output', { class: 'time-value', text: roundsName(value) });
  const stepButton = (text: string, label: string, by: number) =>
    el('button', { class: 'time-step', text, attrs: { type: 'button', 'aria-label': label }, on: { click: () => set(value + by, true) } });
  const less = stepButton('−', t('party.rounds.less'), -1);
  const more = stepButton('+', t('party.rounds.more'), 1);
  const input = slider({ name, label: legend, min: minRounds, max: maxRounds, step: 1, value, text: roundsName, onInput: (rounds) => set(rounds, false) });

  const sync = () => {
    readout.textContent = roundsName(value);
    less.disabled = value === minRounds;
    more.disabled = value === maxRounds;
  };

  /** `moveHandle` is for a change that did not come from the slider itself. */
  function set(rounds: number, moveHandle: boolean): void {
    value = clampRounds(rounds);
    if (moveHandle) {
      input.value = String(value);
      describeSlider(input, roundsName(value));
    }
    sync();
    onChange(value);
  }

  sync();
  return el('fieldset', { class: 'choice-row time-control' }, el('legend', { class: 'label', text: legend }), readout, el('div', { class: 'time-row' }, less, input, more));
}

/** A party's settings in words, piece by piece: the map, the rounds, the time, the mode, what players may say, and the teams when there are any. */
export function settingsParts(settings: MatchSettings): string[] {
  return [
    mapName(settings.map),
    tn('settings.rounds', settings.rounds),
    timeName(settings.timeLimit),
    t(`settings.mode.${settings.mode}`),
    t(`party.line.${settings.communication}`),
    ...(settings.teams === 'none' ? [] : [t(`party.line.${settings.teams}`)]),
  ];
}

/** The map the form opens on, for a party that already has one: the picker shows it as chosen. */
export const presetFor = (map: MapId): MapPreset | null => (map === 'world' ? null : { map, name: mapName(map), places: null });

export function partyForm(options: PartyFormOptions): HTMLElement {
  const { name, preset } = options;
  let settings = partySettings(options.initial);
  const update = (change: Partial<MatchSettings>) => {
    settings = partySettings({ ...settings, ...change });
  };
  const error = errorLine();
  const submit = el('button', { class: 'button accent', text: options.submit, attrs: { type: 'submit' } });
  const cancel = options.onCancel ? el('button', { class: 'button ghost', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: options.onCancel } }) : null;

  const send = async () => {
    const problem = roundsProblem(preset, settings.map, settings.rounds);
    if (problem) {
      error.textContent = problem;
      return;
    }
    submit.disabled = true;
    error.textContent = '';
    const refused = await options.onSubmit(settings);
    if (refused !== null) {
      submit.disabled = false;
      error.textContent = refused;
    }
  };

  return el(
    'form',
    {
      class: 'setup party-form',
      attrs: { 'aria-label': t('party.settings.form') },
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    mapPicker(`${name}-map`, options.loadPlaces, (map: MapId) => update({ map }), preset),
    choiceRow<Mode>(t('label.mode'), `${name}-mode`, MODES.map((mode) => ({ value: mode, name: modeName(mode) })), settings.mode, (mode) => update({ mode })),
    roundsControl(t('label.rounds'), `${name}-rounds`, settings.rounds, (rounds) => update({ rounds })),
    el('div', { class: 'party-field' }, timeControl(t('label.timePerRound'), `${name}-time`, settings.timeLimit, (timeLimit) => update({ timeLimit })), el('p', { class: 'fine', text: t('party.time.note') })),
    choiceRow<Communication>(
      t('party.communication'),
      `${name}-communication`,
      COMMUNICATIONS.map((value) => ({ value, name: t(`party.communication.${value}`) })),
      settings.communication,
      (communication) => update({ communication }),
    ),
    el(
      'div',
      { class: 'party-field' },
      choiceRow<TeamMode>(t('party.teams'), `${name}-teams`, TEAM_MODES.map((value) => ({ value, name: t(`party.teams.${value}`) })), settings.teams, (teams) => update({ teams })),
      el('p', { class: 'fine', text: t('party.teams.note') }),
    ),
    // creating a party is the pane's one forward action, kept in reach on a phone; the host's form in a lobby is a row where it stands
    ...(cancel ? [el('div', { class: 'actions' }, submit, cancel), error] : [actionBar(error, submit)]),
  );
}
