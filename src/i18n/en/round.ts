/** Wave 5, English: the round screen, hints and the result of a round or a game. Keys as in `../en.ts`. */
export const round = {
  // the hint, of which a game has two
  'round.hintLeft.one': 'Hint (half points), {count} left',
  'round.hintLeft.other': 'Hint (half points), {count} left',
  'round.faceNorth': 'Face north',

  // the guess map's tools
  'guessMap.keepOpen': 'Keep the map open',
  'guessMap.fullScreen': 'Full-screen map',
  'guessMap.type': 'Map type',
  'guessMap.type.streets': 'Streets',
  'guessMap.type.satellite': 'Satellite',
  'guessMap.type.hybrid': 'Hybrid',
  'guessMap.type.terrain': 'Terrain',
  'guessMap.credit.terrain': 'Map data: © {osm} contributors, SRTM | Map style: © {topo} ({licence})',
  'guessMap.credit.hybrid': 'Names and borders: {free}, © {tiles}, data from {osm}',

  // a round's result and a game's summary
  'result.perfect': 'Perfect',
  // the country streak that world games keep in the background: how long it is now, or that it was lost
  'result.streak': 'Country streak: {count}',
  'result.streakEnded': 'Your country streak ended at {count}.',
  'summary.stars.one': '{count} star out of 3',
  'summary.stars.other': '{count} stars out of 3',
  'summary.shareResult': 'Share result',
  'summary.resultCopied': 'Result copied',
  'summary.resultLabel': 'Result to share',
  'share.title': 'Wherefall · {map}',

  // a distance's units; the number is written for the language before it goes in
  'unit.km': '{value} km',
  'unit.m': '{value} m',
  'unit.mi': '{value} mi',
  'unit.ft': '{value} ft',

  // a map on a page lets the page scroll past it: what it says when one finger or a bare wheel is tried on it
  'guessMap.gesture.touch': 'Use two fingers to move the map',
  'guessMap.gesture.ctrl': 'Hold Ctrl and scroll to zoom the map',
  'guessMap.gesture.cmd': 'Hold ⌘ and scroll to zoom the map',

  // the word beside a status dot: something failed, or what became of a score
  'status.error': 'Error',
  'status.saved': 'Saved',
  'status.notSaved': 'Not saved',
  'status.note': 'Note',
} as const;
