import './guest.css';
import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { flag } from './flag.ts';
import { hrefFor } from './nav.ts';

/** What a guest is shown: the name they were given, what signing up adds, and the way to it. */

/** A player's flag and name as plain text, for the places a name is not a link: the wait, health, chat, the versus screen. */
export function plainName(text: string, country: string | null | undefined, className: string): HTMLElement {
  return el('span', { class: className }, flag(country), text);
}

/** The way to the account pane, where a guest signs up. From a match it opens in a new tab, so the match is not left. */
export function signUpLink(className: string, newTab = false): HTMLAnchorElement {
  const attrs: Record<string, string> = newTab ? { href: hrefFor('account'), target: '_blank', rel: 'noopener' } : { href: hrefFor('account') };
  return el('a', { class: className, text: t('guest.signUp'), attrs });
}

/** A guest's name where an account's would be, with the way to sign up beside it. */
const guestLabel = (className: string, text: string): HTMLElement =>
  el('div', { class: className, attrs: { role: 'group', 'aria-label': t('guest.label') } }, el('span', { class: 'guest-name', text }), signUpLink('guest-link'));

/** In the sidebar: the guest's name alone. */
export const guestBadge = (name: string): HTMLElement => guestLabel('guest-badge', name);

/** For a guest on a pane that needs an account: what signing up adds, in place of controls the server would refuse. */
export function guestNotice(name: string): HTMLElement {
  return el('div', { class: 'notice' }, el('p', { class: 'prose', text: t('guest.needsAccount', { name }) }), signUpLink('button primary'));
}
