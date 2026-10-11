import './team.css';
import type { LngLat } from '../game/geo.ts';
import { PIN_INTERVAL_MS, type MatchState } from '../multiplayer/client.ts';
import { throttleLatest } from '../multiplayer/pin-throttle.ts';
import type { GuessMap, MatePin } from './guess-map.ts';

/**
 * Teammates see each other's pin while a round is played. This sends the player's own pin as they
 * move it, at most once a second, and draws the pins the server hands back (`mates`) on the pin
 * map, each by its owner's name. In a match without teams it does nothing at all.
 */

/** True while the viewer has teammates to show a pin to: on a team, in a round being played, their own guess not yet in. */
function sharesPin(state: MatchState): boolean {
  const you = state.players.find((player) => player.username === state.you.username);
  return state.teams !== null && state.you.team !== null && state.phase === 'playing' && you?.guessed !== true;
}

const toPins = (state: MatchState): MatePin[] =>
  state.phase === 'playing' ? state.mates.map((mate) => ({ point: { lng: mate.lng, lat: mate.lat }, label: mate.username, final: mate.guessed })) : [];

/** `send` posts the pin for a round; what comes of it is its own business. */
export function matePins(map: Pick<GuessMap, 'showMates'>, send: (round: number, pin: LngLat) => void) {
  const throttle = throttleLatest<{ round: number; pin: LngLat }>(({ round, pin }) => send(round, pin), PIN_INTERVAL_MS);
  let drawn = '[]';

  return {
    /** The player placed or moved their pin. */
    moved(state: MatchState, pin: LngLat): void {
      if (sharesPin(state)) {
        throttle.push({ round: state.round, pin });
      }
    },

    /** Follows the match: draws the teammates' pins as they are now, and stops sending once there is nobody to send to. */
    update(state: MatchState): void {
      if (!sharesPin(state)) {
        // the guess itself is what teammates see from here on: a pin still waiting to go would only arrive late
        throttle.cancel();
      }
      const pins = toPins(state);
      const key = JSON.stringify(pins);
      if (key !== drawn) {
        drawn = key;
        map.showMates(pins);
      }
    },

    stop(): void {
      throttle.cancel();
    },
  };
}
