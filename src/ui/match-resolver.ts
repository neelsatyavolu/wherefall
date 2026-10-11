import { t } from '../i18n/index.ts';
import type { GamePlaces } from '../imagery/game-places.ts';
import type { Place as Picture } from '../imagery/provider.ts';
import { postPlaces, type MatchState } from '../multiplayer/client.ts';
import { afterFailedPost, drawSeed } from '../multiplayer/draw.ts';
import { toPlaces } from '../multiplayer/state.ts';
import type { matchPlaces } from './match-places.ts';
import { communityUnavailable } from './panels.ts';

export interface ResolverDeps {
  places: ReturnType<typeof matchPlaces>;
  /** the match as it stands: its id, and the seed its places are drawn from */
  match: () => Pick<MatchState, 'id' | 'seed'>;
  /** false once the screen is gone or the match is over: nothing more is sent or shown */
  alive: () => boolean;
  status: (text: string) => void;
  /** hands the server's reply to a post that was taken back to whoever follows the match */
  report: (state: MatchState) => void;
  /** Puts a failure on the screen with one thing to do about it, beside the way home. `run` is called with the failure cleared away. */
  fail: (message: string, retry: { name: string; run: () => void }) => void;
}

/**
 * The part of the one client that picks a match's places: draw them as a game alone does, from the
 * match's seed, and post them. A set the server will not take is never sent again: a fresh one is
 * drawn at once, and if that is refused too the player is told and chooses between another draw
 * and the way home. Any other failure keeps the places, to be sent again.
 */
export function placeResolver(deps: ResolverDeps) {
  /** the rounds drawn, kept so a post that failed on its way can be sent again without resolving twice */
  let resolved: GamePlaces | null = null;
  /** how many sets the server has refused: each gives the next draw a seed of its own */
  let refused = 0;
  let busy = false;

  const again = () => ({ name: t('common.tryAgain'), run: () => void run() });

  /** After a post the server answered with a failure: the places are kept, or thrown away for a fresh draw. */
  function failed(error: string): void {
    const next = afterFailedPost(error, refused);
    if (next === 'resend') {
      deps.fail(error, again());
      return;
    }
    refused += 1;
    resolved = null;
    if (next === 'redraw') {
      void run();
    } else {
      deps.fail(t('match.placesRefused', { error }), { name: t('match.drawAgain'), run: () => void run() });
    }
  }

  async function run(): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    deps.status(t('common.findingPlaces'));
    const { id, seed } = deps.match();
    resolved ??= await deps.places.pick(drawSeed(seed, refused));
    const reply = resolved && deps.alive() ? await postPlaces(id, toPlaces(resolved.rounds)) : null;
    busy = false;
    if (!deps.alive()) {
      return;
    }
    if (!resolved || !reply) {
      deps.fail(deps.places.slug === null ? t('match.placesFailed') : communityUnavailable(), again());
    } else if (reply.ok) {
      deps.report(reply.data);
    } else {
      failed(reply.error);
    }
  }

  return {
    /** Draws the places, unless they are drawn already, and posts them. Does nothing while it is at it. */
    run,
    get busy(): boolean {
      return busy;
    },
    /** true for the client that drew the places itself: it has every round's picture, whatever the server sends */
    get drew(): boolean {
      return resolved !== null;
    },
    /** one picture per round, once the places are drawn */
    pictures: (): ReadonlyArray<Picture> | null => resolved?.rounds.map((round) => round.pano) ?? null,
  };
}
