import { describe, expect, it } from 'vitest';
import { CHAT_INTERVAL_MS, CHAT_KEPT, isTooSoon, maskWords, onOneLine, withEntry, type ChatEntry } from './chat.js';

const T = 1_800_000_000_000;
const line = (userId: string, at: number, text = 'hello'): Omit<ChatEntry, 'id'> => ({ userId, username: userId, text, emote: null, at: new Date(at).toISOString() });

describe('maskWords', () => {
  it('replaces a listed word with asterisks of the same length, whatever its case', () => {
    expect(maskWords('well shit')).toBe('well ****');
    expect(maskWords('FUCK that was close')).toBe('**** that was close');
  });

  it('masks the whole word when a listed word starts it', () => {
    expect(maskWords('fucking brilliant guess')).toBe('******* brilliant guess');
  });

  it('leaves alone a word that only contains one', () => {
    expect(maskWords('Scunthorpe, Essex and Middlesex')).toBe('Scunthorpe, Essex and Middlesex');
  });

  it('leaves ordinary chat as it was', () => {
    expect(maskWords('Is that Dijon? gg wp!')).toBe('Is that Dijon? gg wp!');
    expect(maskWords('')).toBe('');
  });

  it('masks every listed word in a line', () => {
    expect(maskWords('shit, shit, SHIT')).toBe('****, ****, ****');
  });
});

describe('onOneLine', () => {
  it('turns line breaks, tabs and runs of spaces into single spaces, and trims the ends', () => {
    expect(onOneLine('  one\n\ntwo\t three   four ')).toBe('one two three four');
    expect(onOneLine(' \n ')).toBe('');
  });
});

describe('withEntry', () => {
  it('numbers entries from 1, each one after the last', () => {
    const first = withEntry([], line('a', T));
    const second = withEntry(first, line('b', T + 1));
    expect(first.map((entry) => entry.id)).toEqual([1]);
    expect(second.map((entry) => entry.id)).toEqual([1, 2]);
    expect(second[1]).toEqual({ id: 2, userId: 'b', username: 'b', text: 'hello', emote: null, at: new Date(T + 1).toISOString() });
  });

  it('keeps the latest 30, and keeps counting where it was', () => {
    let chat: ChatEntry[] = [];
    for (let index = 0; index < CHAT_KEPT + 5; index += 1) {
      chat = withEntry(chat, line('a', T + index));
    }
    expect(chat).toHaveLength(30);
    expect(chat[0]?.id).toBe(6);
    expect(chat.at(-1)?.id).toBe(35);
  });

  it('does not change the list it was given', () => {
    const chat: ChatEntry[] = [];
    withEntry(chat, line('a', T));
    expect(chat).toEqual([]);
  });
});

describe('isTooSoon', () => {
  it('holds a player to one entry a second, counting from their own last one', () => {
    const chat = withEntry(withEntry([], line('a', T)), line('b', T + 900));
    expect(isTooSoon(chat, 'a', T + CHAT_INTERVAL_MS - 1)).toBe(true);
    expect(isTooSoon(chat, 'a', T + CHAT_INTERVAL_MS)).toBe(false);
    expect(isTooSoon(chat, 'b', T + CHAT_INTERVAL_MS)).toBe(true);
  });

  it('never holds back a player who has not said anything', () => {
    expect(isTooSoon(withEntry([], line('a', T)), 'c', T)).toBe(false);
    expect(isTooSoon([], 'a', T)).toBe(false);
  });
});
