import { t } from '../i18n/index.ts';
import { el } from './dom.ts';
import { hrefFor } from './nav.ts';
import { accountOnly, statusLine, type Pane } from './pane.ts';
import { appLink } from './profile-link.ts';
import type { Snap } from './providers.ts';
import { errorBox } from './status-box.ts';

interface EditorHandlers {
  onNavigate: (href: string, state?: unknown) => void;
  /** loads the lookup that finds the Street View nearest a click; null when this site has no Google imagery */
  snapper: (() => Promise<Snap>) | null;
}

function needsGoogle(): HTMLElement {
  return el(
    'div',
    { class: 'notice' },
    el('p', {
      class: 'prose',
      text: t('editor.needsGoogle'),
    }),
    appLink(t('editor.backToMaps'), hrefFor('maps'), 'button ghost'),
  );
}

/**
 * The map editor: a new map, or one of the player's own (`slug`). It needs an account and Google
 * imagery. The editor itself, with its map, is large and loads only when both are there.
 */
export function mapEditorPane(slug: string | null, handlers: EditorHandlers): Pane {
  return accountOnly(
    {
      title: slug === null ? t('common.makeMap') : t('common.editMap'),
      lede: t('editor.lede'),
      what: t('editor.what'),
    },
    () => {
      const host = el('div', { class: 'pane-stack' });
      let inner: Pane | null = null;
      let disposed = false;

      async function open(snapper: () => Promise<Snap>): Promise<void> {
        host.replaceChildren(statusLine(t('editor.loading')));
        try {
          const { mapEditor } = await import('./map-editor.ts');
          if (disposed) {
            return;
          }
          inner = mapEditor(slug, snapper, handlers.onNavigate);
          host.replaceChildren(inner.node);
        } catch {
          host.replaceChildren(errorBox(t('editor.loadFailed'), () => void open(snapper)));
        }
      }

      if (handlers.snapper) {
        void open(handlers.snapper);
      } else {
        host.replaceChildren(needsGoogle());
      }
      return {
        node: host,
        dispose: () => {
          disposed = true;
          inner?.dispose?.();
        },
      };
    },
  );
}
