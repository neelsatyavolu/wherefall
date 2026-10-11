import type { daily as english } from '../en/daily.ts';
import type { Part } from '../index.ts';

/** Wave 5: the daily challenge. Every key of `../en/daily.ts`, or the type check fails. */
export const daily: Part<typeof english> = {
  'daily.rule': 'Sin pistas. Un solo intento al día.',
  'daily.next': 'Próximo desafío en',

  'daily.visitor.open':
    'No has iniciado sesión. Hoy puedes jugar una vez. El resultado se guarda en este navegador, fuera del ranking, y pasa a tu cuenta si creas una. {signIn}.',
  'daily.visitor.done': 'Este resultado está guardado en este navegador, fuera del ranking. Crea una cuenta y pasará a ella. {signIn}.',
  'daily.started': 'Empezaste el desafío de hoy y saliste antes del final, así que el intento de hoy ya está gastado. Mañana te espera uno nuevo.',
  'daily.claimFailed': 'Los resultados que jugaste antes de iniciar sesión no se han podido añadir a tu cuenta.',
  'daily.rank': 'Puesto',
  'daily.beat': 'Mejor que el {share} de los jugadores',

  'daily.record': 'Tus cifras en el desafío diario',
  'daily.days.one': '{count} día',
  'daily.days.other': '{count} días',
  'daily.streak.best': 'Mejor: {days}',
  'daily.streak.risk': 'en riesgo',
  'daily.streak.start': 'Juega hoy para empezar una.',
  'daily.streak.atRisk': 'Juega hoy para mantenerla.',
  'daily.streak.spent': 'Hoy no contará. Se perdona un día perdido de cada siete.',
  'daily.streak.kept': 'A salvo por hoy.',
  'daily.played': 'Jugados',
  'daily.best': 'Mejor puntuación',
  'daily.average': 'Media',
  'daily.history': 'Últimos 14 días',
  'daily.history.played': '{date}: puntuación {score}',
  'daily.history.missed': '{date}: sin jugar',
  'daily.history.open': 'Hoy: aún sin jugar',
  'daily.history.todayPlayed': 'Hoy: puntuación {score}',

  'daily.distribution': 'Puntuaciones de hoy',
  'daily.distribution.bar.one': 'De {from} a {to}: {count} jugador',
  'daily.distribution.bar.other': 'De {from} a {to}: {count} jugadores',

  'daily.page': 'Página {page}',
  'daily.previous': 'Anterior',
  'daily.nextPage': 'Siguiente',

  'daily.nav.open': 'Hoy sin jugar',
  'daily.nav.atRisk': 'Racha en riesgo',
  'daily.nav.done': 'Jugado hoy',

  'daily.leaveConfirm': '¿Salir del desafío de hoy? Tienes un solo intento al día, y salir lo gasta.',
  'daily.summary.share': 'Hoy a todos les tocan los mismos tres lugares. Compartir tu resultado no desvela ninguno.',
  'daily.kept': 'Queda guardado en este navegador y pasa a tu cuenta si creas una.',
  'daily.share.title': 'Desafío diario de Wherefall · {date}',

  'daily.personalBest': 'Récord personal',
  'daily.average.title': 'Frente a la media de hoy',
  'daily.average.above': '{points} sobre la media',
  'daily.average.below': '{points} bajo la media',
  'daily.average.level': 'Justo en la media',
  'daily.visitor.unclaimable': 'Este resultado está guardado en este navegador, fuera del ranking. Se jugó antes de que los resultados pudieran pasar a una cuenta, así que se queda aquí.',

  'daily.stale.note': 'Wherefall se actualizó mientras jugabas, así que este resultado no se pudo guardar.',
  'daily.stale.explain':
    'La actualización cambió los tres lugares de hoy, y esta partida se jugó con los anteriores. Recarga para tener la versión nueva. El intento de hoy ya está gastado, así que hoy no se puede volver a jugar el desafío. El próximo se abre a medianoche UTC.',
  'daily.stale.reload': 'Recargar',
  'daily.stale.spent': 'El resultado de hoy no se pudo guardar: Wherefall se actualizó mientras jugabas y la actualización cambió los lugares de hoy. El intento de hoy ya está gastado. Mañana te espera uno nuevo.',
};
