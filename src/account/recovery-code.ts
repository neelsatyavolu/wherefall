/** A recovery code as a player types it back: twelve characters shown in groups of four, `K7QM-2XHD-9RWP`. */

const GROUP = 4;

/** what may stand between the groups, or around the code: spaces, the hyphen, and the dashes a keyboard or a note puts in its place */
const BETWEEN = /[\s\-‐-―−]/gu;

/**
 * A typed recovery code as it was shown: capitals, in groups of four. The player may have typed it
 * with or without its dashes, with spaces, in small letters. It is not judged here: a code that is
 * too short, too long or has a character no code has is sent on, and the server refuses it in its
 * own words.
 */
export function tidyRecoveryCode(typed: string): string {
  const bare = typed.replace(BETWEEN, '').toUpperCase();
  return (bare.match(new RegExp(`.{1,${GROUP}}`, 'gu')) ?? []).join('-');
}
