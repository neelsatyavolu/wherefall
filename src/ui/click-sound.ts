/**
 * The soft click of a button. One listener on the page hears every press, wherever the button was
 * made, so no screen has to remember it; it plays through the same sounds as everything else, and
 * so under the same Sound setting and volume, and never before the player's first touch.
 *
 * A click is a press on a button, on a link drawn as one, on an item of the menu, on a choice (a
 * radio or a checkbox, however it is drawn) or on the heading of a folded section. It is not a
 * keystroke or a press in a text field, which fire no `click`; Enter in a field of a form does
 * press the form's button, once, and sounds once. A press on the text of a choice reaches the
 * page twice, on the label and then on the input the label stands for: only the input counts.
 */

export const MAKES_CLICK = 'button, summary, [role="button"], a.button, a.nav-item, input[type="radio"], input[type="checkbox"]';

/**
 * Buttons that make a sound of their own, which a click would only double: Guess, whose press is
 * answered by the round's result. Another can opt out with `data-own-sound`. (A sound played in
 * the very press, such as a pin placed or an answer given, is also kept single by `sounds.play`.)
 */
export const OWN_SOUND = 'button.guess, [data-own-sound]';

/** The little of an element this asks for, so it can be tested without a page. */
interface Pressed {
  closest(selector: string): unknown;
}

const isPressed = (target: unknown): target is Pressed => typeof (target as Pressed | null)?.closest === 'function';

/** Whether a press on `target` is one a click is heard for. */
export function makesClick(target: unknown): boolean {
  return isPressed(target) && target.closest(MAKES_CLICK) !== null && target.closest(OWN_SOUND) === null;
}

interface Listens {
  addEventListener(type: 'click', run: (event: { target: unknown }) => void): void;
  removeEventListener(type: 'click', run: (event: { target: unknown }) => void): void;
}

/** Puts the one listener on `page`; `play` is called for each press that makes a click. Returns what takes it off again. */
export function wireClickSound(page: Listens, play: () => void): () => void {
  const hear = (event: { target: unknown }) => {
    if (makesClick(event.target)) {
      play();
    }
  };
  page.addEventListener('click', hear);
  return () => page.removeEventListener('click', hear);
}
