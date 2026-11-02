import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

/**
 * The theme switch in the sidebar: system, then light, then dark. The choice is kept in this
 * browser under `THEME_KEY` and set as `data-theme` on <html>; `public/theme.js` sets it again
 * before the first paint, so a forced theme never flashes the other one.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'plonk.theme';

const ICONS: Readonly<Record<Theme, string>> = {
  system: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 14h4"/>',
  light: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/>',
  dark: '<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"/>',
};

/** A stored value as a theme: anything unknown, or nothing, is the system's. */
export const parseTheme = (value: string | null | undefined): Theme => (value === 'light' || value === 'dark' ? value : 'system');

/** The theme a click moves to. */
export const nextTheme = (theme: Theme): Theme => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;

function stored(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function apply(theme: Theme): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked: the theme holds for this page only
  }
}

/** The ghost icon button that cycles the theme. */
export function themeToggle(): HTMLButtonElement {
  let theme = stored();
  const button = el('button', { class: 'button ghost theme-toggle', attrs: { type: 'button' } });
  const show = (): void => {
    const label = t(`home.theme.${theme}`);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${ICONS[theme]}</svg>`;
  };
  button.addEventListener('click', () => {
    theme = nextTheme(theme);
    apply(theme);
    show();
  });
  show();
  return button;
}
