import './solo.css';
import { MAX_TIME_LIMIT, TIME_STEP, nearestTimeLimit, type TimeLimit } from '../game/settings.ts';
import { t } from '../i18n/index.ts';
import { timeName } from './choice-row.ts';
import { el } from './dom.ts';
import { describeSlider, slider } from './slider.ts';

/**
 * The time for a round: no limit, or 10 to 300 seconds in steps of 10. One slider, with a button
 * either side for a single step: a drag or a tap on a phone, the arrow keys on a keyboard. The far
 * left is no limit. `onChange` is called with every new value.
 */
export function timeControl(legend: string, name: string, initial: TimeLimit, onChange: (limit: TimeLimit) => void): HTMLElement {
  let value = nearestTimeLimit(initial);
  const readout = el('output', { class: 'time-value', text: timeName(value) });
  const stepButton = (text: string, label: string, by: number) =>
    el('button', { class: 'time-step', text, attrs: { type: 'button', 'aria-label': label }, on: { click: () => set(value + by, true) } });
  const less = stepButton('−', t('time.less'), -TIME_STEP);
  const more = stepButton('+', t('time.more'), TIME_STEP);
  const input = slider({ name, label: legend, min: 0, max: MAX_TIME_LIMIT, step: TIME_STEP, value, text: timeName, onInput: (seconds) => set(seconds, false) });

  /** `moveHandle` is for a change that did not come from the slider itself. */
  function set(seconds: number, moveHandle: boolean): void {
    value = nearestTimeLimit(seconds);
    if (moveHandle) {
      input.value = String(value);
      describeSlider(input, timeName(value));
    }
    readout.textContent = timeName(value);
    less.disabled = value === 0;
    more.disabled = value === MAX_TIME_LIMIT;
    onChange(value);
  }

  less.disabled = value === 0;
  more.disabled = value === MAX_TIME_LIMIT;
  return el(
    'fieldset',
    { class: 'choice-row time-control' },
    el('legend', { class: 'label', text: legend }),
    readout,
    el('div', { class: 'time-row' }, less, input, more),
  );
}
