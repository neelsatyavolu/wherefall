import { t } from '../i18n/index.ts';
import { getProfile, type Profile } from '../social/client.ts';
import { el } from './dom.ts';
import { flag } from './flag.ts';
import { backButton, statusLine, type Pane } from './pane.ts';
import { profileStats, profileTeams, profileWho } from './profile-parts.ts';
import { progressSection } from './profile-progress.ts';
import { reportForm } from './profile-report.ts';
import { gamesTable, levelBar, wide } from './stat-grid.ts';
import { errorBox } from './status-box.ts';

function profileBody(profile: Profile, progress: HTMLElement): HTMLElement[] {
  return [
    profileWho(profile),
    // the figures and the charts take the wide measure; the rest is narrow
    wide(levelBar(profile.xp, profile.level)),
    wide(profileStats(profile)),
    // the 2v2 matches beside the duels, which close the figures above
    wide(profileTeams(profile)),
    wide(progress),
    // the table keeps the measure of the figures and charts above it, so the page has one right edge
    wide(
      el(
        'section',
        { class: 'account-section' },
        el('h3', { class: 'label', text: t('label.recentGames') }),
        profile.recentGames.length > 0 ? gamesTable(profile.recentGames) : el('p', { class: 'prose', text: t('profile.noGames') }),
      ),
    ),
  ];
}

/** A player's public profile, read-only. Reached from a username in a leaderboard, a lobby or a standing. */
export function profilePane(username: string): Pane {
  const title = el('h2', { class: 'pane-title', text: username });
  const body = el('div', { class: 'pane-stack' });
  let progress: Pane | null = null;
  let disposed = false;

  async function load(): Promise<void> {
    body.replaceChildren(statusLine(t('profile.loading')));
    const result = await getProfile(username);
    if (disposed) {
      return;
    }
    if (!result.ok) {
      body.replaceChildren(errorBox(result.error, () => void load()));
      return;
    }
    const profile = result.data;
    title.replaceChildren(...[flag(profile.country), profile.username].filter((part) => part !== null));
    // another range is the same profile asked for again, of which only the history is drawn
    progress = progressSection(
      profile.history,
      async (range) => {
        const again = await getProfile(username, range);
        return again.ok ? { ok: true, data: again.data.history } : again;
      },
      // the place the figures above show, which the rating-rank chart is held against
      { ratingRank: profile.duels.rank },
    );
    body.replaceChildren(...profileBody(profile, progress.node));
    // a signed-in player can report anyone but themselves; a visitor and a guest are told no standing, and cannot
    if (profile.friend !== null && profile.friend !== 'self') {
      body.append(reportForm(profile.username));
    }
  }

  void load();

  return {
    node: el('section', { class: 'pane-section' }, el('header', { class: 'pane-head with-action wide' }, title, backButton()), body),
    dispose: () => {
      disposed = true;
      progress?.dispose?.();
    },
  };
}
