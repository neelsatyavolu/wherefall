import { describe, expect, it } from 'vitest';
import { keyAction } from './round-keys.ts';

describe('keyAction', () => {
  it('walks on W, S and the up and down arrows', () => {
    expect(keyAction('w')).toBe('forward');
    expect(keyAction('ArrowUp')).toBe('forward');
    expect(keyAction('s')).toBe('back');
    expect(keyAction('ArrowDown')).toBe('back');
  });

  it('turns on A and D', () => {
    expect(keyAction('a')).toBe('turnLeft');
    expect(keyAction('d')).toBe('turnRight');
  });

  it('zooms on plus and minus, with or without shift, and on the number pad', () => {
    expect(keyAction('+')).toBe('zoomIn');
    expect(keyAction('=')).toBe('zoomIn');
    expect(keyAction('-')).toBe('zoomOut');
    expect(keyAction('_')).toBe('zoomOut');
  });

  it('takes letters in either case, as with caps lock on', () => {
    expect(keyAction('A')).toBe('turnLeft');
    expect(keyAction('D')).toBe('turnRight');
    expect(keyAction('W')).toBe('forward');
  });

  it('leaves every other key alone', () => {
    expect(keyAction('q')).toBeNull();
    expect(keyAction('ArrowLeft')).toBeNull();
    expect(keyAction(' ')).toBeNull();
    expect(keyAction('Enter')).toBeNull();
  });
});
