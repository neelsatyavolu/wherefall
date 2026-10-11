import { en } from '../i18n/en.ts';
import { t, type Key } from '../i18n/index.ts';

/** The server names a league in English. One this page knows is shown in the player's language, any other as it was sent. */
export function leagueName(name: string): string {
  const key = `league.${name}`;
  return key in en ? t(key as Key) : name;
}
