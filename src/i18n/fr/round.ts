import type { round as english } from '../en/round.ts';
import type { Part } from '../index.ts';

/** Wave 5: the round screen, hints and the result of a round or a game. Every key of `../en/round.ts`, or the type check fails. */
export const round: Part<typeof english> = {
  'round.hintLeft.one': 'Indice (moitié des points), {count} restant',
  'round.hintLeft.other': 'Indice (moitié des points), {count} restants',
  'round.faceNorth': 'Regarder vers le nord',

  'guessMap.keepOpen': 'Garder la carte ouverte',
  'guessMap.fullScreen': 'Carte en plein écran',
  'guessMap.type': 'Type de carte',
  'guessMap.type.streets': 'Rues',
  'guessMap.type.satellite': 'Satellite',
  'guessMap.type.hybrid': 'Hybride',
  'guessMap.type.terrain': 'Relief',
  'guessMap.credit.terrain': 'Données cartographiques : © les contributeurs d’{osm}, SRTM | Style de carte : © {topo} ({licence})',
  'guessMap.credit.hybrid': 'Noms et frontières : {free}, © {tiles}, données d’{osm}',

  'result.perfect': 'Parfait',
  // the country streak that world games keep in the background: how long it is now, or that it was lost
  'result.streak': 'Série de pays : {count}',
  'result.streakEnded': 'Votre série de pays s’est arrêtée à {count}.',
  'summary.stars.one': '{count} étoile sur 3',
  'summary.stars.other': '{count} étoiles sur 3',
  'summary.shareResult': 'Partager le résultat',
  'summary.resultCopied': 'Résultat copié',
  'summary.resultLabel': 'Résultat à partager',
  'share.title': 'Wherefall · {map}',

  // a distance's units; the number is written for the language before it goes in
  'unit.km': '{value} km',
  'unit.m': '{value} m',
  'unit.mi': '{value} mi',
  'unit.ft': '{value} ft',

  // a map on a page lets the page scroll past it: what it says when one finger or a bare wheel is tried on it
  'guessMap.gesture.touch': 'Utilisez deux doigts pour déplacer la carte',
  'guessMap.gesture.ctrl': 'Maintenez Ctrl et faites défiler pour zoomer sur la carte',
  'guessMap.gesture.cmd': 'Maintenez ⌘ et faites défiler pour zoomer sur la carte',

  // the word beside a status dot: something failed, or what became of a score
  'status.error': 'Erreur',
  'status.saved': 'Enregistré',
  'status.notSaved': 'Non enregistré',
  'status.note': 'Note',
};
