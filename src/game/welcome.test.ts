import { describe, expect, it } from 'vitest';
import { welcomeDue, type Arrival } from './welcome.ts';

const fresh: Arrival = { hash: '', search: '', answered: false, returning: false };

describe('when a visitor is welcomed', () => {
  it('welcomes a new visitor on the plain home page', () => {
    expect(welcomeDue(fresh)).toBe(true);
  });

  it('never again once the tutorial was chosen or it was skipped', () => {
    expect(welcomeDue({ ...fresh, answered: true })).toBe(false);
  });

  it('leaves alone a browser that was here before there was a welcome', () => {
    expect(welcomeDue({ ...fresh, returning: true })).toBe(false);
  });

  it.each([
    ['a nav link', '#daily', ''],
    ['the Singleplayer link itself', '#singleplayer', ''],
    ['a challenge link', '', '?map=world&seed=e2e00001&t=0&mode=move&n=3'],
    ['a party link', '', '?party=ABC123'],
    ['a profile', '', '?user=neel'],
    ['a community map', '', '?community=paris-walks'],
    ['the map editor', '', '?edit=new'],
    ['a link that also names a language', '', '?lang=de&party=ABC123'],
  ])('goes where %s leads, without the welcome', (_what, hash, search) => {
    expect(welcomeDue({ ...fresh, hash, search })).toBe(false);
  });

  it('takes a language in the address as the plain home page still', () => {
    expect(welcomeDue({ ...fresh, search: '?lang=de' })).toBe(true);
    expect(welcomeDue({ ...fresh, search: '?' })).toBe(true);
  });
});
