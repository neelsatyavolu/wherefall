import './tutorial.css';
import type { Location } from '../game/locations.ts';
import { WORLD_SCALE_KM } from '../game/scoring.ts';
import type { Mode } from '../game/settings.ts';
import { LANDMARKS, advance, factKey, firstStep, waysOn, type CoachEvent, type CoachStep, type Landmark, type WayOn } from '../game/tutorial.ts';
import type { GamePlaces } from '../imagery/game-places.ts';
import { t } from '../i18n/index.ts';
import type { ImageryProvider } from '../imagery/provider.ts';
import { el } from './dom.ts';
import { navName } from './nav.ts';
import { panelActions } from './panels.ts';

/**
 * The tutorial: two rounds on places anyone would know, with a coach that says what to do next and
 * a line of fact about each place with its result. The two imagery sources share no pictures, so
 * each has its own two: the same landmarks, found by coordinate on Google and by picture on Panoramax.
 */
const AT: Record<Landmark, Omit<Location, 'id'>> = {
  eiffel: { lng: 2.2936527, lat: 48.8594839, country: 'FR' },
  colosseum: { lng: 12.491903, lat: 41.890942, country: 'IT' },
};

const IDS: Record<ImageryProvider['name'], Record<Landmark, string>> = {
  // ids that are not Google's own, so each is looked up by its coordinates
  google: { eiffel: 'tutorial-eiffel-tower', colosseum: 'tutorial-colosseum' },
  panoramax: { eiffel: '1d54c183-312a-42e4-bc9d-5c8d13354494', colosseum: '20aae997-0c7b-4877-87cb-a42e155f2fb8' },
};

/** The tutorial is always the same game: the world map, walking allowed, no clock, two rounds. */
export const TUTORIAL_ROUNDS = LANDMARKS.length;

/** The tutorial's two places on one source. Rejects when the source cannot show both, so the next is tried. */
export async function tutorialPlaces(provider: ImageryProvider): Promise<GamePlaces> {
  const places = LANDMARKS.map((landmark): Location => ({ id: IDS[provider.name][landmark], ...AT[landmark] }));
  const rounds = await Promise.all(places.map(async (location) => ({ location, pano: await provider.resolve(location) })));
  return { rounds, scaleKm: WORLD_SCALE_KM, locations: [], takeSpare: async () => null };
}

/** One sentence about the place of a round, for its result. Nothing for a round the tutorial does not have. */
export function tutorialFact(round: number): string | undefined {
  const key = factKey(round);
  return key ? t(key) : undefined;
}

/** What the tutorial's last screen needs to know: who is looking, and how to leave for each way on. */
export interface TutorialEnd {
  /** true for a player who has an account, who is not offered Sign up */
  signedIn: Promise<boolean>;
  onGo: (to: WayOn) => void;
}

/** What each way on is called: the pane it opens, and for the account pane what a visitor does there. */
const wayName = (to: WayOn): string => (to === 'account' ? t('guest.signUp') : navName(to));

/**
 * The foot of the tutorial's summary, in place of Play again: the ways into the game. Singleplayer
 * is the one to take; the daily challenge and, for a visitor, signing up are beside it. Who is
 * looking was asked as the tutorial began, so it is known by now; until it is, Sign up is not there.
 */
export function tutorialWays(end: TutorialEnd): HTMLElement {
  const foot = panelActions();
  foot.classList.add('tutorial-ways');
  const draw = (signedIn: boolean) =>
    foot.replaceChildren(
      ...waysOn(signedIn).map((to, index) =>
        el('button', { class: index === 0 ? 'button accent' : 'button ghost', text: wayName(to), attrs: { type: 'button', 'data-way': to }, on: { click: () => end.onGo(to) } }),
      ),
    );
  draw(true);
  void end.signedIn.then((signedIn) => {
    if (!signedIn) {
      draw(false);
    }
  });
  return foot;
}

export interface Coach {
  node: HTMLElement;
  /** Tells the coach what the player just did, so it can move on to the next thing. */
  event: (event: CoachEvent) => void;
}

/**
 * The coach: one short tip at a time in a strip under the HUD, where it covers none of the controls
 * it talks about. It can be closed for good at any point.
 */
export function createCoach(mode: Mode): Coach {
  const text = el('p', { class: 'coach-text', attrs: { role: 'status' } });
  const close = el('button', { class: 'button ghost', text: t('tutorial.hide'), attrs: { type: 'button' } });
  const node = el('aside', { class: 'coach', attrs: { 'aria-label': t('tutorial.label') } }, text, close);
  let step: CoachStep | null = firstStep(mode);

  const draw = () => {
    node.hidden = step === null;
    text.textContent = step === null ? '' : t(`tutorial.tip.${step}`);
  };
  close.addEventListener('click', () => {
    step = null;
    draw();
  });
  draw();
  return {
    node,
    event: (event) => {
      step = advance(step, event, mode);
      draw();
    },
  };
}
