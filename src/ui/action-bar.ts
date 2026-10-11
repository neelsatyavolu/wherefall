import './action-bar.css';
import { el } from './dom.ts';

/**
 * The bar that holds a pane's one forward action: Start game, Find a match, Create party. On a wide
 * screen it is an ordinary row where it stands. On a phone it is fixed to the foot of the screen, so
 * the action is in reach however long the options above it are; it lets go while the menu is open.
 *
 * Give it the button and, where the action can be refused, the line that says why (it is then read
 * beside the button, not somewhere off screen). It can stand anywhere in the pane, inside a form too:
 * a submit button in it still submits that form. One bar a pane.
 */
export function actionBar(...children: Array<Node | null>): HTMLElement {
  return el('div', { class: 'action-bar' }, ...children);
}
