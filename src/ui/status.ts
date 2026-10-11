import './status.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

/**
 * A line of status: a dot, a word in mono, and the sentence. Green for something that went well,
 * red for something that failed, plain for something only worth knowing. Used for what became of a
 * score at the end of a game, and above the message of a notice that reports a failure.
 */

export type NoteState = 'ok' | 'error' | 'note';

/** What became of a score once the game was over: the sentence, and whether it is good news, a failure or neither. */
export interface Note {
  text: string;
  state: NoteState;
}

/** A driver may still hand over the sentence alone, which is then shown as plain news. */
export type SaveNote = string | Note;

const WORDS = { ok: 'status.saved', error: 'status.notSaved', note: 'status.note' } as const;

export const savedNote = (text: string): Note => ({ text, state: 'ok' });
export const failedNote = (text: string): Note => ({ text, state: 'error' });

function line(sentence: HTMLElement | null): { node: HTMLElement; word: HTMLElement } {
  const word = el('span', { class: 'status-word' });
  const node = el('p', { class: 'status-note' }, el('span', { class: 'status-dot', attrs: { 'aria-hidden': 'true' } }), el('span', { class: 'status-body' }, word, sentence));
  return { node, word };
}

/** The mark of a failure, to go above the message that says what failed. */
export function errorMark(): HTMLElement {
  const { node, word } = line(null);
  node.dataset.state = 'error';
  word.textContent = t('status.error');
  return node;
}

/**
 * The line under a summary that says what became of the score. Nothing is there until that is
 * known, and nothing at all when there is nothing to say (an empty sentence).
 */
export function saveNoteLine(note: Promise<SaveNote>): HTMLElement {
  const sentence = el('span', { class: 'save-note', attrs: { role: 'status' } });
  const { node, word } = line(sentence);
  node.hidden = true;
  void note.then((result) => {
    const { text, state } = typeof result === 'string' ? { text: result, state: 'note' as const } : result;
    if (text) {
      node.dataset.state = state;
      word.textContent = t(WORDS[state]);
      sentence.textContent = text;
      node.hidden = false;
    }
  });
  return node;
}
