import type { party as english } from '../en/party.ts';
import type { Part } from '../index.ts';

/** Wave 5: party options, host controls, teams and 2v2. Every key of `../en/party.ts`, or the type check fails. */
export const party: Part<typeof english> = {
  'party.rounds.less': 'Меньше раундов',
  'party.rounds.more': 'Больше раундов',
  'party.time.note': 'Без лимита раунд закончится, когда ответят все или когда хост его завершит.',
  'party.communication': 'Общение',
  'party.communication.chat': 'Чат',
  'party.communication.reactions': 'Только реакции',
  'party.communication.off': 'Выключено',
  'party.teams': 'Команды',
  'party.teams.none': 'Без команд',
  'party.teams.best': 'Лучший ответ',
  'party.teams.average': 'Среднее',
  'party.teams.note': 'С командами игроки делятся на две стороны. Команда получает за раунд свой лучший ответ или среднее всех своих ответов.',

  'party.line.chat': 'чат',
  'party.line.reactions': 'только реакции',
  'party.line.off': 'без чата',
  'party.line.best': 'команды по лучшему ответу',
  'party.line.average': 'команды по среднему',

  'party.settings.change': 'Изменить настройки',
  'party.settings.save': 'Сохранить настройки',
  'party.settings.form': 'Настройки комнаты',
  'party.lock': 'Закрыть комнату',
  'party.unlock': 'Открыть комнату',
  'party.locked.tag': 'закрыта',
  'party.locked.note': 'Комната закрыта. Новые игроки войти не могут.',
  'party.team.join': 'Вступить',
  'party.team.joinLabel': 'Вступить: {team}',
  'party.team.unseated': 'Пока без команды',
  'party.team.empty': 'Пока никого',
  'party.team.shuffle': 'Перемешать команды',
  'party.team.hint': 'Выбери команду. Кто останется без команды, попадёт в меньшую, когда начнётся матч.',
  'party.pair.button': 'В очередь 2v2 вместе',
  'party.pair.note': 'Если вас ровно двое, можно встать в очередь 2v2 одной командой. Комната при этом закроется.',
  'party.pair.queued': 'Ты и твой напарник вместе в очереди 2v2.',

  'host.title': 'Хост',
  'host.label': 'Меню хоста',
  'host.kick': 'Выгнать',
  'host.kickLabel': 'Выгнать {name}',
  'host.kickConfirm': 'Выгнать {name} из комнаты? Вернуться будет нельзя.',
  'host.kickYes': 'Выгнать',
  'host.makeHost': 'Сделать хостом',
  'host.makeHostLabel': 'Сделать {name} хостом',
  'host.moreLabel': 'Действия: {name}',
  'host.endRound': 'Завершить раунд',

  'party.noTimer.label': 'Без таймера',
  'party.noTimer': 'Раунд закончится, когда ответят все или когда хост его завершит.',
  'party.noTimerHost': 'Раунд закончится, когда ответят все или когда ты его завершишь.',

  'team.health': 'Здоровье команд',
  'team.healthLeft': 'здоровье: {health}',

  'chat.scope': 'Кому',
  'chat.scope.all': 'Всем',
  'chat.scope.team': 'Команде',
  'chat.teamTag': 'команде',

  // Wave 6
};
