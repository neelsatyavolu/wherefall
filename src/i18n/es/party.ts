import type { party as english } from '../en/party.ts';
import type { Part } from '../index.ts';

/** Wave 5: party options, host controls, teams and 2v2. Every key of `../en/party.ts`, or the type check fails. */
export const party: Part<typeof english> = {
  'party.rounds.less': 'Menos rondas',
  'party.rounds.more': 'Más rondas',
  'party.time.note': 'Sin límite, la ronda termina cuando todos han respondido o cuando el anfitrión la cierra.',
  'party.communication': 'Comunicación',
  'party.communication.chat': 'Chat',
  'party.communication.reactions': 'Solo reacciones',
  'party.communication.off': 'Ninguna',
  'party.teams': 'Equipos',
  'party.teams.none': 'Sin equipos',
  'party.teams.best': 'Mejor respuesta',
  'party.teams.average': 'Media',
  'party.teams.note': 'Con equipos, los jugadores se reparten en dos bandos. Cada equipo puntúa con su mejor respuesta de la ronda o con la media de todas las suyas.',

  'party.line.chat': 'chat',
  'party.line.reactions': 'solo reacciones',
  'party.line.off': 'sin chat',
  'party.line.best': 'equipos por mejor respuesta',
  'party.line.average': 'equipos por media',

  'party.settings.change': 'Cambiar ajustes',
  'party.settings.save': 'Guardar ajustes',
  'party.settings.form': 'Ajustes de la sala',
  'party.lock': 'Cerrar la sala',
  'party.unlock': 'Abrir la sala',
  'party.locked.tag': 'cerrada',
  'party.locked.note': 'Esta sala está cerrada. No puede entrar nadie más.',
  'party.team.join': 'Entrar',
  'party.team.joinLabel': 'Entrar en {team}',
  'party.team.unseated': 'Aún sin equipo',
  'party.team.empty': 'Nadie todavía',
  'party.team.shuffle': 'Mezclar equipos',
  'party.team.hint': 'Elige un equipo. Quien no tenga uno irá al más pequeño cuando empiece la partida.',
  'party.pair.button': 'Buscar un 2v2 juntos',
  'party.pair.note': 'Con exactamente dos jugadores en la sala, puedes entrar en la cola de 2v2 con tu compañero en el mismo equipo. La sala se cierra.',
  'party.pair.queued': 'Estás en la cola de 2v2 junto a tu compañero de equipo.',

  'host.title': 'Anfitrión',
  'host.label': 'Controles del anfitrión',
  'host.kick': 'Expulsar',
  'host.kickLabel': 'Expulsar a {name}',
  'host.kickConfirm': '¿Expulsar a {name} de la sala? No podrá volver.',
  'host.kickYes': 'Expulsar',
  'host.makeHost': 'Hacer anfitrión',
  'host.makeHostLabel': 'Hacer anfitrión a {name}',
  'host.moreLabel': 'Acciones para {name}',
  'host.endRound': 'Terminar ronda',

  'party.noTimer.label': 'Sin tiempo límite',
  'party.noTimer': 'La ronda termina cuando todos han respondido o cuando el anfitrión la cierra.',
  'party.noTimerHost': 'La ronda termina cuando todos han respondido o cuando tú la cierras.',

  'team.health': 'Vida de los equipos',
  'team.healthLeft': '{health} de vida',

  'chat.scope': 'Enviar a',
  'chat.scope.all': 'Todos',
  'chat.scope.team': 'Equipo',
  'chat.teamTag': 'equipo',

  // Wave 6
  'party.guests': 'Permitir invitados',
  'party.guests.on': 'Sí',
  'party.guests.off': 'No',
  'party.guests.note': 'Un invitado juega sin cuenta. Si lo desactivas, solo pueden entrar jugadores con la sesión iniciada.',
  'party.guests.stay': 'Los invitados que ya están aquí se quedan. Puedes expulsarlos desde la lista de jugadores.',
  'party.line.accountsOnly': 'solo con cuenta',
  'party.accountsOnly.label': 'Solo con cuenta',
  'party.accountsOnly': 'Esta sala es solo para jugadores con cuenta. Crea una para entrar: es gratis y solo pide un nombre de usuario y una contraseña.',
};
