import './play.css';
import './hud.css';
import './map-panel.css';
import './panel-slot.css';
import type { LngLat } from '../game/geo.ts';
import { t, tn } from '../i18n/index.ts';
import type { ImageryProvider, Place, StreetView, ViewHandlers } from '../imagery/provider.ts';
import { formatScore } from './dom.ts';
import { GuessMap, type FitPadding } from './guess-map.ts';
import type { Padding } from './map-fit.ts';
import { wireMapTools } from './map-tools.ts';
import { listenForKeys, type SteerAction } from './round-keys.ts';
import { changedSides, paddingAround } from './round-layout.ts';
import { buildParts, confirmDialog } from './round-screen-parts.ts';
import { clock, timerState } from './round-timer.ts';
import type { Phase, ScreenConfig, ScreenEvents, StatusState } from './round-types.ts';
import { sounds } from './sound.ts';
import { TURN_DEGREES, hasControls, type ViewControls } from './view-controls.ts';

export { homeBounds } from './round-layout.ts';
export type { Phase, ScreenConfig, ScreenEvents, StatusState } from './round-types.ts';

/**
 * The round screen: street view, guess map, HUD and the panel over them. It draws and reports what
 * the player does; it does not know the rules. A driver tells it what to show: `play.ts` runs a
 * local game on it, `streak-play.ts` a country streak, `match-play.ts` follows a match on the server.
 */

/** the last seconds of a round are counted out loud */
const TICK_SECONDS = 5;
/** how far the view has to turn before it counts as the player looking around */
const LOOK_DEGREES = 20;
const NOTICE_MS = 2000;

export class RoundScreen {
  readonly map: GuessMap;
  private readonly config: ScreenConfig;
  private readonly events: ScreenEvents;
  private readonly parts: ReturnType<typeof buildParts>;
  private readonly mapTools: ReturnType<typeof wireMapTools>;
  private readonly stopKeys: () => void;
  private street: StreetView<Place> | null = null;
  private current: Phase = 'loading';
  private pinned: LngLat | null = null;
  /** set while the driver does not take guesses: the text the Guess button shows instead */
  private lock: string | null = null;
  /** what the Guess button says with a pin placed, when the driver wants more than "Guess" */
  private guessLabel: string | null = null;
  private noticeTimer: number | undefined;
  private asking = false;
  private destroyed = false;
  /** the bearing a place opened on, to tell the player turning the view from the view being set */
  private openedOn: number | null = null;
  private lastTick: number | null = null;
  private hintUsed = false;
  /** how many hints the game has left, or null when the driver does not count them */
  private hintsLeft: number | null = null;
  /** the padding the panel in the slot asked of the map, as it was last measured */
  private panelPadding: Padding | null = null;
  /** a panel that changes its size (a line is added to it, the screen is turned) takes the map's fit with it */
  private readonly panelWatch = new ResizeObserver(() => this.followPanel());

  private readonly viewHandlers: ViewHandlers = {
    onBearing: (bearing) => {
      this.parts.compassNeedle.style.transform = `rotate(${-bearing}deg)`;
      this.parts.compassLetter.style.transform = `rotate(${bearing}deg)`;
      this.openedOn ??= bearing;
      if (Math.abs(((bearing - this.openedOn + 540) % 360) - 180) > LOOK_DEGREES) {
        this.events.onLook?.();
      }
    },
    onAtStart: (atStart) => {
      this.parts.returnButton.disabled = atStart;
      if (!atStart) {
        this.events.onMove?.();
      }
    },
    onNotice: (text) => {
      if (this.current === 'guessing') {
        this.flashStatus(text);
      }
    },
  };

  constructor(root: HTMLElement, config: ScreenConfig, events: ScreenEvents) {
    this.config = config;
    this.events = events;
    this.parts = buildParts(config);
    root.replaceChildren(this.parts.view);
    this.map = new GuessMap(this.parts.mapHost);
    this.map.onPin((point) => {
      this.pinned = point;
      this.syncGuessButton();
      sounds.play('pin');
      this.events.onPin?.(point);
    });
    this.mapTools = wireMapTools(this.parts.mapPanel, this.parts.mapTools, this.map);
    this.wire();
    this.setCount(1);
    this.setHintUsed(false);
    this.stopKeys = listenForKeys({
      playing: () => this.current === 'guessing',
      walk: (direction) => this.street?.moveByKey(direction),
      steer: (action) => this.steer(action),
      escape: () => this.mapTools.leaveFull(),
      confirm: () => this.confirmKey(),
    });
  }

