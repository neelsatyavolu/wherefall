import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme } from './theme.ts';

describe('the theme switch', () => {
  it('cycles system, light, dark and back', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it("reads a stored choice, and anything else as the system's", () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('sepia')).toBe('system');
  });
});
