import { t } from '../i18n/index.ts';
import type { ReportCategory } from '../social/client.ts';
import { reportCategoryChoices } from '../social/report-words.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';

/** nothing is chosen until the player chooses: a category picked for them would say nothing about the report */
type Chosen = ReportCategory | '';

/**
 * The question asked before a player is reported from a final standing: whether to, and what the
 * report is about (cheating, an offensive name, offensive chat, or something else), which the
 * server needs with every report. It is the round screen's own yes-or-no dialog with the choice in
 * it: the report is the quiet answer in the colour of danger, Cancel the filled one, and Escape
 * cancels. Resolves to the category chosen, or null when the player thought better of it.
 */
export function askReport(host: HTMLElement, username: string): Promise<ReportCategory | null> {
  return new Promise((resolve) => {
    let category: Chosen = '';
    let answer: ReportCategory | null = null;
    const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
    const about = choiceRow<Chosen>(t('report.category.legend'), 'match-report-category', reportCategoryChoices(), category, (value) => {
      category = value;
      error.textContent = '';
    });
    const yes = el('button', { class: 'button ghost danger', text: t('common.report'), attrs: { type: 'button' } });
    const no = el('button', { class: 'button primary', text: t('common.cancel'), attrs: { type: 'button' } });
    const dialog = el(
      'dialog',
      { class: 'confirm report-confirm' },
      el('p', { class: 'prose', text: t('match.reportConfirm', { name: username }) }),
      about,
      error,
      el('div', { class: 'actions' }, no, yes),
    );
    yes.addEventListener('click', () => {
      if (category === '') {
        error.textContent = t('report.category.missing');
        return;
      }
      answer = category;
      dialog.close();
    });
    no.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    host.append(dialog);
    dialog.showModal();
    no.focus();
  });
}
