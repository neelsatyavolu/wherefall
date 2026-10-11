import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, RESTRICTED, editorHref, hrefFor, mapHref, navFor, navGroupName, navName, partyCode, profileUser, resetToken, sameView, viewFor } from './nav.ts';

/** a reset token as an email carries it */
const TOKEN = 'Zk3v9Qx1LrT8mB2nYc7WdA5sHj0PqUeXoIiGfRtN4wE';

describe('the nav list', () => {
  it('has the items in their groups', () => {
    expect(NAV_GROUPS.map((group) => [navGroupName(group.id), ...group.items.map((item) => navName(item.id))])).toEqual([
      ['Solo', 'Singleplayer', 'Country streak', 'Country Guesser', 'Continent Guesser', 'Daily challenge'],
      ['Online', 'Ranked duel', 'Unranked match', '2v2 match'],
      ['Party', 'Create party', 'Join party'],
      ['Community', 'Maps', 'Leaderboards', 'Friends', 'Account', 'Moderation', 'About'],
    ]);
  });

  it('opens the two guessers and About from their own addresses', () => {
    expect(viewFor('#country', '')).toEqual({ pane: 'country' });
    expect(viewFor('#continent', '')).toEqual({ pane: 'continent' });
    expect(viewFor('#about', '')).toEqual({ pane: 'about' });
    expect(navFor({ pane: 'about' })).toBe('about');
  });

  it('keeps Moderation out of the sidebar unless it is asked for', () => {
    expect(RESTRICTED).toEqual(['moderation']);
    expect(viewFor('#moderation', '')).toEqual({ pane: 'moderation' });
  });

  it('gives every item its own address and knows its name', () => {
    const ids = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(hrefFor('daily')).toBe('#daily');
    expect(navName('team')).toBe('2v2 match');
  });
});

describe('viewFor', () => {
  it('is singleplayer on a plain address', () => {
    expect(viewFor('', '')).toEqual({ pane: 'singleplayer' });
    expect(viewFor('#', '')).toEqual({ pane: 'singleplayer' });
  });

  it('follows the hash', () => {
    expect(viewFor('#ranked', '')).toEqual({ pane: 'ranked' });
    expect(viewFor('#streak', '')).toEqual({ pane: 'streak' });
    expect(viewFor('#leaderboards', '')).toEqual({ pane: 'leaderboards' });
    expect(viewFor('#friends', '')).toEqual({ pane: 'friends' });
  });

  it('falls back to singleplayer for a hash it does not know', () => {
    expect(viewFor('#nowhere', '')).toEqual({ pane: 'singleplayer' });
  });

  it('keeps a challenge link on singleplayer', () => {
    expect(viewFor('', '?map=world&seed=e2e00001&t=0&mode=move&n=5')).toEqual({ pane: 'singleplayer' });
  });

  it('opens join party for a party link, unless the hash says otherwise', () => {
    expect(viewFor('', '?party=ABC123')).toEqual({ pane: 'join' });
    expect(viewFor('#account', '?party=ABC123')).toEqual({ pane: 'account' });
    expect(viewFor('', '?party=')).toEqual({ pane: 'singleplayer' });
  });

  it('opens a profile for a profile link, unless the hash names a pane', () => {
    expect(viewFor('', '?user=sam_1')).toEqual({ pane: 'profile', username: 'sam_1' });
    expect(viewFor('#daily', '?user=sam_1')).toEqual({ pane: 'daily' });
    expect(viewFor('', '?user=x')).toEqual({ pane: 'singleplayer' });
  });

  it('opens the account pane for a reset link, where the new password is chosen, unless the hash names a pane', () => {
    expect(viewFor('', `?reset=${TOKEN}`)).toEqual({ pane: 'account' });
    expect(viewFor('#account', `?reset=${TOKEN}`)).toEqual({ pane: 'account' });
    expect(viewFor('#leaderboards', `?reset=${TOKEN}`)).toEqual({ pane: 'leaderboards' });
    expect(viewFor('', '?reset=')).toEqual({ pane: 'singleplayer' });
  });
});

