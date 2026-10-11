/**
 * What the round screen's keys and compass ask of a street view, beyond showing a place: turn,
 * zoom and face north. Both views (Google's and the Panoramax one) have them.
 */
export interface ViewControls {
  /** turns the view by some degrees: positive to the right, negative to the left */
  turnBy(degrees: number): void;
  /** zooms the view by some steps: positive in, negative out */
  zoomBy(steps: number): void;
  faceNorth(): void;
}

/** how far one press of A or D turns the view; holding the key repeats it */
export const TURN_DEGREES = 6;

export const hasControls = (view: object): view is ViewControls => 'turnBy' in view && 'zoomBy' in view && 'faceNorth' in view;
