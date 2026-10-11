import './maps.css';
import { t } from '../i18n/index.ts';
import { parsePaste } from '../social/map-paste.ts';
import { el } from './dom.ts';
import { placesRun, type RunHooks } from './map-editor-run.ts';
import { errorLine } from './pane.ts';

/**
 * Adding places by pasting them: Street View links or coordinates, one to a line. Each is matched
 * to the nearest panorama as a click on the map is. A long list shows how far it has got and can
 * be stopped; at the end it says what was added and what could not be, and why.
 */
export function pasteForm(hooks: RunHooks) {
  const hint = el('p', { class: 'fine', text: t('editor.pasteHint'), attrs: { id: 'map-paste-hint' } });
  const text = el('textarea', { class: 'account-input', attrs: { id: 'map-paste', rows: '4', spellcheck: 'false', autocomplete: 'off', 'aria-describedby': hint.id } });
  const add = el('button', { class: 'button ghost', text: t('editor.pasteAdd'), attrs: { type: 'button' } });
  const error = errorLine();
  let locked = false;

  const draw = () => {
    add.hidden = run.isRunning();
    add.disabled = locked;
    text.readOnly = run.isRunning();
  };
  const run = placesRun(hooks, t('editor.pasteSummary'), draw);

  async function start(): Promise<void> {
    const pasted = parsePaste(text.value);
    const nothing = pasted.places.length + pasted.unread === 0;
    error.textContent = nothing ? t('editor.pasteEmpty') : '';
    run.clear();
    if (nothing) {
      return;
    }
    const tally = await run.start(pasted, 'editor.pasted.unread');
    if (tally.failed + tally.left === 0) {
      // nothing is left to try again, so the box is ready for the next list
      text.value = '';
    }
  }

  add.addEventListener('click', () => void start());
  draw();
  return {
    node: el(
      'section',
      { class: 'account-section', attrs: { 'aria-label': t('editor.paste') } },
      el('h3', { class: 'label', text: t('editor.paste') }),
      el('div', { class: 'paste-form' }, el('label', { class: 'label', text: t('editor.pasteLabel'), attrs: { for: text.id } }), text, hint, el('div', { class: 'actions' }, add, run.stop), run.running, error),
      run.summary,
    ),
    /** While the editor is finding the place for a click, or adding the places of a file, a paste waits its turn. */
    setLocked(value: boolean): void {
      locked = value;
      draw();
    },
    stop: run.halt,
  };
}
