import './solo.css';
import { el } from './dom.ts';

interface SliderOptions {
  /** the field's name in its form */
  name: string;
  /** what a screen reader calls it */
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** the value in words, read out in place of the bare number */
  text: (value: number) => string;
  /** called as the handle moves */
  onInput: (value: number) => void;
  /** called once the handle is let go */
  onChange?: (value: number) => void;
}

/** Says a slider's value in words to a screen reader. Call it after setting the value from code. */
export function describeSlider(input: HTMLInputElement, text: string): void {
  input.setAttribute('aria-valuetext', text);
}

/**
 * A slider for one number: dragged on a phone, moved with the arrow keys (Home and End for the
 * ends) on a keyboard. The browser's own control, drawn flat.
 */
export function slider(options: SliderOptions): HTMLInputElement {
  const input = el('input', {
    class: 'slider',
    attrs: { type: 'range', name: options.name, min: String(options.min), max: String(options.max), step: String(options.step), 'aria-label': options.label },
  });
  input.value = String(options.value);
  describeSlider(input, options.text(options.value));
  input.addEventListener('input', () => {
    describeSlider(input, options.text(Number(input.value)));
    options.onInput(Number(input.value));
  });
  input.addEventListener('change', () => options.onChange?.(Number(input.value)));
  return input;
}
