// prettier-ignore
export const EMOTES = ['gg', 'gl', 'hi', 'bye', 'nice', 'wow', 'oof', 'close', 'hm', 'lol', 'ty', 'sorry', 'rip', 'yes', 'no', 'think', 'clap', 'fire', 'sad', 'heart'] as const;
export type Emote = (typeof EMOTES)[number];

export const MAX_CHAT_LENGTH = 200;
/** How many of a match's latest chat entries are kept, and sent with its state. */
export const CHAT_KEPT = 30;
/** A player may send one chat line or reaction in this long. */
export const CHAT_INTERVAL_MS = 1000;

/** One line of a match's chat, as stored with the match. */
export interface ChatEntry {
  /** Counts up from 1 within the match. */
  id: number;
  userId: string;
  /** The name the player had when they sent it. */
  username: string;
  text: string | null;
  emote: Emote | null;
  /** ISO 8601. */
  at: string;
  /** Who it is for: everyone, or only the sender's team. Entries stored before there were scopes have none, and are for everyone. */
  scope?: 'all' | 'team';
  /** The sender's team, when it is for their team only. */
  team?: 0 | 1 | null;
}

// Short on purpose: the words nobody needs in a geography game, not a moderation system.
const MASKED_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'retard'];

// From the start of a word to its end, so "fucking" goes too while "Scunthorpe" stays.
const MASKED = new RegExp(`\\b(?:${MASKED_WORDS.join('|')})\\w*`, 'gi');

/** The text with each listed word replaced by asterisks of the same length. */
export const maskWords = (text: string): string => text.replace(MASKED, (word) => '*'.repeat(word.length));

/** The text on one line: line breaks and runs of spaces become single spaces. */
export const onOneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The chat with one more entry at its end, numbered after the last, cut down to the latest few. */
export function withEntry(chat: readonly ChatEntry[], entry: Omit<ChatEntry, 'id'>): ChatEntry[] {
  return [...chat, { ...entry, id: (chat.at(-1)?.id ?? 0) + 1 }].slice(-CHAT_KEPT);
}

/** True when the player's last entry was sent too recently for them to send another. */
export function isTooSoon(chat: readonly ChatEntry[], userId: string, now: number): boolean {
  const last = [...chat].reverse().find((entry) => entry.userId === userId);
  return last !== undefined && now - Date.parse(last.at) < CHAT_INTERVAL_MS;
}
