import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The colour tokens are read from the stylesheet itself and measured with the WCAG formula, so a
// change to one that makes text hard to read fails here rather than in a review of screenshots.

type Rgb = readonly [number, number, number];

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
/** small text needs this much against what it sits on */
const AA = 4.5;

/** The tokens of one scheme: the first `:root` block is the dark one, the block under the light media query the light one. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

const DARK = tokens(CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media (prefers-color-scheme: light)')));
const LIGHT = { ...DARK, ...tokens(CSS.slice(CSS.indexOf('@media (prefers-color-scheme: light)'), CSS.indexOf('*,\n*::before'))) };

/** A colour as the stylesheet writes it, hex or rgba, with its opacity. */
function parse(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!rgba) {
    throw new Error(`not a colour this test can read: ${value}`);
  }
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

/** A colour laid over an opaque one. */
function over(top: string, under: Rgb): Rgb {
  const { rgb, alpha } = parse(top);
  return [0, 1, 2].map((i) => rgb[i]! * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

for (const [scheme, token] of [
  ['dark', DARK],
  ['light', LIGHT],
] as const) {
  describe(`the ${scheme} scheme`, () => {
    const bg = parse(token['--bg']!).rgb;
    const surface = over(token['--surface']!, bg);
    const accent = parse(token['--accent']!).rgb;

    it("reads the accent button's label, which is the canvas colour, on its fill", () => {
      expect(CSS).toMatch(/\.button\.accent \{\s*background: var\(--accent\);\s*color: var\(--bg\);/);
      expect(contrast(bg, accent)).toBeGreaterThanOrEqual(AA);
    });

    it('reads fine print, set in --fg-3, on the canvas and on a lifted surface', () => {
      expect(contrast(over(token['--fg-3']!, bg), bg)).toBeGreaterThanOrEqual(AA);
      expect(contrast(over(token['--fg-3']!, surface), surface)).toBeGreaterThanOrEqual(AA);
    });

    it('keeps secondary text a clear step above fine print', () => {
      expect(contrast(over(token['--fg-2']!, bg), bg)).toBeGreaterThan(contrast(over(token['--fg-3']!, bg), bg) + 1);
    });

    it('reads the danger colour, the text of a destructive button and of an error, on the canvas', () => {
      expect(contrast(parse(token['--danger']!).rgb, bg)).toBeGreaterThanOrEqual(AA);
    });

    it('reads the accent as a link in prose', () => {
      expect(contrast(accent, bg)).toBeGreaterThanOrEqual(AA);
    });
  });
}
