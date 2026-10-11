import './result.css';
import { reducedMotion } from './count-up.ts';
import { el } from './dom.ts';

/** A short burst of paper squares for a very good round. No library: a few elements and one animation. */

const PIECE_COUNT = 40;
const FLIGHT_MS = 1300;
const MAX_DELAY_MS = 200;
/** how far a piece can fly sideways and up, and how far it then falls, in pixels */
const MAX_DRIFT = 260;
const MAX_RISE = 240;
const MAX_FALL = 220;
const TONES = 3;

export interface Piece {
  /** sideways travel: negative to the left */
  drift: number;
  /** the top of its flight: negative is up */
  rise: number;
  /** where it ends, below where it began */
  fall: number;
  /** degrees it turns on the way */
  spin: number;
  /** milliseconds before it sets off */
  delay: number;
  /** which of the three tones it is */
  tone: number;
}

/** The pieces of one burst: each thrown up and out to a side, then falling. */
export function confettiPieces(count: number, rng: () => number): Piece[] {
  return Array.from({ length: count }, () => ({
    drift: Math.round((rng() * 2 - 1) * MAX_DRIFT),
    rise: -Math.round(60 + rng() * (MAX_RISE - 60)),
    fall: Math.round(40 + rng() * (MAX_FALL - 40)),
    spin: Math.round((rng() * 2 - 1) * 540),
    delay: Math.round(rng() * MAX_DELAY_MS),
    tone: Math.floor(rng() * TONES) % TONES,
  }));
}

function pieceNode(piece: Piece): HTMLElement {
  const node = el('span', { class: `confetti-piece tone-${piece.tone}` });
  const vars = { '--drift': `${piece.drift}px`, '--rise': `${piece.rise}px`, '--fall': `${piece.fall}px`, '--spin': `${piece.spin}deg` };
  Object.entries(vars).forEach(([name, value]) => node.style.setProperty(name, value));
  node.style.animationDelay = `${piece.delay}ms`;
  return node;
}

/**
 * Throws one burst over a screen and clears it away when it has landed. Nothing at all for a
 * player who asked for less motion. Returns whether a burst was thrown.
 */
export function confettiBurst(host: HTMLElement): boolean {
  if (reducedMotion()) {
    return false;
  }
  const layer = el('div', { class: 'confetti', attrs: { 'aria-hidden': 'true' } }, ...confettiPieces(PIECE_COUNT, Math.random).map(pieceNode));
  host.append(layer);
  window.setTimeout(() => layer.remove(), FLIGHT_MS + MAX_DELAY_MS);
  return true;
}
