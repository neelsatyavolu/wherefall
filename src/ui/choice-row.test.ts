import { describe, expect, it } from 'vitest';
import { stacksOnPhone } from './choice-row.ts';

describe('stacksOnPhone', () => {
  it('keeps short names side by side', () => {
    expect(stacksOnPhone(['3', '5', '10'])).toBe(false);
    expect(stacksOnPhone(['7 days', '30 days', 'All time'])).toBe(false);
    expect(stacksOnPhone(['Hidden', 'Shown'])).toBe(false);
    expect(stacksOnPhone(['World', 'Europe', 'Africa', 'A country'])).toBe(false);
  });

  it('stacks three options when one name is too long for a third of the row', () => {
    expect(stacksOnPhone(['Move', 'No move', 'No move, pan or zoom'])).toBe(true);
    expect(stacksOnPhone(['Rating', 'XP', 'Best streak'])).toBe(true);
  });

  it('gives a name more room when the options sit two across', () => {
    expect(stacksOnPhone(['Sign in', 'Create account'])).toBe(false);
    expect(stacksOnPhone(['Anmelden', 'Ein neues Konto erstellen'])).toBe(true);
    expect(stacksOnPhone(['English', 'Español', 'Français', 'Deutsch', 'Русский'])).toBe(false);
  });

  it('has nothing to stack with one option or none', () => {
    expect(stacksOnPhone([])).toBe(false);
    expect(stacksOnPhone(['A very long name for the only option'])).toBe(false);
  });
});
