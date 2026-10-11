import { describe, expect, it } from 'vitest';
import { RECOVERY_ALPHABET, RECOVERY_CODE_LENGTH, hashRecoveryCode, newRecoveryCode, normaliseRecoveryCode, verifyRecoveryCode } from './recovery.js';

describe('a recovery code', () => {
  it('is twelve characters in three groups of four, from letters and digits nobody mistakes for each other', () => {
    expect(RECOVERY_ALPHABET).toHaveLength(31);
    expect(RECOVERY_CODE_LENGTH).toBe(12);
    for (const confusable of '0O1IL') {
      expect(RECOVERY_ALPHABET).not.toContain(confusable);
    }
    const codes = Array.from({ length: 200 }, newRecoveryCode);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);
    // Every character of the alphabet turns up: none is left out by the way one is picked.
    expect(new Set(codes.join('').replaceAll('-', '')).size).toBe(RECOVERY_ALPHABET.length);
  });

  it('is read the same whatever its capitals, spaces and hyphens', () => {
    expect(normaliseRecoveryCode('K7QM-2XHD-9RWP')).toBe('K7QM2XHD9RWP');
    expect(normaliseRecoveryCode(' k7qm 2xhd\t9rwp-\n')).toBe('K7QM2XHD9RWP');
    expect(normaliseRecoveryCode('k-7-q-m2xhd9rwp')).toBe('K7QM2XHD9RWP');
  });

  it('is kept as a slow hash, and matched however it is typed back', async () => {
    const stored = await hashRecoveryCode('K7QM-2XHD-9RWP');
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('K7QM');
    expect(await verifyRecoveryCode('k7qm 2xhd 9rwp', stored)).toBe(true);
    expect(await verifyRecoveryCode('K7QM-2XHD-9RWQ', stored)).toBe(false);
    expect(await verifyRecoveryCode('', stored)).toBe(false);
  });
});
