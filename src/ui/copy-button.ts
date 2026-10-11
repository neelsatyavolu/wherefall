import { el } from './dom.ts';

const COPIED_NOTICE_MS = 2000;

interface CopyOptions {
  /** what the button says */
  label: string;
  /** what it says for a moment once the text is on the clipboard */
  copied: string;
  /** the text to copy, made when the button is pressed */
  text: () => string;
  /** the name of the field shown in the button's place when the browser will not copy */
  fieldLabel: string;
}

/**
 * A button that copies a text and says it did. When the clipboard is blocked (permissions, an
 * insecure origin) the text is shown in the button's place, so it can be copied by hand.
 */
export function copyButton(options: CopyOptions): HTMLButtonElement {
  const button = el('button', { class: 'button ghost', text: options.label, attrs: { type: 'button' } });
  button.addEventListener('click', async () => {
    const text = options.text();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const lines = text.split('\n').length;
      const attrs = { readonly: '', 'aria-label': options.fieldLabel };
      const field = lines > 1 ? el('textarea', { class: 'link-field', text, attrs: { ...attrs, rows: String(lines) } }) : el('input', { class: 'link-field', attrs: { ...attrs, value: text } });
      button.replaceWith(field);
      return;
    }
    button.textContent = options.copied;
    setTimeout(() => {
      button.textContent = options.label;
    }, COPIED_NOTICE_MS);
  });
  return button;
}
