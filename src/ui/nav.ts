import { communitySlugOf } from '../game/locations.ts';
import { t } from '../i18n/index.ts';

/** The home sidebar: what is in it, and which view an address selects. No DOM in here. */

/** The groups and their items, by id. What each is called comes from `navGroupName` and `navName`, in the language in use. */
export const NAV_GROUPS = [
  { id: 'solo', items: [{ id: 'singleplayer' }, { id: 'streak' }, { id: 'country' }, { id: 'continent' }, { id: 'daily' }] },
  { id: 'online', items: [{ id: 'ranked' }, { id: 'unranked' }, { id: 'team' }] },
  { id: 'party', items: [{ id: 'create' }, { id: 'join' }] },
  { id: 'community', items: [{ id: 'maps' }, { id: 'leaderboards' }, { id: 'friends' }, { id: 'account' }, { id: 'moderation' }, { id: 'about' }] },
] as const;

/** Items that are in the sidebar only for some players. Moderation is there for moderators. */
export const RESTRICTED: readonly NavId[] = ['moderation'];

export type NavId = (typeof NAV_GROUPS)[number]['items'][number]['id'];
export type NavGroupId = (typeof NAV_GROUPS)[number]['id'];
/**
 * What the home screen can show: a nav item's pane, or one of the views reached from a pane, which
 * have no nav item of their own: a player's profile, a community map's page, the map editor.
 */
export type View =
  | { pane: NavId }
  | { pane: 'profile'; username: string }
  | { pane: 'map'; slug: string }
  /** `slug` is the map being edited, or null for a new one */
  | { pane: 'editor'; slug: string | null };

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => [...group.items]);
const DEFAULT_ITEM: NavId = 'singleplayer';
/** letters and digits only: the code is put into a form field and sent to the server as typed */
const CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;
/** the shape every username has */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const NEW_MAP = 'new';

export const hrefFor = (id: NavId) => `#${id}`;

export const navName = (id: NavId): string => t(`nav.item.${id}`);

export const navGroupName = (id: NavGroupId): string => t(`nav.group.${id}`);

/** The code a party link (`?party=CODE`) carries, or an empty string. */
export function partyCode(search: string): string {
  const code = new URLSearchParams(search).get('party') ?? '';
  return CODE_PATTERN.test(code) ? code : '';
}

/** The player a profile link (`?user=NAME`) names, or an empty string. */
export function profileUser(search: string): string {
  const username = new URLSearchParams(search).get('user') ?? '';
  return USERNAME_PATTERN.test(username) ? username : '';
}

/** The address of a community map's page. */
export const mapHref = (slug: string) => `?community=${encodeURIComponent(slug)}`;

/** The address of the map editor: on one of the player's maps, or empty for a new one. */
export const editorHref = (slug: string | null) => `?edit=${encodeURIComponent(slug ?? NEW_MAP)}`;

/** A slug from the address, or an empty string when it is not one. */
function slugParam(search: string, name: string): string {
  const value = new URLSearchParams(search).get(name) ?? '';
  return communitySlugOf(`community:${value}`) ?? '';
}

/**
 * The view an address selects. The hash names a nav item and wins; without one a profile link
 * opens that profile and a party link opens Join party. Challenge links (`?map=…&seed=…`) carry
 * neither and so stay on Singleplayer.
 */
export function viewFor(hash: string, search: string): View {
  const named = NAV_ITEMS.find((item) => hrefFor(item.id) === hash);
  if (named) {
    return { pane: named.id };
  }
  const username = profileUser(search);
  if (username) {
    return { pane: 'profile', username };
  }
  const page = slugParam(search, 'community');
  if (page) {
    return { pane: 'map', slug: page };
  }
  const params = new URLSearchParams(search);
  if (params.get('edit') === NEW_MAP || slugParam(search, 'edit')) {
    return { pane: 'editor', slug: params.get('edit') === NEW_MAP ? null : slugParam(search, 'edit') };
  }
  return { pane: partyCode(search) ? 'join' : DEFAULT_ITEM };
}

/** Two views are the same pane when nothing would change by switching between them. */
export const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

/** The nav item a view belongs under, for marking it in the sidebar; null for a profile, which belongs to none. */
export function navFor(view: View): NavId | null {
  if (view.pane === 'profile') {
    return null;
  }
  return view.pane === 'map' || view.pane === 'editor' ? 'maps' : view.pane;
}