  get phase(): Phase {
    return this.current;
  }

  /** The screen's root element, for a driver that adds its own parts to it. */
  get view(): HTMLElement {
    return this.parts.view;
  }

  /** Where the player's pin is this round, or null before one is placed. */
  get pin(): LngLat | null {
    return this.pinned;
  }

  /** True once a street view is open; false when no imagery source could be used. */
  get hasStreet(): boolean {
    return this.street !== null;
  }

  setPhase(next: Phase): void {
    this.current = next;
    this.parts.view.dataset.phase = next;
  }

  /** The line over the view, behind a dot that says what kind of news it is: something under way (the default), good, or gone wrong. */
  setStatus(text: string, state: StatusState = 'live'): void {
    clearTimeout(this.noticeTimer);
    this.parts.status.textContent = text;
    this.parts.status.dataset.state = state;
  }

  /** A short message over the view that clears itself. */
  flashStatus(text: string, state: StatusState = 'live'): void {
    this.setStatus(text, state);
    this.noticeTimer = window.setTimeout(() => this.setStatus(''), NOTICE_MS);
  }

  /** The HUD's counter: the round being played (from 1), or the streak so far. */
  setCount(count: number): void {
    const { of } = this.config.counter;
    this.parts.countValue.textContent = of === null ? String(count) : `${count} / ${of}`;
  }

  /** A community map's name is only known once the map has loaded. */
  setMapName(name: string): void {
    this.parts.mapValue.textContent = name;
  }

  setScore(score: number): void {
    this.parts.scoreValue.textContent = formatScore(score);
  }

  /**
   * Seconds left in the round, or null to take the clock out of the HUD between rounds. Under ten
   * seconds the clock is yellow (`warn`), under five red and pulsing (`urgent`); the number is always there.
   */
  setClock(seconds: number | null): void {
    this.parts.timeValue.textContent = seconds === null ? '' : clock(seconds);
    this.parts.timeCell.hidden = !this.config.timed || seconds === null;
    const state = timerState(seconds);
    this.parts.timeCell.classList.toggle('warn', state === 'warn');
    this.parts.timeCell.classList.toggle('urgent', state === 'urgent');
    if (seconds !== null && seconds !== this.lastTick && seconds > 0 && seconds <= TICK_SECONDS && this.current === 'guessing') {
      sounds.play('tick');
    }
    this.lastTick = seconds;
  }

  /**
   * Opens a street view on the first imagery source that can both `load` what the driver needs
   * and show it. Resolves to what was loaded, or null when no source could (or the screen is gone).
   */
  async openStreet<T>(providers: readonly ImageryProvider[], load: (provider: ImageryProvider) => Promise<T>): Promise<T | null> {
    for (const provider of providers) {
      try {
        const loaded = await load(provider);
        const opened = await provider.createView(this.parts.panoHost, this.config.mode, this.viewHandlers);
        if (this.destroyed) {
          opened.destroy();
          return null;
        }
        this.street = opened;
        // when the first choice of imagery could not be used, the credit says which one this is, and no more
        const standIn = provider !== providers[0];
        const credit = provider.attribution ?? '';
        this.parts.credit.textContent = standIn ? t('round.creditStandIn', { credit }) : credit;
        this.parts.credit.hidden = provider.attribution === null;
        this.parts.view.dataset.imagery = provider.name;
        return loaded;
      } catch {
        // this source cannot serve the game right now: try the next one
      }
    }
    return null;
  }

  /** Clears the last round away and opens the map for a new pin. */
  beginRound(): void {
    this.pinned = null;
    this.lock = null;
    this.guessLabel = null;
    this.syncGuessButton();
    this.setHintUsed(false);
    this.mapTools.leaveFull();
    this.parts.mapPanel.classList.remove('open');
    this.clearPanel();
    this.setPhase('guessing');
    this.map.startRound();
  }

  /** Shows a place in the street view. Resolves to false when the picture would not load. */
  showPlace(place: Place): Promise<boolean> {
    if (!this.street) {
      return Promise.resolve(false);
    }
    this.openedOn = null;
    return this.street.show(place).then(
      () => true,
      () => false,
    );
  }

  /** Stops guesses being taken and says why on the button; null takes them again. */
  lockGuess(reason: string | null): void {
    if (reason !== this.lock) {
      this.lock = reason;
      this.syncGuessButton();
    }
  }

  /** What the Guess button says once a pin is placed, such as "Guess France"; null for plain "Guess". */
  setGuessLabel(label: string | null): void {
    this.guessLabel = label;
    this.syncGuessButton();
  }

