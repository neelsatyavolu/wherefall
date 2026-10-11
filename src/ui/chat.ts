import './chat.css';
import { t, tn } from '../i18n/index.ts';
import { CHAT_SCOPES, EMOTES, MAX_CHAT_LENGTH, type ChatEntry, type ChatScope, type Emote } from '../multiplayer/client.ts';
import type { ChatPlayer, ChatView } from '../multiplayer/match-view.ts';
import { chatLine, unreadCount } from '../multiplayer/state.ts';
import { el } from './dom.ts';
import { plainName, signUpLink } from './guest-parts.ts';
import { sounds } from './sound.ts';

const TOAST_MS = 4000;

export interface ChatHandlers {
  /** resolves to an error to show, or null when the message went. `team` sends it to the player's own team alone */
  onSend: (text: string, scope: ChatScope) => Promise<string | null>;
  onEmote: (emote: Emote) => Promise<string | null>;
  /** leaves a player's lines out of this chat for the rest of the match (`muted`), or lets them back in */
  onMute: (username: string, muted: boolean) => Promise<string | null>;
}

export interface Chat {
  node: HTMLElement;
  /** Redraws from the match's chat: its lines, what the player may send, and who is muted. A mode of `off` hides it. */
  update: (view: ChatView) => void;
}

function line(entry: ChatEntry, own: boolean, country: string | null): HTMLElement {
  return el(
    'li',
    { class: entry.emote === null ? 'chat-line' : 'chat-line reaction' },
    own ? el('span', { class: 'chat-name', text: t('tag.you') }) : plainName(entry.username, country, 'chat-name'),
    // a line only the sender's team was sent says so
    el('span', { class: 'chat-text' }, entry.scope === 'team' ? el('span', { class: 'tag chat-team', text: t('chat.teamTag') }) : null, chatLine(entry)),
  );
}

/** Where the next message goes, in a match with teams: to everyone, or to the player's own team alone. */
function scopeSwitch() {
  let scope: ChatScope = 'all';
  const cells = CHAT_SCOPES.map((value) => {
    // a lobby's chat and a match's are never on one page, so the one name is never shared
    const input = el('input', { attrs: { type: 'radio', name: 'chat-scope', value } });
    input.checked = value === scope;
    input.addEventListener('change', () => {
      scope = value;
    });
    return el('label', { class: 'choice' }, input, el('span', { text: t(`chat.scope.${value}`) }));
  });
  const node = el('fieldset', { class: 'choice-row chat-scope' }, el('legend', { class: 'label', text: t('chat.scope') }), el('div', { class: 'choices' }, ...cells));
  return {
    node,
    /** What a message sent now is sent with. Everyone, wherever the switch is not offered. */
    get value(): ChatScope {
      return node.hidden ? 'all' : scope;
    },
  };
}

/** Every other player, each with a switch that mutes them. Folded away until asked for. */
function muteList(onMute: ChatHandlers['onMute'], report: (sending: Promise<string | null>) => Promise<void>) {
  const list = el('ul', { class: 'mute-list' });
  const node = el('details', { class: 'chat-mutes' }, el('summary', { text: t('chat.mute.title') }), el('p', { class: 'fine', text: t('chat.mute.note') }), list);
  let drawn = '';

  const row = (player: ChatPlayer) => {
    const name = t(player.muted ? 'chat.mute.undoLabel' : 'chat.mute.label', { name: player.username });
    const button = el('button', { class: 'link-button', text: t(player.muted ? 'chat.mute.undo' : 'chat.mute.button'), attrs: { type: 'button', 'aria-label': name } });
    button.addEventListener('click', async () => {
      button.disabled = true;
      // the reply is the match with the switch thrown, which redraws this list
      await report(onMute(player.username, !player.muted));
      button.disabled = false;
    });
    return el(
      'li',
      { class: 'mute-row' },
      plainName(player.username, player.country, 'mute-name'),
      player.muted ? el('span', { class: 'tag', text: t('chat.mute.tag') }) : null,
      button,
    );
  };

  return {
    node,
    draw(others: readonly ChatPlayer[]): void {
      node.hidden = others.length === 0;
      const key = JSON.stringify(others);
      if (key !== drawn) {
        drawn = key;
        list.replaceChildren(...others.map(row));
      }
    },
  };
}

