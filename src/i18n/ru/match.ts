import type { match as english } from '../en/match.ts';
import type { Part } from '../index.ts';

/** Wave 5: guests, parties, 2v2, chat and the queues. Every key of `../en/match.ts`, or the type check fails. */
export const match: Part<typeof english> = {
  // Гости: игра без аккаунта и что даёт аккаунт
  'guest.play': 'Играть как гость',
  'guest.signUp': 'Создать аккаунт',
  'guest.label': 'Гостевая сессия',
  'guest.playingAs': 'Ты играешь как {name}',
  'guest.making': 'Входим как гость',
  'guest.offer':
    'Здесь аккаунт не нужен: играй как гость и получишь имя на сутки. Аккаунт сохраняет результаты и открывает рейтинговые дуэли, 2v2, свои комнаты, друзей, чат и создание карт.',
  'guest.needsAccount':
    'Для этого нужен аккаунт. Ты играешь как {name}: гость может играть матчи без рейтинга и заходить в комнаты. Аккаунт сохраняет результаты и открывает рейтинговые дуэли, 2v2, свои комнаты, друзей, чат и создание карт. Это бесплатно, нужны только ник и пароль.',
  'guest.ended': 'Гостевая сессия закончилась. Она длится 24 часа.',
  'guest.chatNote': 'Гости могут отправлять реакции. Чтобы писать сообщения, нужен аккаунт.',
  'session.ended': 'Ты больше не в аккаунте.',

  // Матч: закончившаяся сессия и что предлагает экран итогов
  'match.sessionEnded': 'Ты больше не в аккаунте, а значит, и не в этом матче.',
  'match.guestEnded': 'Гостевая сессия закончилась, и ты больше не в этом матче. Она длится 24 часа.',
  'match.backToLobby': 'Вернуться в комнату',
  'match.hostLobby': 'В комнату вернутся все, кто ещё здесь.',
  'match.stayForLobby': 'Оставайся на этом экране, чтобы остаться в комнате. Хост может вернуть в неё всех.',
  'match.xpEarned': 'Получено {xp} XP.',
  'match.xpEarnedRanked': 'Получено {xp} XP. Рейтинговые дуэли дают вдвое больше.',
  'match.roster.count': 'Ответили: {guessed} / {players}',
  'match.reportSent': 'Жалоба на {name} отправлена. Её рассмотрит модератор.',

  // Экран перед первым раундом рейтинговой дуэли
  'versus.word': 'против',
  'versus.label': 'Рейтинговая дуэль: {first} против {second}',

  // Очереди: ожидание, блокировка, возврат, когда соперник ушёл
  'queue.ranked.xp': 'Рейтинговые раунды дают двойной XP.',
  'queue.waited': 'Ожидание: {time}',
  'queue.window': 'Соперники в пределах ±{points} от твоего рейтинга',
  'queue.locked': 'Ты вышел из двух рейтинговых дуэлей до их начала. Искать снова можно через {time}.',
  'queue.dodged': 'Соперник вышел до начала матча. Твой рейтинг не изменился, и ты снова в очереди.',

  // Чат: заглушить игрока
  'chat.mute.title': 'Заглушить игроков',
  'chat.mute.note': 'Сообщения и реакции заглушённого игрока скрыты от тебя до конца матча.',
  'chat.mute.tag': 'заглушён',
  'chat.mute.button': 'Заглушить',
  'chat.mute.undo': 'Вернуть',
  'chat.mute.label': 'Заглушить {name}',
  'chat.mute.undoLabel': 'Перестать глушить {name}',

  // Wave 6
  'match.placesRefused': 'Места, выбранные для этого матча, не приняты: {error}',
  'match.drawAgain': 'Выбрать другие места',
  'match.removed.label': 'Исключён',
  'queue.typical': 'Обычное ожидание: {wait}',
  'queue.typical.underMinute': 'обычно меньше минуты',
  'queue.typical.minutes.one': 'примерно {count} минута',
  'queue.typical.minutes.few': 'примерно {count} минуты',
  'queue.typical.minutes.many': 'примерно {count} минут',
  'queue.typical.minutes.other': 'примерно {count} минут',
  'queue.typical.none': 'недавних игр не было',
};