  /** The hint can be asked for once a round. The button says what it costs before it is pressed. */
  setHintUsed(used: boolean): void {
    this.hintUsed = used;
    this.syncHintButton();
  }

  /**
   * How many hints the game has left: the button says so, and is gone once there are none (the
   * round a hint was shown in keeps saying so). Null, as at the start, is a button with no count.
   */
  setHintsLeft(left: number | null): void {
    this.hintsLeft = left;
    this.syncHintButton();
  }

  /** Puts a panel over the view and returns the map padding that keeps pins clear of it. */
  showPanel(panel: HTMLElement): FitPadding {
    this.parts.panelHost.replaceChildren(panel);
    const padding = paddingAround(panel, this.parts.hud);
    this.panelPadding = padding;
    this.panelWatch.disconnect();
    this.panelWatch.observe(panel);
    return padding;
  }

  clearPanel(): void {
    this.panelWatch.disconnect();
    this.panelPadding = null;
    this.parts.panelHost.replaceChildren();
  }

  /** Asks a yes-or-no question over the screen. Escape, or a second question while one is open, answers no. */
  async confirm(message: string, yes: string, no: string): Promise<boolean> {
    if (this.asking) {
      return false;
    }
    this.asking = true;
    const answer = await confirmDialog(this.parts.view, message, yes, no);
    this.asking = false;
    return answer;
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.noticeTimer);
    this.panelWatch.disconnect();
    this.stopKeys();
    this.street?.destroy();
    this.map.destroy();
  }

  private wire(): void {
    const { guessButton, mapToggle, mapClose, mapPanel, returnButton, exitButton, hintButton, compass } = this.parts;
    guessButton.addEventListener('click', () => this.events.onGuess());
    mapPanel.addEventListener('pointerenter', () => this.events.onMapOpen?.());
    exitButton.addEventListener('click', () => this.events.onExit());
    hintButton.addEventListener('click', () => this.events.onHint?.());
    compass.addEventListener('click', () => this.controls()?.faceNorth());
    // on a phone the map is a sheet: opened from its button over the view, closed from the bar under the map
    mapToggle.addEventListener('click', () => {
      mapPanel.classList.add('open');
      this.events.onMapOpen?.();
    });
    mapClose.addEventListener('click', () => mapPanel.classList.remove('open'));
    returnButton.addEventListener('click', () => {
      if (this.current === 'guessing') {
        void this.street?.returnToStart();
      }
    });
  }

  /** The panel in the slot changed its size: the sides of the map's padding that moved with it are fitted again. */
  private followPanel(): void {
    const panel = this.parts.panelHost.firstElementChild;
    if (!(panel instanceof HTMLElement) || !this.panelPadding) {
      return;
    }
    const before = this.panelPadding;
    this.panelPadding = paddingAround(panel, this.parts.hud);
    const moved = changedSides(before, this.panelPadding);
    if (Object.keys(moved).length > 0) {
      this.map.repad(moved);
    }
  }

  private syncHintButton(): void {
    const { hintButton } = this.parts;
    const left = this.hintsLeft;
    hintButton.disabled = this.hintUsed;
    hintButton.hidden = !this.config.hint || (!this.hintUsed && left === 0);
    hintButton.textContent = this.hintUsed ? t('round.hintShown') : left === null ? t('round.hint') : tn('round.hintLeft', left);
  }

  /** The view's turn, zoom and face-north, or null while there is no view or the mode locks it. */
  private controls(): ViewControls | null {
    const view = this.street;
    return view && this.config.mode !== 'nmpz' && this.current === 'guessing' && hasControls(view) ? view : null;
  }

  private steer(action: SteerAction): void {
    const view = this.controls();
    if (action === 'turnLeft' || action === 'turnRight') {
      view?.turnBy(action === 'turnLeft' ? -TURN_DEGREES : TURN_DEGREES);
    } else {
      view?.zoomBy(action === 'zoomIn' ? 1 : -1);
    }
  }

  private syncGuessButton(): void {
    const { guessButton } = this.parts;
    guessButton.disabled = this.lock !== null || !this.pinned;
    guessButton.textContent = this.lock ?? (this.pinned ? (this.guessLabel ?? t('round.guess')) : t('round.placePin'));
  }

  /** Space or enter: the guess while a pin is placed and guesses are taken, the next round while a result shows. */
  private confirmKey(): void {
    if (this.current === 'guessing' && this.pinned && this.lock === null) {
      this.events.onGuess();
    } else if (this.current === 'result') {
      this.events.onNext();
    }
  }
}