describe('resetToken', () => {
  it('reads the token a reset link carries', () => {
    expect(resetToken(`?reset=${TOKEN}`)).toBe(TOKEN);
    expect(resetToken(`?lang=fr&reset=${TOKEN}`)).toBe(TOKEN);
  });

  it('takes a link cut short as a token still, so the server can say it will not do', () => {
    expect(resetToken('?reset=Zk3v9Qx1')).toBe('Zk3v9Qx1');
  });

  it('is empty without one, and for anything that could not be part of a token', () => {
    expect(resetToken('')).toBe('');
    expect(resetToken('?party=ABC123')).toBe('');
    expect(resetToken('?reset=')).toBe('');
    expect(resetToken('?reset=<script>')).toBe('');
    expect(resetToken('?reset=a%20b')).toBe('');
    expect(resetToken(`?reset=${'a'.repeat(129)}`)).toBe('');
  });
});

describe('community maps in the address', () => {
  it('opens a map page from its link', () => {
    expect(mapHref('paris-walk-x7k2')).toBe('?community=paris-walk-x7k2');
    expect(viewFor('', '?community=paris-walk-x7k2')).toEqual({ pane: 'map', slug: 'paris-walk-x7k2' });
  });

  it('opens the editor on a new map or on one being edited', () => {
    expect(viewFor('', editorHref(null))).toEqual({ pane: 'editor', slug: null });
    expect(viewFor('', editorHref('paris-walk-x7k2'))).toEqual({ pane: 'editor', slug: 'paris-walk-x7k2' });
  });

  it('ignores a slug that is not one, and gives way to the hash', () => {
    expect(viewFor('', '?community=Not%20A%20Slug')).toEqual({ pane: 'singleplayer' });
    expect(viewFor('', '?edit=..%2Fx')).toEqual({ pane: 'singleplayer' });
    expect(viewFor('#maps', '?community=paris-walk-x7k2')).toEqual({ pane: 'maps' });
  });

  it('marks Maps in the sidebar for a map page and the editor, and nothing for a profile', () => {
    expect(navFor({ pane: 'map', slug: 'a' })).toBe('maps');
    expect(navFor({ pane: 'editor', slug: null })).toBe('maps');
    expect(navFor({ pane: 'daily' })).toBe('daily');
    expect(navFor({ pane: 'profile', username: 'sam' })).toBeNull();
    expect(sameView({ pane: 'map', slug: 'a' }, { pane: 'map', slug: 'b' })).toBe(false);
    expect(sameView({ pane: 'editor', slug: null }, { pane: 'editor', slug: null })).toBe(true);
  });
});

describe('partyCode and profileUser', () => {
  it('reads the code from a party link', () => {
    expect(partyCode('?party=ABC123')).toBe('ABC123');
    expect(partyCode('?party=abc123&x=1')).toBe('abc123');
  });

  it('is empty without one, or for something that is not a code', () => {
    expect(partyCode('')).toBe('');
    expect(partyCode('?map=world')).toBe('');
    expect(partyCode('?party=<script>')).toBe('');
    expect(partyCode('?party=ABC1234567890123')).toBe('');
  });

  it('reads a username only when it has the shape of one', () => {
    expect(profileUser('?user=neel')).toBe('neel');
    expect(profileUser('?user=a b')).toBe('');
    expect(profileUser('?user=<b>')).toBe('');
    expect(profileUser('')).toBe('');
  });
});

describe('sameView', () => {
  it('tells panes and profiles apart', () => {
    expect(sameView({ pane: 'daily' }, { pane: 'daily' })).toBe(true);
    expect(sameView({ pane: 'daily' }, { pane: 'friends' })).toBe(false);
    expect(sameView({ pane: 'profile', username: 'sam' }, { pane: 'profile', username: 'sam' })).toBe(true);
    expect(sameView({ pane: 'profile', username: 'sam' }, { pane: 'profile', username: 'ana' })).toBe(false);
    expect(sameView({ pane: 'profile', username: 'sam' }, { pane: 'account' })).toBe(false);
  });
});
