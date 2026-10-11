import './welcome.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';

interface WelcomeHandlers {
  /** to the account pane, where an account is made or signed in to */
  onAccount: () => void;
  /** straight to the home screen, to see what is there */
  onLook: () => void;
}

/**
 * What a new visitor sees before the home screen: what Wherefall is, and two choices. Playing takes
 * an account, so the way to one is the one accent action; looking around first is beside it, as
 * quiet as a way out is anywhere else. It stands in the column the loading line before it and
 * after it stands in, so nothing jumps.
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
      el('button', { class: 'button accent', text: t('common.signIn'), attrs: { type: 'button' }, on: { click: handlers.onAccount } }),
      el('button', { class: 'button ghost', text: t('welcome.look'), attrs: { type: 'button' }, on: { click: handlers.onLook } }),
    ),
    el('p', { class: 'fine', text: t('welcome.note') }),
  );
}
