import type { round as english } from '../en/round.ts';
import type { Part } from '../index.ts';

/** Wave 5: the round screen, hints and the result of a round or a game. Every key of `../en/round.ts`, or the type check fails. */
export const round: Part<typeof english> = {
  'round.hintLeft.one': 'Подсказка (50% очков), осталась {count}',
  'round.hintLeft.few': 'Подсказка (50% очков), осталось {count}',
  'round.hintLeft.many': 'Подсказка (50% очков), осталось {count}',
  'round.hintLeft.other': 'Подсказка (50% очков), осталось {count}',
  'round.faceNorth': 'Повернуться на север',

  'guessMap.keepOpen': 'Не сворачивать карту',
  'guessMap.fullScreen': 'Карта на весь экран',
  'guessMap.type': 'Тип карты',
  'guessMap.type.streets': 'Улицы',
  'guessMap.type.satellite': 'Спутник',
  'guessMap.type.hybrid': 'Гибрид',
  'guessMap.type.terrain': 'Рельеф',
  'guessMap.credit.terrain': 'Данные карты: © участники {osm}, SRTM | Стиль карты: © {topo} ({licence})',
  'guessMap.credit.hybrid': 'Названия и границы: {free}, © {tiles}, данные {osm}',

  'result.perfect': 'Идеально',
  // the country streak that world games keep in the background: how long it is now, or that it was lost
  'result.streak': 'Серия стран: {count}',
  'result.streakEnded': 'Твоя серия стран прервалась на {count}.',
  'summary.stars.one': '{count} звезда из 3',
  'summary.stars.few': '{count} звезды из 3',
  'summary.stars.many': '{count} звёзд из 3',
  'summary.stars.other': '{count} звёзд из 3',
  'summary.shareResult': 'Поделиться результатом',
  'summary.resultCopied': 'Результат скопирован',
  'summary.resultLabel': 'Результат, которым можно поделиться',
  'share.title': 'Wherefall · {map}',

  // a distance's units; the number is written for the language before it goes in
  'unit.km': '{value} км',
  'unit.m': '{value} м',
  'unit.mi': '{value} ми',
  'unit.ft': '{value} фт',

  // a map on a page lets the page scroll past it: what it says when one finger or a bare wheel is tried on it
  'guessMap.gesture.touch': 'Двигай карту двумя пальцами',
  'guessMap.gesture.ctrl': 'Удерживай Ctrl и прокручивай, чтобы менять масштаб карты',
  'guessMap.gesture.cmd': 'Удерживай ⌘ и прокручивай, чтобы менять масштаб карты',

  // the word beside a status dot: something failed, or what became of a score
  'status.error': 'Ошибка',
  'status.saved': 'Сохранено',
  'status.notSaved': 'Не сохранено',
  'status.note': 'К сведению',
};
