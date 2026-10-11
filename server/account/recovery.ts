import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.js';

/** What a recovery code is written in: capitals and digits, without the ones taken for each other (no 0 O 1 I L). */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;
/** How long a code is once its hyphens are taken out. */
export const RECOVERY_CODE_LENGTH = GROUPS * GROUP_LENGTH;

const group = (): string => Array.from({ length: GROUP_LENGTH }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');

/** A new recovery code as it is shown, once: `K7QM-2XHD-9RWP`. */
export const newRecoveryCode = (): string => Array.from({ length: GROUPS }, group).join('-');

/** A code as it is hashed and compared: in capitals, without the spaces and hyphens it was shown or typed with. */
export const normaliseRecoveryCode = (typed: string): string => typed.replace(/[\s-]/g, '').toUpperCase();

/** A code is kept as a password is: a salted, slow hash. */
export const hashRecoveryCode = (code: string): Promise<string> => hashPassword(normaliseRecoveryCode(code));

/** True when `code`, however it was typed, is the one `stored` was made from. Compared in constant time, as a password is. */
export const verifyRecoveryCode = (code: string, stored: string): Promise<boolean> => verifyPassword(normaliseRecoveryCode(code), stored);
