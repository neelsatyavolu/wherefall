import './maps.css';
import { formatNumber, t } from '../i18n/index.ts';
import type { Draft } from '../social/map-editor.ts';
import { MAP_LIMITS } from '../social/maps.ts';
import { el } from './dom.ts';

type Control = HTMLInputElement | HTMLTextAreaElement;

interface Field {
  control: Control;
  label: string;
  hint: string;
  min: number;
  max: number;
  /** shown under the field for as long as it holds too little: what an older map is asked for */
  asks?: string;
}

/**
 * One field with what it takes written under it and, beside that, how much it holds now. The count
 * is of what would be saved (the spaces around the text are not), and it stands out while the text
 * is outside its limits.
 */
function field({ control, label, hint, min, max, asks }: Field): HTMLElement {
  const about = el('p', { class: 'fine', text: hint, attrs: { id: `${control.id}-hint` } });
  const count = el('span', { class: 'field-count', attrs: { id: `${control.id}-count` } });
  const ask = asks === undefined ? null : el('p', { class: 'settings-line', text: asks, attrs: { id: `${control.id}-asks` } });
  const update = () => {
    const length = control.value.trim().length;
    count.textContent = t('editor.count', { count: formatNumber(length), max: formatNumber(max) });
    count.dataset.state = length < min || length > max ? 'out' : 'in';
    if (ask) {
      ask.hidden = length >= min;
    }
  };
  control.setAttribute('aria-describedby', [about.id, count.id, ask?.id].filter(Boolean).join(' '));
  control.addEventListener('input', update);
  update();
  return el('div', { class: 'account-field' }, el('label', { class: 'label', text: label, attrs: { for: control.id } }), control, el('div', { class: 'field-foot' }, about, count), ask);
}

const textarea = (id: string, rows: number, max: number, value: string): HTMLTextAreaElement => {
  const control = el('textarea', { class: 'account-input', attrs: { id, rows: String(rows), maxlength: String(max) } });
  control.value = value;
  return control;
};

/**
 * The words of a map: its name, the short description every map must have, and the long one it
 * may have. `saved` is for a map opened to be changed: one from before the short description was
 * required is asked for it there, in the field, before anything is refused.
 */
export function editorFields(draft: Draft, saved: boolean) {
  const name = el('input', { class: 'account-input', attrs: { id: 'map-name', type: 'text', maxlength: String(MAP_LIMITS.maxName), autocomplete: 'off', value: draft.name } });
  const description = textarea('map-description', 2, MAP_LIMITS.maxDescription, draft.description);
  const details = textarea('map-details', 5, MAP_LIMITS.maxDetails, draft.details);
  const lacking = saved && draft.description.trim().length < MAP_LIMITS.minDescription;
  const node = el(
    'div',
    { class: 'account-form' },
    field({ control: name, label: t('editor.name'), hint: t('editor.nameHint', { min: MAP_LIMITS.minName, max: MAP_LIMITS.maxName }), min: MAP_LIMITS.minName, max: MAP_LIMITS.maxName }),
    field({
      control: description,
      label: t('editor.description'),
      hint: t('editor.descriptionHint', { min: MAP_LIMITS.minDescription, max: MAP_LIMITS.maxDescription }),
      min: MAP_LIMITS.minDescription,
      max: MAP_LIMITS.maxDescription,
      asks: lacking ? t('editor.descriptionMissing') : undefined,
    }),
    field({ control: details, label: t('editor.details'), hint: t('editor.detailsHint', { max: formatNumber(MAP_LIMITS.maxDetails) }), min: 0, max: MAP_LIMITS.maxDetails }),
  );
  return { node, read: () => ({ name: name.value, description: description.value, details: details.value }) };
}