/** The message list, the reactions, the message field and the mutes. Used open in the lobby and behind a button in a match. */
function chatBody(handlers: ChatHandlers) {
  const list = el('ul', { class: 'chat-list', attrs: { 'aria-label': t('chat.messages'), 'aria-live': 'polite' } });
  const empty = el('p', { class: 'fine', text: t('chat.empty') });
  const error = el('p', { class: 'account-error', attrs: { role: 'alert' } });
  const input = el('input', {
    class: 'account-input chat-input',
    attrs: { type: 'text', name: 'message', maxlength: String(MAX_CHAT_LENGTH), autocomplete: 'off', 'aria-label': t('chat.message'), placeholder: t('chat.placeholder') },
  });

  const report = async (sending: Promise<string | null>) => {
    error.textContent = (await sending) ?? '';
  };
  const scope = scopeSwitch();
  /**
   * Sends what is in the box. A line the server did not take (too many at once, no connection) is
   * put back in the box under the server's own message, so it can be sent again as it is, unless
   * the player has begun another line meanwhile.
   */
  const send = async (): Promise<void> => {
    const text = input.value.trim();
    if (text === '') {
      return;
    }
    input.value = '';
    const refused = await handlers.onSend(text, scope.value);
    error.textContent = refused ?? '';
    if (refused !== null && input.value === '') {
      input.value = text;
    }
  };
  const form = el(
    'form',
    {
      class: 'chat-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          void send();
        },
      },
    },
    input,
    el('button', { class: 'button ghost', text: t('chat.send'), attrs: { type: 'submit' } }),
  );
  const reactions = el(
    'div',
    { class: 'chat-reactions', attrs: { role: 'group', 'aria-label': t('chat.reactions') } },
    ...EMOTES.map((emote) => el('button', { class: 'chat-reaction', text: emote, attrs: { type: 'button' }, on: { click: () => void report(handlers.onEmote(emote)) } })),
  );
  // a guest has the reactions where accounts can write: this says what signing up adds, in place of a field that would be refused
  const guestNote = el('p', { class: 'fine chat-guest' }, t('guest.chatNote'), ' ', signUpLink('guest-link', true));
  const mutes = muteList(handlers.onMute, report);

  let newest = -1;
  let drawn = '';
  return {
    node: el('div', { class: 'chat-body' }, empty, list, reactions, scope.node, form, guestNote, error, mutes.node),
    draw(view: ChatView): void {
      // free chat only where the match has it: elsewhere the message field is not offered at all
      form.hidden = view.mode !== 'chat';
      scope.node.hidden = !view.teamScope;
      reactions.hidden = view.mode === 'off';
      guestNote.hidden = !view.guestNote;
      mutes.draw(view.others);
      empty.hidden = view.entries.length > 0;
      const last = view.entries.at(-1);
      // something new from someone else is heard as well as seen; the first drawing is only catching up
      if (newest !== -1 && last && last.id > newest && last.username !== view.you) {
        sounds.play('chat');
      }
      newest = Math.max(newest, last?.id ?? 0);
      // muting a player takes their lines away, so the list is redrawn whenever its lines differ, not only when one is added
      const key = view.entries.map((entry) => entry.id).join(',');
      if (key === drawn) {
        return;
      }
      drawn = key;
      const countries = new Map(view.others.map((player) => [player.username, player.country]));
      list.replaceChildren(...view.entries.map((entry) => line(entry, entry.username === view.you, countries.get(entry.username) ?? null)));
      list.scrollTop = list.scrollHeight;
    },
  };
}

/** Chat laid open on a page, as in the lobby. */
export function openChat(handlers: ChatHandlers): Chat {
  const body = chatBody(handlers);
  const node = el('section', { class: 'chat open', attrs: { 'aria-label': t('label.chat') } }, body.node);
  return {
    node,
    update: (view) => {
      body.draw(view);
      node.hidden = view.mode === 'off';
    },
  };
}

/**
 * Chat behind a button, as over the round screen: closed it shows how many lines are unread and,
 * for a few seconds, the newest thing another player wrote. `onOpen` is told when it opens, and
 * `close` shuts it: on a phone a match has room for one open panel in its corner.
 */
export function foldedChat(handlers: ChatHandlers, onOpen: () => void = () => {}): Chat & { close: () => void } {
  const body = chatBody(handlers);
  const toggle = el('button', { class: 'button ghost chat-toggle', text: t('label.chat'), attrs: { type: 'button', 'aria-expanded': 'false' } });
  const toast = el('p', { class: 'chat-toast', attrs: { role: 'status' } });
  const panel = el('div', { class: 'chat-panel' }, body.node);
  panel.hidden = true;
  let seen = 0;
  let newest = 0;
  let unread = 0;
  let toastTimer: number | undefined;

  const label = () => {
    toggle.textContent = panel.hidden && unread > 0 ? [t('label.chat'), tn('chat.unread', unread)].join(' · ') : panel.hidden ? t('label.chat') : t('chat.close');
  };
  const open = (shown: boolean) => {
    panel.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(shown));
    seen = newest;
    unread = 0;
    toast.textContent = '';
    label();
  };
  toggle.addEventListener('click', () => {
    open(Boolean(panel.hidden));
    if (!panel.hidden) {
      onOpen();
    }
  });

  const node = el('aside', { class: 'chat folded', attrs: { 'aria-label': t('label.chat') } }, toggle, toast, panel);

  return {
    node,
    close: () => {
      if (!panel.hidden) {
        open(false);
      }
    },
    update(view) {
      body.draw(view);
      node.hidden = view.mode === 'off';
      const latest = view.entries.at(-1);
      // a line is new when it is later than any seen so far: muting and unmuting only take lines away and put old ones back
      const added = latest !== undefined && latest.id > newest;
      newest = Math.max(newest, latest?.id ?? 0);
      if (!panel.hidden) {
        seen = newest;
        return;
      }
      const count = unreadCount(view.entries, seen, view.you);
      if (count !== unread) {
        unread = count;
        label();
      }
      // a reaction floats over the round screen by itself (`match-reactions.ts`): the toast is for what was written
      if (added && latest.username !== view.you && latest.emote === null) {
        clearTimeout(toastTimer);
        toast.textContent = `${latest.username}: ${chatLine(latest)}`;
        toastTimer = window.setTimeout(() => (toast.textContent = ''), TOAST_MS);
      }
    },
  };
}
