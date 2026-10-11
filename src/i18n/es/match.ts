import type { match as english } from '../en/match.ts';
import type { Part } from '../index.ts';

/** Wave 5: guests, parties, 2v2, chat and the queues. Every key of `../en/match.ts`, or the type check fails. */
export const match: Part<typeof english> = {
  // Invitados: jugar sin cuenta, y lo que añade una cuenta
  'guest.signUp': 'Crear cuenta',
  'guest.label': 'Sesión de invitado',
  'guest.needsAccount':
    'Esto requiere una cuenta. Estás como {name}, un invitado, y un invitado ya no puede jugar. Una cuenta guarda tus resultados y abre todos los modos, los amigos, el chat y la creación de mapas. Es gratis y solo pide un nombre de usuario y una contraseña.',
  'guest.chatNote': 'Los invitados pueden enviar reacciones. Para escribir mensajes hace falta una cuenta.',
  'session.ended': 'Tu sesión se ha cerrado.',

  // Una partida: la sesión que caduca, y lo que ofrece la pantalla final
  'match.sessionEnded': 'Tu sesión se ha cerrado, así que ya no estás en esta partida.',
  'match.guestEnded': 'Tu sesión de invitado ha terminado, así que ya no estás en esta partida. Una sesión de invitado dura 24 horas.',
  'match.backToLobby': 'Volver a la sala',
  'match.hostLobby': 'Al volver a la sala te llevas a todos los que siguen aquí.',
  'match.stayForLobby': 'Quédate en esta pantalla para seguir en la sala. El anfitrión puede llevar a todos de vuelta a ella.',
  'match.xpEarned': 'Has ganado {xp} XP.',
  'match.xpEarnedRanked': 'Has ganado {xp} XP. Los duelos clasificatorios dan el doble.',
  'match.roster.count': '{guessed} / {players} han respondido',
  'match.reportSent': 'Has reportado a {name}. Un moderador lo revisará.',

  // La pantalla antes de la primera ronda de un duelo clasificatorio
  'versus.word': 'contra',
  'versus.label': 'Duelo clasificatorio: {first} contra {second}',

  // Las colas: la espera, el bloqueo, la vuelta cuando el rival se va
  'queue.ranked.xp': 'Las rondas clasificatorias dan el doble de XP.',
  'queue.waited': 'Esperando {time}',
  'queue.window': 'Rivales a ±{points} de tu clasificación',
  'queue.locked': 'Saliste de dos duelos clasificatorios antes de que empezaran. Podrás volver a buscar en {time}.',
  'queue.dodged': 'El otro jugador salió antes de que empezara la partida. Tu clasificación no ha cambiado y vuelves a estar en la cola.',

  // Chat: silenciar a un jugador
  'chat.mute.title': 'Silenciar jugadores',
  'chat.mute.note': 'Lo que diga un jugador silenciado no se te muestra durante el resto de la partida.',
  'chat.mute.tag': 'silenciado',
  'chat.mute.button': 'Silenciar',
  'chat.mute.undo': 'Reactivar',
  'chat.mute.label': 'Silenciar a {name}',
  'chat.mute.undoLabel': 'Dejar de silenciar a {name}',

  // Wave 6
  'match.placesRefused': 'El servidor no ha aceptado los lugares sorteados para esta partida: {error}',
  'match.drawAgain': 'Sortear otros lugares',
  'match.removed.label': 'Expulsado',
  'queue.typical': 'Espera habitual: {wait}',
  'queue.typical.underMinute': 'normalmente menos de un minuto',
  'queue.typical.minutes.one': 'alrededor de {count} minuto',
  'queue.typical.minutes.other': 'alrededor de {count} minutos',
  'queue.typical.none': 'sin partidas recientes',
};
