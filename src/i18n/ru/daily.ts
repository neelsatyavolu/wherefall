import type { daily as english } from '../en/daily.ts';
import type { Part } from '../index.ts';

/** Wave 5: the daily challenge. Every key of `../en/daily.ts`, or the type check fails. */
export const daily: Part<typeof english> = {
  'daily.rule': 'Без подсказок. Одна попытка в день.',
  'daily.next': 'Следующий вызов через',

  'daily.visitor.open':
    'Ты не в аккаунте. Сегодня можно сыграть один раз. Результат сохранится в этом браузере, вне таблицы лидеров, и перейдёт в твой аккаунт, если ты его создашь. {signIn}.',
  'daily.visitor.done': 'Этот результат сохранён в этом браузере, вне таблицы лидеров. Создай аккаунт, и он перейдёт туда. {signIn}.',
  'daily.started': 'Сегодняшний вызов был начат и не доигран, так что попытка на сегодня использована. Завтра будет новый.',
  'daily.claimFailed': 'Результаты, сыгранные до входа, не удалось добавить в твой аккаунт.',
  'daily.rank': 'Место',
  'daily.beat': 'Лучше, чем у {share} игроков',

  'daily.record': 'Твои итоги в ежедневном вызове',
  'daily.days.one': '{count} день',
  'daily.days.few': '{count} дня',
  'daily.days.many': '{count} дней',
  'daily.days.other': '{count} дней',
  'daily.streak.best': 'Рекорд: {days}',
  'daily.streak.risk': 'под угрозой',
  'daily.streak.start': 'Сыграй сегодня, чтобы начать серию.',
  'daily.streak.atRisk': 'Сыграй сегодня, чтобы её сохранить.',
  'daily.streak.spent': 'Сегодняшний день не засчитается. Один пропуск за семь дней прощается.',
  'daily.streak.kept': 'На сегодня в безопасности.',
  'daily.played': 'Сыграно',
  'daily.best': 'Лучший результат',
  'daily.average': 'В среднем',
  'daily.history': 'Последние 14 дней',
  'daily.history.played': '{date}: результат {score}',
  'daily.history.missed': '{date}: не сыграно',
  'daily.history.open': 'Сегодня: ещё не сыграно',
  'daily.history.todayPlayed': 'Сегодня: результат {score}',

  'daily.distribution': 'Результаты за сегодня',
  'daily.distribution.bar.one': 'От {from} до {to}: {count} игрок',
  'daily.distribution.bar.few': 'От {from} до {to}: {count} игрока',
  'daily.distribution.bar.many': 'От {from} до {to}: {count} игроков',
  'daily.distribution.bar.other': 'От {from} до {to}: {count} игроков',

  'daily.page': 'Страница {page}',
  'daily.previous': 'Назад',
  'daily.nextPage': 'Вперёд',

  'daily.nav.open': 'Сегодня не сыграно',
  'daily.nav.atRisk': 'Серия под угрозой',
  'daily.nav.done': 'Сегодня сыграно',

  'daily.leaveConfirm': 'Выйти из сегодняшнего вызова? Попытка одна в день, и выход её расходует.',
  'daily.summary.share': 'Сегодня у всех одни и те же три места. Твой результат не выдаёт ни одного из них.',
  'daily.kept': 'Он сохранён в этом браузере и перейдёт в твой аккаунт, если ты его создашь.',
  'daily.share.title': 'Ежедневный вызов Wherefall · {date}',

  'daily.personalBest': 'Личный рекорд',
  'daily.average.title': 'В сравнении со средним за день',
  'daily.average.above': '{points} выше среднего',
  'daily.average.below': '{points} ниже среднего',
  'daily.average.level': 'Ровно на уровне среднего',
  'daily.visitor.unclaimable': 'Этот результат сохранён в этом браузере, вне таблицы лидеров. Он сыгран до того, как результаты стало можно переносить в аккаунт, поэтому останется здесь.',

  'daily.stale.note': 'Wherefall обновился, пока шла игра, поэтому этот результат не удалось сохранить.',
  'daily.stale.explain':
    'С обновлением изменились три сегодняшних места, а эта игра прошла на прежних. Обнови страницу, чтобы получить новую версию. Попытка на сегодня использована, так что сыграть вызов сегодня ещё раз нельзя. Следующий откроется в полночь по UTC.',
  'daily.stale.reload': 'Обновить страницу',
  'daily.stale.spent': 'Сегодняшний результат не удалось сохранить: Wherefall обновился, пока шла игра, и с обновлением изменились сегодняшние места. Попытка на сегодня использована. Завтра будет новый вызов.',
};
