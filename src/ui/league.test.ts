import { afterEach, describe, expect, it } from 'vitest';
import { useLanguage } from '../i18n/index.ts';
import { leagueName } from './league.ts';

describe('leagueName', () => {
  afterEach(() => useLanguage('en'));

  it('shows a league the page knows in the language in use', async () => {
    expect(leagueName('Nomad')).toBe('Nomad');
    await useLanguage('de');
    expect(leagueName('Nomad')).toBe('Nomade');
    expect(leagueName('Legend')).toBe('Legende');
  });

  it('shows a league the page has not heard of as the server named it', async () => {
    await useLanguage('fr');
    expect(leagueName('Cartographer')).toBe('Cartographer');
  });
});
