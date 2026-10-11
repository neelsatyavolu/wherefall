import { describe, expect, it } from 'vitest';
import { friendOffer, standingAfter } from './friend-offer.ts';

describe('friendOffer', () => {
  it('offers a request to a player who is no friend yet', () => {
    expect(friendOffer('none')).toEqual({ kind: 'button', action: 'request' });
  });

  it('offers to accept a request the player sent', () => {
    expect(friendOffer('incoming')).toEqual({ kind: 'button', action: 'accept' });
  });

  it('says a request was sent, and that friends are friends, with nothing to press', () => {
    expect(friendOffer('outgoing')).toEqual({ kind: 'note', standing: 'outgoing' });
    expect(friendOffer('friends')).toEqual({ kind: 'note', standing: 'friends' });
  });

  it("shows nothing on the player's own profile, nor to a visitor or a guest", () => {
    expect(friendOffer('self')).toBeNull();
    expect(friendOffer(null)).toBeNull();
  });
});

describe('standingAfter', () => {
  it('is a request sent after asking, and friends after accepting', () => {
    expect(standingAfter('request')).toBe('outgoing');
    expect(standingAfter('accept')).toBe('friends');
  });
});
