import type { LngLat } from '../game/geo.ts';
import type { Mode } from '../game/settings.ts';

/** What a driver tells the round screen when it makes one, and what the screen tells it back. */

export type Phase = 'loading' | 'guessing' | 'result' | 'summary';

/** What the dot beside a line of status says: something is under way, it went well, or it went wrong. */
export type StatusState = 'live' | 'ok' | 'error';

export interface ScreenConfig {
  /** shown in the HUD */
  mapName: string;
  mode: Mode;
  /** the HUD's counter: "Round" with a total (1 / 5), or a bare number such as "Streak" 3 */
  counter: { label: string; of: number | null };
  /** false hides the clock */
  timed: boolean;
  /** true offers the Hint button; `setHintsLeft` then says how many the game has */
  hint?: boolean;
  /** false leaves the score out of the HUD, for a game that has none */
  score?: boolean;
}

export interface ScreenEvents {
  /** the Guess button, or space/enter, with a pin placed */
  onGuess: () => void;
  /** space/enter while a result is showing */
  onNext: () => void;
  /** the Exit button in the HUD */
  onExit: () => void;
  onHint?: () => void;
  /** the pin was placed or moved */
  onPin?: (point: LngLat) => void;
  /** the player turned the view, walked from the start, or opened the guess map: what the tutorial's coach waits for */
  onLook?: () => void;
  onMove?: () => void;
  onMapOpen?: () => void;
}
