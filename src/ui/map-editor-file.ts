import './maps.css';
import { formatNumber, t } from '../i18n/index.ts';
import { FILE_LIMITS, kindOf, parsePlacesFile, sizeProblem, type FileRead } from '../social/map-file.ts';
import { el } from './dom.ts';
import { placesRun, type RunHooks } from './map-editor-run.ts';
import { errorLine } from './pane.ts';

const BYTES_IN_MB = 1024 * 1024;
const megabytes = () => formatNumber(FILE_LIMITS.maxBytes / BYTES_IN_MB);
const mostPlaces = () => formatNumber(FILE_LIMITS.maxPlaces);

/** Why a file was not read, said plainly: what is wrong with it and, where there is one, what to do about it. */
function refusal(read: Extract<FileRead, { ok: false }>): string {
  switch (read.problem) {
    case 'tooBig':
      return t('editor.file.tooBig', { mb: megabytes() });
    case 'tooMany':
      return t('editor.file.tooMany', { count: formatNumber(read.count), max: mostPlaces() });
    default:
      return t(`editor.file.${read.problem}`);
  }
}

/** Reads the file the player chose, in the browser: nothing of it is sent anywhere. */
async function readFile(file: File): Promise<FileRead | 'unreadable'> {
  const kind = kindOf(file.name, file.type);
  if (kind === null) {
    return { ok: false, problem: 'type' };
  }
  const size = sizeProblem(file.size);
  if (size !== null) {
    return { ok: false, problem: size };
  }
  try {
    return parsePlacesFile(kind, await file.text());
  } catch {
    return 'unreadable';
  }
}

/**
 * Adding places from a file: a `.json` or `.csv` of coordinates (the shapes are set out in
 * `social/map-file.ts` and said under the button). The file is read here in the browser, by the
 * parser that sits beside the paste box's, and its places then go the way pasted ones do: looked
 * up a handful at a time, with the same progress, the same Stop and the same summary.
 */
export function fileForm(hooks: RunHooks) {
  const hint = el('p', { class: 'fine', text: t('editor.file.hint', { mb: megabytes(), max: mostPlaces() }), attrs: { id: 'map-file-hint' } });
  // the browser's own file button cannot be styled or translated, so it stays out of sight behind one of ours
  const input = el('input', { attrs: { id: 'map-file', type: 'file', accept: '.json,.geojson,.csv,application/json,text/csv', tabindex: '-1', 'aria-label': t('editor.file.choose') } });
  input.hidden = true;
  const choose = el('button', { class: 'button ghost', text: t('editor.file.choose'), attrs: { type: 'button', 'aria-describedby': hint.id } });
  const error = errorLine();
  let locked = false;
  let reading = false;

  const draw = () => {
    choose.hidden = run.isRunning();
    choose.disabled = locked || reading;
  };
  const run = placesRun(hooks, t('editor.file.summary'), draw);

  async function take(file: File): Promise<void> {
    error.textContent = '';
    run.clear();
    reading = true;
    draw();
    const read = await readFile(file);
    reading = false;
    draw();
    if (read === 'unreadable') {
      error.textContent = t('editor.file.unreadable');
    } else if (!read.ok) {
      error.textContent = refusal(read);
    } else if (!locked) {
      await run.start(read.pasted, 'editor.file.unread');
    }
  }

  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    // emptied, so that choosing the same file again, once it is mended, is a change too
    input.value = '';
    if (file && !locked && !run.isRunning()) {
      void take(file);
    }
  });
  draw();

  return {
    node: el(
      'section',
      { class: 'account-section', attrs: { 'aria-label': t('editor.file') } },
      el('h3', { class: 'label', text: t('editor.file') }),
      el('div', { class: 'paste-form' }, hint, el('div', { class: 'actions' }, choose, run.stop), input, run.running, error),
      run.summary,
    ),
    /** While the editor is finding the place for a click, or adding pasted places, a file waits its turn. */
    setLocked(value: boolean): void {
      locked = value;
      draw();
    },
    stop: run.halt,
  };
}
