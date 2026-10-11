import { el } from './dom.ts';
import { flag } from './flag.ts';
import { mapHref } from './nav.ts';

/** The address of a player's public profile. */
export const profileHref = (username: string) => `?user=${encodeURIComponent(username)}`;

/** A link to somewhere inside the app. The home screen takes the click and changes view without a page load. */
export function appLink(text: string, href: string, className = 'profile-link'): HTMLAnchorElement {
  return el('a', { class: className, text, attrs: { href, 'data-nav': '' } });
}

/**
 * A username that leads to the player's profile. From the home screen it opens in place; from a
 * lobby or a match it opens in a new tab, so the match is not left.
 */
export function profileLink(username: string, newTab = false): HTMLAnchorElement {
  return newTab
    ? el('a', { class: 'profile-link', text: username, attrs: { href: profileHref(username), target: '_blank', rel: 'noopener' } })
    : appLink(username, profileHref(username));
}

/** A guest's name always has a `#`, which no account's can: a guest has no profile to link to. */
export const isGuestName = (username: string) => username.includes('#');

export interface NameOptions {
  /** the player's two-letter country, when they have one */
  country?: string | null;
  /** open the profile in a new tab: for a lobby or a match, which must not be left */
  newTab?: boolean;
}

/**
 * A player's name as it is shown everywhere: their flag when they have a country, then the name,
 * which leads to their profile unless they are a guest.
 */
export function playerName(username: string, options: NameOptions = {}): HTMLElement {
  const name = isGuestName(username) ? el('span', { class: 'guest-name', text: username }) : profileLink(username, options.newTab);
  return el('span', { class: 'player' }, flag(options.country), name);
}

/** A community map's name, leading to its page. */
export const mapLink = (slug: string, name: string) => appLink(name, mapHref(slug));
