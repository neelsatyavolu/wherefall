import type { round as english } from '../en/round.ts';
import type { Part } from '../index.ts';

/** Wave 5: the round screen, hints and the result of a round or a game. Every key of `../en/round.ts`, or the type check fails. */
export const round: Part<typeof english> = {
  'round.hintLeft.one': 'Pista (mitad de puntos), queda {count}',
  'round.hintLeft.other': 'Pista (mitad de puntos), quedan {count}',
  'round.faceNorth': 'Mirar al norte',

  'guessMap.keepOpen': 'Mantener el mapa abierto',
  'guessMap.fullScreen': 'Mapa a pantalla completa',
  'guessMap.type': 'Tipo de mapa',
  'guessMap.type.streets': 'Calles',
  'guessMap.type.satellite': 'Satélite',
  'guessMap.type.hybrid': 'Híbrido',
  'guessMap.type.terrain': 'Relieve',
  'guessMap.credit.terrain': 'Datos del mapa: © colaboradores de {osm}, SRTM | Estilo del mapa: © {topo} ({licence})',
  'guessMap.credit.hybrid': 'Nombres y fronteras: {free}, © {tiles}, datos de {osm}',

  'result.perfect': 'Perfecto',
  // the country streak that world games keep in the background: how long it is now, or that it was lost
  'result.streak': 'Racha de países: {count}',
  'result.streakEnded': 'Tu racha de países terminó en {count}.',
  'summary.stars.one': '{count} estrella de 3',
  'summary.stars.other': '{count} estrellas de 3',
  'summary.shareResult': 'Compartir resultado',
  'summary.resultCopied': 'Resultado copiado',
  'summary.resultLabel': 'Resultado para compartir',
  'share.title': 'Wherefall · {map}',

  // a distance's units; the number is written for the language before it goes in
  'unit.km': '{value} km',
  'unit.m': '{value} m',
  'unit.mi': '{value} mi',
  'unit.ft': '{value} ft',

  // a map on a page lets the page scroll past it: what it says when one finger or a bare wheel is tried on it
  'guessMap.gesture.touch': 'Usa dos dedos para mover el mapa',
  'guessMap.gesture.ctrl': 'Mantén pulsado Ctrl y desplázate para acercar el mapa',
  'guessMap.gesture.cmd': 'Mantén pulsado ⌘ y desplázate para acercar el mapa',

  // the word beside a status dot: something failed, or what became of a score
  'status.error': 'Error',
  'status.saved': 'Guardado',
  'status.notSaved': 'No guardado',
  'status.note': 'Nota',
};
