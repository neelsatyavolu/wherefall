import type { FriendAction, FriendStanding } from './client.ts';

/** What a profile offers about friendship: a button that asks or accepts, or a note that says how things stand. */
export type FriendOffer = { kind: 'button'; action: Extract<FriendAction, 'request' | 'accept'> } | { kind: 'note'; standing: 'outgoing' | 'friends' };

/**
 * What to show for how the viewer stands to the player. Nothing on the viewer's own profile, and
 * nothing for a visitor or a guest, who are told no standing at all.
 */
export function friendOffer(standing: FriendStanding): FriendOffer | null {
  switch (standing) {
    case 'none':
      return { kind: 'button', action: 'request' };
    case 'incoming':
      return { kind: 'button', action: 'accept' };
    case 'outgoing':
    case 'friends':
      return { kind: 'note', standing };
    default:
      return null;
  }
}

/** How things stand once the server has taken the action. */
export const standingAfter = (action: 'request' | 'accept'): NonNullable<FriendStanding> => (action === 'request' ? 'outgoing' : 'friends');
