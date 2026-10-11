import './account.css';
import { t } from '../i18n/index.ts';
import { copyButton } from './copy-button.ts';
import { el } from './dom.ts';
import { statusBox } from './status-box.ts';

/**
 * A recovery code, shown the one time it exists outside the player's own keeping: the code, a
 * button that copies it, and the warning that it is the only way back in. The server keeps a hash
 * and never sends it again, so nothing follows until the player says they have it: `onDone` is
 * called then, and the box is the caller's to take away. `lead` says how the code came about.
 */
export function recoveryCodeBox(code: string, lead: string, onDone: () => void): HTMLElement {
  const copy = copyButton({ label: t('recovery.copy'), copied: t('recovery.copied'), text: () => code, fieldLabel: t('recovery.title') });
  const done = el('button', { class: 'button primary', text: t('recovery.saved'), attrs: { type: 'button' }, on: { click: onDone } });
  const box = statusBox('live', t('recovery.title'), lead, copy, done);
  box.classList.add('recovery-code');
  // the code stands between how it came about and what to do with it
  box.querySelector('.status-box-text')?.after(el('p', { class: 'recovery-code-value', text: code }), el('p', { class: 'status-box-text recovery-warning', text: t('recovery.warning') }));
  return box;
}
