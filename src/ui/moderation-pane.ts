import { getAccount } from '../account/client.ts';
import { t, tn } from '../i18n/index.ts';
import { getModeration, moderateMap, moderatePlayer, type Moderation } from '../social/client.ts';
import { reportCategoryName } from '../social/report-words.ts';
import { el, withNodes } from './dom.ts';
import { hrefFor, navName } from './nav.ts';
import { errorLine, pane, statusLine, type Pane } from './pane.ts';
import { mapLink, profileLink } from './profile-link.ts';
import { askInRow } from './row-confirm.ts';
import { refusalBox, sayRefusal } from './session-ended.ts';
import { errorBox } from './status-box.ts';

type Decide = (run: () => ReturnType<typeof getModeration>) => Promise<void>;

const button = (text: string, label: string, run: () => void) => el('button', { class: 'button ghost', text, attrs: { type: 'button', 'aria-label': label }, on: { click: run } });

const plural = (count: number) => tn('moderation.reports', count);

/** What was written with the reports of a map, newest first. A report with no reason is left out. */
function reasons(list: readonly string[]): HTMLElement | null {
  const given = list.filter((reason) => reason.trim() !== '');
  return given.length === 0 ? null : el('ul', { class: 'reasons' }, ...given.map((reason) => el('li', { text: reason })));
}

type PlayerReason = Moderation['players'][number]['reasons'][number];

/**
 * What each open report of a player is about, newest first: its category, and the note that came
 * with it. A report with no note still has its category, so none is left out.
 */
function playerReasons(list: readonly PlayerReason[]): HTMLElement | null {
  return list.length === 0
    ? null
    : el('ul', { class: 'reasons' }, ...list.map((reason) => el('li', {}, el('span', { class: 'tag reason-category', text: reportCategoryName(reason.category) }), reason.note.trim() === '' ? null : el('span', { class: 'reason-note', text: reason.note }))));
}

/**
 * Each row's buttons are plain: nothing on this pane is the way on, and a column of filled or red
 * buttons would say otherwise. What cannot be taken back (removing a map) or shuts a player out
 * (a ban) is asked once more in the row, and only that question carries the danger colour.
 */
function mapRows(queue: Moderation, decide: Decide): HTMLElement[] {
  return queue.maps.map((map) => {
    const actions: HTMLElement = el(
      'div',
      { class: 'row-actions' },
      button(t('moderation.removeMap'), t('moderation.removeMapLabel', { name: map.name }), () =>
        askInRow(actions, { question: t('moderation.removeMapConfirm', { name: map.name }), yes: t('moderation.removeMap'), run: () => decide(() => moderateMap(map.slug, 'remove')) }),
      ),
      button(t('moderation.dismiss'), t('moderation.dismissLabel', { name: map.name }), () => void decide(() => moderateMap(map.slug, 'dismiss'))),
    );
    return el(
      'li',
      { class: 'player-row' },
      el('span', { class: 'player-name' }, mapLink(map.slug, map.name)),
      el('span', { class: 'by' }, ...withNodes(t('moderation.by'), { maker: profileLink(map.maker) })),
      el('span', { class: 'tag', text: plural(map.reports) }),
      actions,
      reasons(map.reasons),
    );
  });
}

function playerRows(queue: Moderation, decide: Decide): HTMLElement[] {
  return queue.players.map((player) => {
    const name = player.username;
    const actions: HTMLElement = el(
      'div',
      { class: 'row-actions' },
      player.banned
        ? button(t('moderation.unban'), t('moderation.unbanLabel', { name }), () => void decide(() => moderatePlayer(name, 'unban')))
        : button(t('moderation.ban'), t('moderation.banLabel', { name }), () =>
            askInRow(actions, { question: t('moderation.banConfirm', { name }), yes: t('moderation.ban'), run: () => decide(() => moderatePlayer(name, 'ban')) }),
          ),
      button(t('moderation.dismiss'), t('moderation.dismissLabel', { name }), () => void decide(() => moderatePlayer(name, 'dismiss'))),
    );
    return el(
      'li',
      { class: 'player-row' },
      el('span', { class: 'player-name' }, profileLink(name)),
      el('span', { class: 'tag', text: player.banned ? [t('moderation.banned'), plural(player.reports)].join(' · ') : plural(player.reports) }),
      actions,
      playerReasons(player.reasons),
    );
  });
}

function section(title: string, rows: HTMLElement[], empty: string): HTMLElement {
  return el(
    'section',
    { class: 'account-section', attrs: { 'aria-label': title } },
    el('h3', { class: 'label', text: title }),
    rows.length > 0 ? el('ul', { class: 'player-list' }, ...rows) : el('p', { class: 'prose', text: empty }),
  );
}

function moderationBody(): Pane {
  const body = el('div', { class: 'pane-stack' });
  const error = errorLine();
  let loaded = false;
  let disposed = false;

  const decide: Decide = (run) => show(run);

  /** Runs a request that answers with the queue, and shows it or the reason it was refused. */
  async function show(run: () => ReturnType<typeof getModeration>): Promise<void> {
    error.textContent = '';
    const result = await run();
    if (disposed) {
      return;
    }
    if (result.ok) {
      loaded = true;
      body.replaceChildren(
        section(t('moderation.maps.title'), mapRows(result.data, decide), t('moderation.maps.empty')),
        section(t('moderation.players.title'), playerRows(result.data, decide), t('moderation.players.empty')),
        error,
      );
    } else if (loaded) {
      sayRefusal(error, result.error);
    } else {
      body.replaceChildren(refusalBox(result.error, () => void show(() => getModeration())));
    }
  }

  body.replaceChildren(statusLine(t('moderation.loading')));
  void show(() => getModeration());

  return {
    node: body,
    dispose: () => {
      disposed = true;
    },
  };
}

/**
 * What anyone but a moderator is shown: that the pane is theirs, and the way home. A visitor may be
 * a moderator who has not signed in yet, so is offered that too. It is not the notice the online
 * panes show, which is about what an account adds: an account is not what this pane asks for.
 */
function moderatorsOnly(visitor: boolean): HTMLElement {
  return el(
    'div',
    { class: 'notice' },
    el('p', { class: 'prose', text: t(visitor ? 'moderation.forModerators.visitor' : 'moderation.forModerators') }),
    el(
      'div',
      { class: 'actions' },
      el('a', { class: 'button primary', text: t('common.home'), attrs: { href: hrefFor('singleplayer') } }),
      visitor ? el('a', { class: 'button ghost', text: t('common.signIn'), attrs: { href: hrefFor('account') } }) : null,
    ),
  );
}

/**
 * For moderators: the maps and players that have been reported, with what to do about each. The
 * reports are a moderator's to ask for: a visitor, a guest or any other player who opens the
 * address is told whose pane it is, and the server is not asked for them.
 */
export function moderationPane(): Pane {
  const body = el('div', { class: 'pane-body' });
  let inner: Pane | null = null;
  let disposed = false;

  async function load(): Promise<void> {
    body.replaceChildren(statusLine(t('pane.checkingAccount')));
    const result = await getAccount();
    if (disposed) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load()));
      return;
    }
    const { account } = result.data;
    if (account?.moderator) {
      inner = moderationBody();
      body.replaceChildren(inner.node);
    } else {
      body.replaceChildren(moderatorsOnly(account === null && result.data.guest === null));
    }
  }

  void load();

  return {
    node: pane(navName('moderation'), t('moderation.lede'), body),
    dispose: () => {
      disposed = true;
      inner?.dispose?.();
    },
  };
}
