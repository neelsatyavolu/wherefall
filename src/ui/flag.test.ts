import { describe, expect, it } from 'vitest';
import { flagEmoji } from './flag.ts';

describe('flagEmoji', () => {
  it('spells a country code in regional-indicator letters', () => {
    expect(flagEmoji('FR')).toBe('\u{1F1EB}\u{1F1F7}');
    expect(flagEmoji('jp')).toBe('\u{1F1EF}\u{1F1F5}');
  });

  it('has nothing for what is not a two-letter code', () => {
    expect(flagEmoji('')).toBeNull();
    expect(flagEmoji('FRA')).toBeNull();
    expect(flagEmoji('F1')).toBeNull();
  });
});
