import { countryName } from '../game/locations.ts';
import { el } from './dom.ts';

const REGIONAL_INDICATOR_A = 0x1f1e6;
const SAMPLE = 16;

/** A two-letter country code as the pair of regional-indicator letters a font draws as that country's flag. */
export function flagEmoji(country: string): string | null {
  const code = country.toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? [...code].map((letter) => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - 65)).join('') : null;
}

let drawn: boolean | null = null;

/**
 * Whether this platform's fonts draw flags. Where they do not (Windows), the pair comes out as two
 * plain letters in the text colour, so a flag is one that has any colour in it.
 */
function flagsDrawn(): boolean {
  if (drawn === null) {
    const context = el('canvas', { attrs: { width: String(SAMPLE), height: String(SAMPLE) } }).getContext('2d', { willReadFrequently: true });
    if (!context) {
      return false;
    }
    context.font = `${SAMPLE - 4}px sans-serif`;
    context.textBaseline = 'top';
    context.fillText(flagEmoji('FR') ?? '', 0, 0);
    const pixels = context.getImageData(0, 0, SAMPLE, SAMPLE).data;
    drawn = pixels.some((value, index) => index % 4 < 2 && value !== pixels[index + 1]);
  }
  return drawn;
}

/**
 * A country's flag to put beside a name: the Unicode flag where the platform draws one, else the
 * two-letter code in the mono face. Nothing for a player with no country. Its name is the label.
 */
export function flag(country: string | null | undefined): HTMLElement | null {
  const emoji = country ? flagEmoji(country) : null;
  if (!country || !emoji) {
    return null;
  }
  const attrs = { role: 'img', 'aria-label': countryName(country.toUpperCase()), title: countryName(country.toUpperCase()) };
  return flagsDrawn() ? el('span', { class: 'flag', text: emoji, attrs }) : el('span', { class: 'flag flag-code', text: country.toUpperCase(), attrs });
}
