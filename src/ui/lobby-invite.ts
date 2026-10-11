import { t } from '../i18n/index.ts';
import { getFriends, inviteFriend, type Friends } from '../social/client.ts';
import { el } from './dom.ts';
import { playerName } from './profile-link.ts';
import { sayRefusal } from './session-ended.ts';

/** How a party's lobby brings players in: its code and join link, and the host's friends to invite. */

const COPIED_NOTICE_MS = 2000;

/** The link that opens Join party with this party's code filled in. */
export const joinLink = (code: string) => `${location.origin}${location.pathname}?party=${encodeURIComponent(code)}`;

function copyButton(link: string, field: HTMLInputElement): HTMLButtonElement {
  const button = el('button', { class: 'button ghost', text: t('lobby.copyLink'), attrs: { type: 'button' } });
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      button.textContent = t('common.linkCopied');
    } catch {
      // clipboard blocked (permissions, insecure origin): select the link so it can be copied by hand
      field.select();
      return;
    }
    setTimeout(() => {
      button.textContent = t('lobby.copyLink');
    }, COPIED_NOTICE_MS);
  });
  return button;
}

/** The party's code, large, and its join link with a button that copies it. */
export function invite(code: string): HTMLElement {
  const link = joinLink(code);
  const field = el('input', { class: 'link-field', attrs: { readonly: '', value: link, 'aria-label': t('lobby.joinLink') } });
  return el(
    'section',
    { class: 'lobby-invite' },
    el('div', { class: 'figure' }, el('span', { class: 'label', text: t('common.partyCode') }), el('span', { class: 'figure-value lobby-code', text: code })),
    el('div', { class: 'lobby-link' }, field, copyButton(link, field)),
  );
}

/** Friends who are not in the party yet, each with a button that sends them the code. */
export function inviteList(code: string, present: () => readonly string[]): HTMLElement {
  const list = el('ul', { class: 'player-list' });
  const note = el('p', { class: 'fine', text: t('common.loadingFriends') });
  const section = el('section', { class: 'account-section' }, el('h2', { class: 'label', text: t('lobby.invite.title') }), list, note);

  const draw = (friends: Friends) => {
    const absent = friends.friends.filter((friend) => !present().includes(friend.username));
    note.textContent = friends.friends.length === 0 ? t('lobby.invite.none') : absent.length === 0 ? t('lobby.invite.allHere') : '';
    list.replaceChildren(
      ...absent.map((friend) => {
        const button = el('button', { class: 'button ghost', text: t('lobby.invite.button'), attrs: { type: 'button', 'aria-label': t('lobby.invite.label', { name: friend.username }) } });
        button.addEventListener('click', async () => {
          button.disabled = true;
          const sent = await inviteFriend(friend.username, code);
          button.textContent = sent.ok ? t('lobby.invite.sent') : t('lobby.invite.button');
          button.disabled = sent.ok;
          sayRefusal(note, sent.ok ? '' : sent.error);
        });
        return el('li', { class: 'player-row' }, el('span', { class: 'player-name' }, playerName(friend.username, { country: friend.country, newTab: true })), el('span', { class: 'tag', text: t('friends.level', { level: friend.level }) }), el('div', { class: 'row-actions' }, button));
      }),
    );
  };

  void getFriends().then((friends) => {
    if (friends.ok) {
      draw(friends.data);
    } else {
      note.textContent = t('lobby.invite.failed');
    }
  });
  return section;
}
