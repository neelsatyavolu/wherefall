import type { round as english } from '../en/round.ts';
import type { Part } from '../index.ts';

/** Wave 5: the round screen, hints and the result of a round or a game. Every key of `../en/round.ts`, or the type check fails. */
export const round: Part<typeof english> = {
  'round.hintLeft.one': 'Hinweis (halbe Punkte), noch {count}',
  'round.hintLeft.other': 'Hinweis (halbe Punkte), noch {count}',
  'round.faceNorth': 'Nach Norden schauen',

  'guessMap.keepOpen': 'Karte offen halten',
  'guessMap.fullScreen': 'Karte im Vollbild',
  'guessMap.type': 'Kartentyp',
  'guessMap.type.streets': 'Straßen',
  'guessMap.type.satellite': 'Satellit',
  'guessMap.type.hybrid': 'Hybrid',
  'guessMap.type.terrain': 'Gelände',
  'guessMap.credit.terrain': 'Kartendaten: © {osm}-Mitwirkende, SRTM | Kartendarstellung: © {topo} ({licence})',
  'guessMap.credit.hybrid': 'Namen und Grenzen: {free}, © {tiles}, Daten von {osm}',

  'result.perfect': 'Perfekt',
  // the country streak that world games keep in the background: how long it is now, or that it was lost
  'result.streak': 'Länderserie: {count}',
  'result.streakEnded': 'Deine Länderserie endete bei {count}.',
  'summary.stars.one': '{count} von 3 Sternen',
  'summary.stars.other': '{count} von 3 Sternen',
  'summary.shareResult': 'Ergebnis teilen',
  'summary.resultCopied': 'Ergebnis kopiert',
  'summary.resultLabel': 'Ergebnis zum Teilen',
  'share.title': 'Wherefall · {map}',

  // a distance's units; the number is written for the language before it goes in
  'unit.km': '{value} km',
  'unit.m': '{value} m',
  'unit.mi': '{value} mi',
  'unit.ft': '{value} ft',

  // a map on a page lets the page scroll past it: what it says when one finger or a bare wheel is tried on it
  'guessMap.gesture.touch': 'Bewege die Karte mit zwei Fingern',
  'guessMap.gesture.ctrl': 'Halte Strg gedrückt und scrolle, um die Karte zu zoomen',
  'guessMap.gesture.cmd': 'Halte ⌘ gedrückt und scrolle, um die Karte zu zoomen',

  // the word beside a status dot: something failed, or what became of a score
  'status.error': 'Fehler',
  'status.saved': 'Gespeichert',
  'status.notSaved': 'Nicht gespeichert',
  'status.note': 'Info',
};
