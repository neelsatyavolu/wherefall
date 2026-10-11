import { describe, expect, it } from 'vitest';
import { tidyRecoveryCode } from './recovery-code.ts';

describe('tidyRecoveryCode', () => {
  it('leaves a code written as it was shown alone', () => {
    expect(tidyRecoveryCode('K7QM-2XHD-9RWP')).toBe('K7QM-2XHD-9RWP');
  });

  it('takes a code typed without its dashes, in small letters', () => {
    expect(tidyRecoveryCode('k7qm2xhd9rwp')).toBe('K7QM-2XHD-9RWP');
  });

  it('takes spaces for dashes, and spaces around the code', () => {
    expect(tidyRecoveryCode('  k7qm 2xhd 9rwp ')).toBe('K7QM-2XHD-9RWP');
    expect(tidyRecoveryCode('K7QM\t2XHD\n9RWP')).toBe('K7QM-2XHD-9RWP');
  });

  it('takes the dashes a phone keyboard or a pasted note may put in', () => {
    expect(tidyRecoveryCode('k7qm–2xhd—9rwp')).toBe('K7QM-2XHD-9RWP');
    expect(tidyRecoveryCode('K7QM‑2XHD−9RWP')).toBe('K7QM-2XHD-9RWP');
    expect(tidyRecoveryCode('k7 qm-2x hd - 9rwp')).toBe('K7QM-2XHD-9RWP');
  });

  it('does not judge a code: one too short or too long is sent as typed, for the server to refuse', () => {
    expect(tidyRecoveryCode('k7q')).toBe('K7Q');
    expect(tidyRecoveryCode('k7qm2xhd9rwpx')).toBe('K7QM-2XHD-9RWP-X');
    expect(tidyRecoveryCode('k7qm 2xh0 9rwp')).toBe('K7QM-2XH0-9RWP');
  });

  it('is empty for nothing typed', () => {
    expect(tidyRecoveryCode('')).toBe('');
    expect(tidyRecoveryCode(' - ')).toBe('');
  });
});
