import './row-confirm.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

export interface RowQuestion {
  /** what is about to happen, asked in full: "Remove sam from your friends?" */
  question: string;
  /** the button that does it, which is the one in the danger colour */
  yes: string;
  /** does it; the buttons the row had come back once this settles, if the row is still there */
  run: () => Promise<void> | void;
}

/**
 * Asks once more before something that is not undone by pressing again, in the row it is about:
 * the row's buttons give way to the question, with the safe answer filled and the other in the
 * danger colour. So a list of rows carries no red at rest, and no filled button that is not the
 * way on. `actions` is the row's `.row-actions`.
 */
export function askInRow(actions: HTMLElement, ask: RowQuestion): void {
  const before = [...actions.childNodes];
  const opener = document.activeElement instanceof HTMLElement && actions.contains(document.activeElement) ? document.activeElement : null;
  const restore = () => {
    actions.classList.remove('asking');
    actions.replaceChildren(...before);
  };
  const keep = el('button', {
    class: 'button primary',
    text: t('common.cancel'),
    attrs: { type: 'button' },
    on: {
      click: () => {
        restore();
        opener?.focus();
      },
    },
  });
  const go = el('button', { class: 'button danger', text: ask.yes, attrs: { type: 'button' } });
  go.addEventListener('click', () => {
    go.disabled = true;
    keep.disabled = true;
    void Promise.resolve(ask.run()).finally(restore);
  });
  actions.classList.add('asking');
  actions.replaceChildren(el('p', { class: 'row-confirm', text: ask.question, attrs: { role: 'alert' } }), keep, go);
  keep.focus();
}
