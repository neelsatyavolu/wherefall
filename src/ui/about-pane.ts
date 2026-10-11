import './solo.css';
import { t, type Key } from '../i18n/index.ts';
import { el, withNodes } from './dom.ts';
import { pane, type Pane } from './pane.ts';

const WHAT: readonly Key[] = ['about.what.1', 'about.what.2'];
const SCORING: readonly Key[] = ['about.scoring.1', 'about.scoring.2', 'about.scoring.3'];
const QUESTIONS = ['account', 'link', 'imagery', 'repeats', 'phone'] as const;
/** the updates so far, newest first */
const UPDATES = [5, 4, 3, 2, 1] as const;

const outside = (text: string, href: string) => el('a', { text, attrs: { href, target: '_blank', rel: 'noopener' } });

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  return el('section', { class: 'about-section' }, el('h3', { class: 'label', text: title }), ...children);
}

const prose = (key: Key) => el('p', { class: 'prose', text: t(key) });

function questions(): HTMLElement {
  return el(
    'div',
    { class: 'about-answers' },
    ...QUESTIONS.map((name) =>
      el('div', { class: 'about-answer' }, el('h4', { class: 'about-question', text: t(`about.faq.${name}.q`) }), prose(`about.faq.${name}.a`)),
    ),
  );
}

/** Who the street pictures and the maps come from. The line for the satellite and terrain tiles waits for its sources. */
function credits(): HTMLElement {
  const line = (key: Key, links: Record<string, Node> = {}) => el('li', {}, el('p', { class: 'prose' }, ...withNodes(t(key), links)));
  return el(
    'ul',
    { class: 'about-list' },
    line('about.credits.google'),
    line('about.credits.panoramax', { panoramax: outside('Panoramax', 'https://panoramax.fr') }),
    line('about.credits.maps', { openfreemap: outside('OpenFreeMap', 'https://openfreemap.org') }),
    line('about.credits.tiles'),
  );
}

function changes(): HTMLElement {
  return el(
    'dl',
    { class: 'about-changes' },
    ...UPDATES.map((number) =>
      el('div', { class: 'about-change' }, el('dt', { text: t('about.changes.version', { number }) }), el('dd', { class: 'prose', text: t(`about.changes.${number}`) })),
    ),
  );
}

/** About Wherefall: what it is, how a round is scored, a few questions, who to credit, and what each update brought. */
export function aboutPane(): Pane {
  return {
    node: pane(
      t('nav.item.about'),
      t('about.lede'),
      el(
        'div',
        { class: 'about' },
        section(t('about.what.title'), ...WHAT.map(prose)),
        section(t('about.scoring.title'), ...SCORING.map(prose)),
        section(t('about.faq.title'), questions()),
        section(t('about.credits.title'), credits()),
        section(t('about.changes.title'), changes()),
      ),
    ),
  };
}
