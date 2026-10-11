/** What the keyboard does during a round: W and S (or the arrows) walk, A and D turn the view, plus and minus zoom it. */

export type KeyAction = 'forward' | 'back' | 'turnLeft' | 'turnRight' | 'zoomIn' | 'zoomOut';

const KEYS: Readonly<Record<string, KeyAction>> = {
  w: 'forward',
  arrowup: 'forward',
  s: 'back',
  arrowdown: 'back',
  a: 'turnLeft',
  d: 'turnRight',
  '+': 'zoomIn',
  // the plus key without shift
  '=': 'zoomIn',
  '-': 'zoomOut',
  _: 'zoomOut',
};

/** What a key does in a round, or null for a key the round does not use. */
export function keyAction(key: string): KeyAction | null {
  return KEYS[key.toLowerCase()] ?? null;
}

export type WalkAction = 'forward' | 'back';
export type SteerAction = Exclude<KeyAction, WalkAction>;

export const isWalk = (action: KeyAction): action is WalkAction => action === 'forward' || action === 'back';

/** True when the key was typed into a field, the chat among them: the letters are then text, not commands. */
export const isTyping = (event: KeyboardEvent): boolean =>
  event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable], dialog'));

/** True when the key belongs to a control that acts on it itself: a button, a link, a field, or Google's own view. */
export const onControl = (event: KeyboardEvent): boolean =>
  event.target instanceof Element && Boolean(event.target.closest('button, a, input, textarea, dialog, .gm-style'));

/** What the round screen does with its keys. */
export interface KeyHooks {
  /** true while a round is being played: the only time the view takes keys */
  playing: () => boolean;
  walk: (direction: WalkAction) => void;
  steer: (action: SteerAction) => void;
  /** Escape, while a round is being played */
  escape: () => void;
  /** space or enter was let go, anywhere but on a control */
  confirm: () => void;
}

/**
 * Listens for a round's keys on the window until the returned function is called. A held A or D
 * keeps turning; a walk takes one step a press. Nothing happens while a field is typed in, or with
 * a modifier held (those are the browser's own shortcuts).
 */
export function listenForKeys(hooks: KeyHooks): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!hooks.playing() || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) {
      return;
    }
    if (event.key === 'Escape') {
      hooks.escape();
      return;
    }
    const action = keyAction(event.key);
    if (action && !isWalk(action)) {
      hooks.steer(action);
    } else if (action && !event.repeat && !onControl(event)) {
      hooks.walk(action);
    }
  };
  /**
   * Guess and next are taken on key release. Acting on the press would move focus to the
   * "Next round" button mid-keystroke, and the release could then click it and skip the result.
   */
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!onControl(event) && (event.key === ' ' || event.key === 'Enter')) {
      hooks.confirm();
    }
  };
  // the press is heard on the way in: Google's view keeps the keys it is given from going any further
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp);
  };
}
