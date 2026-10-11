import { describe, expect, it, vi } from 'vitest';
import { MAKES_CLICK, OWN_SOUND, makesClick, wireClickSound } from './click-sound.ts';

/** A stand-in for an element: `inside` is what `closest` finds from it, by selector. */
const target = (inside: Partial<Record<string, boolean>>) => ({ closest: (selector: string) => (inside[selector] ? {} : null) });

const press = (inside: Partial<Record<string, boolean>>) => ({ target: target(inside) });

describe('what makes a click', () => {
  it('is a press on a button, or on anything inside one', () => {
    expect(makesClick(target({ [MAKES_CLICK]: true }))).toBe(true);
  });

  it('is not a press anywhere else: a field, a label, the page', () => {
    expect(makesClick(target({}))).toBe(false);
    expect(makesClick(null)).toBe(false);
    expect(makesClick({} as never)).toBe(false);
  });

  it('is not a press on a button that makes a sound of its own', () => {
    expect(makesClick(target({ [MAKES_CLICK]: true, [OWN_SOUND]: true }))).toBe(false);
  });

  it('counts buttons, the links drawn as buttons, the menu, choices and folded sections, and no text field', () => {
    for (const each of ['button', 'summary', '[role="button"]', 'a.button', 'a.nav-item', 'input[type="radio"]', 'input[type="checkbox"]']) {
      expect(MAKES_CLICK.split(', ')).toContain(each);
    }
    expect(MAKES_CLICK).not.toMatch(/textarea|type="text"|type="search"|type="password"|label|select/);
    expect(OWN_SOUND).toContain('button.guess');
  });
});

describe('the one listener', () => {
  it('is one click listener on the page, which plays for a button and for nothing else', () => {
    type Hear = (event: { target: unknown }) => void;
    const listeners: Array<[string, Hear]> = [];
    const page = { addEventListener: (type: string, run: Hear) => void listeners.push([type, run]), removeEventListener: vi.fn() };
    const play = vi.fn();
    wireClickSound(page, play);
    expect(listeners.map(([type]) => type)).toEqual(['click']);
    const [, run] = listeners[0]!;
    run(press({ [MAKES_CLICK]: true }));
    expect(play).toHaveBeenCalledTimes(1);
    run(press({}));
    run(press({ [MAKES_CLICK]: true, [OWN_SOUND]: true }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('can be taken off again', () => {
    const page = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const off = wireClickSound(page, vi.fn());
    off();
    expect(page.removeEventListener).toHaveBeenCalledWith('click', page.addEventListener.mock.calls[0]![1]);
  });
});
