import { t } from '../i18n/index.ts';
import { getMyReports, type MyReport } from '../social/client.ts';
import { reportCategoryName, reportStatusName, reportStatusTone } from '../social/report-words.ts';
import { el } from './dom.ts';
import { errorLine, statusLine } from './pane.ts';
import { profileLink } from './profile-link.ts';
import { sayRefusal } from './session-ended.ts';
import { longDay } from './stat-grid.ts';

/** One report: who it is of, what it is about, the day it was made, where it stands, and the note that went with it. */
function reportRow(report: MyReport): HTMLElement {
  return el(
    'li',
    { class: 'player-row report-row' },
    el('span', { class: 'player-name' }, profileLink(report.username)),
    el('span', { class: 'tag', text: reportCategoryName(report.category) }),
    el('time', { class: 'report-day', text: longDay(report.at), attrs: { datetime: report.at } }),
    // the status is a dot and a word, as every status is: the word says it, the dot only marks it
    el('span', { class: 'report-status', text: reportStatusName(report.status), attrs: { 'data-tone': reportStatusTone(report.status) } }),
    report.note.trim() === '' ? null : el('p', { class: 'report-note', text: report.note }),
  );
}

/**
 * "My reports": the players this account has reported, each with its date and where it stands
 * (open, action taken, dismissed). The list waits behind a button, as the other long parts of the
 * pane do, and is asked for when it is opened: opening it again asks again, so a status a
 * moderator has changed since is the one shown.
 */
export function myReportsSection(): HTMLElement {
  const host = el('div', { class: 'my-reports' });
  const error = errorLine();
  const toggle = el('button', { class: 'button ghost', text: t('reports.mine.show'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  let opened = false;
  /** goes up with every opening and closing, so an answer that comes late is not drawn */
  let asked = 0;

  async function load(): Promise<void> {
    const mine = ++asked;
    error.textContent = '';
    host.replaceChildren(statusLine(t('reports.mine.loading')));
    const result = await getMyReports();
    if (mine !== asked) {
      return;
    }
    if (!result.ok) {
      host.replaceChildren();
      sayRefusal(error, result.error);
      return;
    }
    const { reports } = result.data;
    host.replaceChildren(reports.length > 0 ? el('ul', { class: 'player-list' }, ...reports.map(reportRow)) : el('p', { class: 'prose', text: t('reports.mine.empty') }));
  }

  toggle.addEventListener('click', () => {
    opened = !opened;
    toggle.textContent = t(opened ? 'reports.mine.hide' : 'reports.mine.show');
    toggle.setAttribute('aria-expanded', String(opened));
    if (opened) {
      void load();
    } else {
      asked += 1;
      error.textContent = '';
      host.replaceChildren();
    }
  });

  return el(
    'section',
    { class: 'account-section settings', attrs: { 'aria-label': t('reports.mine') } },
    el('h3', { class: 'label', text: t('reports.mine') }),
    el('p', { class: 'fine', text: t('reports.mine.note') }),
    el('div', { class: 'actions' }, toggle),
    host,
    error,
  );
}
