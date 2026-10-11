import './welcome.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

interface WelcomeHandlers {
  /** play the two guided rounds */
  onTutorial: () => void;
  /** straight to the home screen */
  onSkip: () => void;
}

/**
 * What a new visitor sees before the home screen: what Wherefall is, and two choices. The tutorial is
 * the one accent action; skipping is beside it, as quiet as a way out is anywhere else. It stands
 * in the column the loading line before it and after it stands in, so nothing jumps.
 */
export function welcomeScreen(handlers: WelcomeHandlers): HTMLElement {
  return el(
    'main',
    { class: 'home welcome', attrs: { 'aria-label': t('welcome.label') } },
    el('h1', { class: 'wordmark' }, 'Wherefall', el('span', { class: 'caret', attrs: { 'aria-hidden': 'true' } })),
    el('p', { class: 'lede', text: t('welcome.lede') }),
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'button accent', text: t('welcome.tutorial'), attrs: { type: 'button' }, on: { click: handlers.onTutorial } }),
      el('button', { class: 'button ghost', text: t('welcome.skip'), attrs: { type: 'button' }, on: { click: handlers.onSkip } }),
    ),
    el('p', { class: 'fine', text: t('welcome.note') }),
  );
}
