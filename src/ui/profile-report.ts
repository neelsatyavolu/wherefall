import { t } from '../i18n/index.ts';
import { reportPlayer, type ReportCategory } from '../social/client.ts';
import { reportCategoryChoices } from '../social/report-words.ts';
import { choiceRow } from './choice-row.ts';
import { el } from './dom.ts';
import { errorLine } from './pane.ts';
import { sayRefusal } from './session-ended.ts';

/** nothing is chosen until the player chooses: a category picked for them would say nothing about the report */
type Chosen = ReportCategory | '';

/**
 * Reporting a player to the moderators: what it is about (cheating, an offensive name, offensive
 * chat, or something else), a note, which may be left empty, and a button. The server takes no
 * report without a category, so the form asks for one before it sends. Hidden until asked for.
 */
export function reportForm(username: string): HTMLElement {
  let category: Chosen = '';
  const reason = el('input', { class: 'account-input', attrs: { id: 'report-reason', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: t('profile.report.placeholder') } });
  const note = el('p', { class: 'fine', attrs: { role: 'status' } });
  const error = errorLine();
  const send = el('button', { class: 'button ghost', text: t('common.sendReport'), attrs: { type: 'button' } });
  const about = choiceRow<Chosen>(t('report.category.legend'), 'report-category', reportCategoryChoices(), category, (value) => {
    category = value;
    error.textContent = '';
  });
  const form = el(
    'div',
    { class: 'inline-form report-form' },
    about,
    el('label', { class: 'label', text: t('common.reportPlayer', { name: username }), attrs: { for: reason.id } }),
    el('div', { class: 'inline-fields' }, reason, send),
    note,
    error,
  );
  form.hidden = true;
  send.addEventListener('click', async () => {
    if (category === '') {
      error.textContent = t('report.category.missing');
      return;
    }
    send.disabled = true;
    error.textContent = '';
    const result = await reportPlayer(username, category, reason.value.trim());
    if (result.ok) {
      note.textContent = t('profile.report.sent');
    } else {
      send.disabled = false;
      sayRefusal(error, result.error);
    }
  });
  const open = el('button', { class: 'button ghost', text: t('profile.report.open'), attrs: { type: 'button' }, on: { click: () => (form.hidden = !form.hidden) } });
  return el('section', { class: 'account-section' }, el('div', { class: 'actions' }, open), form);
}
