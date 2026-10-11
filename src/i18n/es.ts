import type { Translation } from './index.ts';
import { round } from './es/round.ts';
import { solo } from './es/solo.ts';
import { match } from './es/match.ts';
import { daily } from './es/daily.ts';
import { account } from './es/account.ts';
import { maps } from './es/maps.ts';
import { social } from './es/social.ts';
import { party } from './es/party.ts';

/** Spanish. Machine-written and not checked by a native speaker. */
export const es: Translation = {
  // the strings added in wave 5 live in a file per area, beside this one
  ...round,
  ...solo,
  ...match,
  ...daily,
  ...account,
  ...maps,
  ...social,
  ...party,

  'language.name': 'Idioma',

  // Botones y frases cortas compartidos
  'common.tryAgain': 'Reintentar',
  'common.home': 'Inicio',
  'common.cancel': 'Cancelar',
  'common.remove': 'Eliminar',
  'common.report': 'Reportar',
  'common.sendReport': 'Enviar reporte',
  'common.reportPlayer': 'Reportar a {name}',
  'common.linkCopied': 'Enlace copiado',
  'common.signIn': 'Inicia sesión o crea una cuenta',
  'common.playTutorial': 'Jugar el tutorial',
  'common.typeToSearch': 'Escribe para buscar',
  'common.connectionLost': 'Se perdió la conexión. {error}',
  'common.matchOver': 'La partida terminó.',
  'common.joiningMatch': 'Entrando en la partida',
  'common.loadingFriends': 'Cargando tus amigos',
  'common.makeMap': 'Crear un mapa',
  'common.editMap': 'Editar mapa',
  'common.leaveMatch': 'Salir de la partida',
  'common.partyCode': 'Código de sala',
  'common.findingPlaces': 'Buscando lugares',
  'common.loadingView': 'Cargando la vista',
  /** dos nombres en una lista; tres se unen como "a y b y c" */
  'common.pair': '{first} y {second}',

  // Etiquetas compartidas: encabezados de tabla, etiquetas de cifras, leyendas de formulario
  'label.rating': 'Clasificación',
  'label.points': 'Puntos',
  'label.rounds': 'Rondas',
  'label.round': 'Ronda',
  'label.map': 'Mapa',
  'label.mode': 'Modo',
  'label.league': 'Liga',
  'label.bestStreak': 'Mejor racha',
  'label.noGuess': 'Sin respuesta',
  'label.distance': 'Distancia',
  'label.country': 'País',
  'label.player': 'Jugador',
  'label.timePerRound': 'Tiempo por ronda',
  'label.xp': 'XP',
  'label.rankedDuels': 'Duelos clasificatorios',
  'label.games': 'Partidas',
  'label.recentGames': 'Partidas recientes',
  'label.score': 'Puntuación',
  'label.places': 'Lugares',
  'label.level': 'Nivel',
  'label.streak': 'Racha',
  'label.chat': 'Chat',

  // Marcas junto a un nombre o una puntuación
  'tag.you': 'tú',
  'tag.host': 'anfitrión',
  'tag.won': 'ganó',
  'tag.away': 'ausente',
  'tag.hint': 'pista',

  // Leagues, lowest first. The server sends the English name; `league.<name>` is how it is shown
  'league.Trekker': 'Senderista',
  'league.Explorer': 'Explorador',
  'league.Voyager': 'Viajero',
  'league.Nomad': 'Nómada',
  'league.Legend': 'Leyenda',

  // La barra lateral
  'nav.group.solo': 'Solo',
  'nav.group.online': 'En línea',
  'nav.group.party': 'Salas',
  'nav.group.community': 'Comunidad',
  'nav.item.singleplayer': 'Un jugador',
  'nav.item.streak': 'Racha de países',
  'nav.item.daily': 'Desafío diario',
  'nav.item.ranked': 'Duelo clasificatorio',
  'nav.item.unranked': 'Partida normal',
  'nav.item.team': 'Partida 2v2',
  'nav.item.create': 'Crear sala',
  'nav.item.join': 'Unirse a una sala',
  'nav.item.maps': 'Mapas',
  'nav.item.leaderboards': 'Rankings',
  'nav.item.friends': 'Amigos',
  'nav.item.account': 'Cuenta',
  'nav.item.moderation': 'Moderación',

  // Mapas oficiales
  'map.world': 'Mundo',
  'map.europe': 'Europa',
  'map.americas': 'América',
  'map.asia-oceania': 'Asia y Oceanía',
  'map.africa': 'África',
  'map.community': 'Mapa de la comunidad',
  'map.tooFewPlaces.one': '{name} tiene {count} lugar. Elige menos rondas.',
  'map.tooFewPlaces.other': '{name} tiene {count} lugares. Elige menos rondas.',

  // Ajustes de la partida: un modo como opción, y dentro de una línea de ajustes como "Mundo · 5 rondas · 1 min · con movimiento"
  'mode.move': 'Con movimiento',
  'mode.no-move': 'Sin movimiento',
  'mode.nmpz': 'Sin movimiento, giro ni zoom',
  'settings.mode.move': 'con movimiento',
  'settings.mode.no-move': 'sin movimiento',
  'settings.mode.nmpz': 'sin movimiento, giro ni zoom',
  'settings.rounds.one': '{count} ronda',
  'settings.rounds.other': '{count} rondas',
  'time.0': 'Sin límite',

  // Cargar una partida, y no poder cargarla
  'load.places': 'Cargando lugares',
  'load.failed': 'No se pudo cargar la partida. Revisa tu conexión y vuelve a intentarlo.',
  'error.unreachable': 'No se pudo contactar con el servidor. Revisa tu conexión y vuelve a intentarlo.',
  'error.unexpected': 'El servidor envió una respuesta que esta página no pudo leer. Vuelve a intentarlo en un momento.',

  // Lo que dice el resumen sobre guardar una partida terminada
  'save.xp': '+{xp} XP.',
  'save.tutorial': 'Esto era el tutorial. No se guarda ni cuenta para las estadísticas.',
  'save.game.signedOut': 'Inicia sesión desde la pantalla de inicio para conservar tus estadísticas.',
  'save.game.failed': 'Esta partida no se pudo guardar en tus estadísticas.',
  'save.game.saved': 'Guardada en las estadísticas de {name}.',
  'save.game.recount.one': 'El servidor la contó como {count} punto.',
  'save.game.recount.other': 'El servidor la contó como {count} puntos.',
  'save.daily.signedOut': 'No has iniciado sesión, así que este resultado no aparece en el ranking.',
  'save.daily.failed': 'Este resultado no se pudo añadir al ranking.',
  'save.daily.saved': 'En el ranking de hoy como {name}.',
  'save.daily.firstStays': 'Tu primer resultado de hoy sigue en el ranking como el de {name}.',
  'save.streak.signedOut': 'Inicia sesión desde la pantalla de inicio para conservar tu mejor racha.',
  'save.streak.failed': 'Esta racha no se pudo guardar.',
  'save.streak.best': 'Tu mejor racha es de {streak}.',

  // El guía del tutorial
  'tutorial.label': 'Tutorial',
  'tutorial.hide': 'Ocultar consejos',
  'tutorial.tip.look': 'Mira a tu alrededor: arrastra la imagen con el ratón o con un dedo.',
  'tutorial.tip.move': 'Avanza por la calle: haz clic en una flecha del camino o pulsa la tecla de flecha arriba.',
  'tutorial.tip.map': 'Ahora el mapa. Pasa el puntero sobre él en la esquina o, en un teléfono, pulsa Abrir mapa.',
  'tutorial.tip.pin': 'Haz clic en el mapa donde creas que estás. Acerca con + para afinar.',
  'tutorial.tip.guess': '¿Te convence el marcador? Pulsa Adivinar. Antes puedes moverlo.',
  'tutorial.tip.result': 'La línea discontinua muestra cuánto te desviaste: cuanto más corta, más puntos. Pulsa Siguiente ronda.',
  'tutorial.tip.solo': 'Este lugar lo encuentras tú. No hay más consejos.',

  // Cómo terminó una partida
  'outcome.cancelled': 'La partida se canceló antes de empezar.',
  'outcome.draw': 'Empate.',
  'outcome.yourTeam': 'Ganó tu equipo.',
  'outcome.otherTeam': 'Ganó el otro equipo.',
  'outcome.you': 'Ganaste.',
  'outcome.won.one': '{names} ganó.',
  'outcome.won.other': '{names} ganaron.',

  // Lo que impide guardar el borrador de un mapa
  'draft.name': 'Ponle al mapa un nombre de {min} a {max} caracteres.',
  'draft.description': 'Ponle al mapa una descripción corta de {min} a {max} caracteres.',
  'draft.places': 'Un mapa necesita al menos {min} lugares. Añade {missing} más.',

  // De quién es una imagen, bajo el resultado de una ronda
  'credit.google': 'Imágenes {copyright}',
  'credit.panoramax': 'Foto de {name}, {licence}, vía Panoramax',
  'credit.contributor': 'un colaborador de Panoramax',
  'credit.openLicence': 'licencia abierta',

  // La pantalla de la ronda: indicadores, herramientas de la vista de calle, el botón Adivinar
  'round.time': 'Tiempo',
  'round.exit': 'Salir',
  /** la letra en la aguja de la brújula */
  'round.north': 'N',
  'round.placePin': 'Coloca tu marcador',
  'round.guess': 'Adivinar',
  'round.openMap': 'Abrir mapa',
  'round.closeMap': 'Cerrar mapa',
  'round.returnToStart': 'Volver al punto inicial',
  'round.hint': 'Pista (mitad de puntos)',
  'round.hintShown': 'Pista mostrada',
  'round.hintTitle': 'Dibuja en el mapa un círculo que contiene el lugar. Reduce a la mitad los puntos de esta ronda.',
  /** el crédito de las imágenes cuando no se pudo usar la primera opción de imágenes */
  'round.creditStandIn': '{credit} (hoy, en sustitución)',

  // Las herramientas del mapa de respuesta
  'guessMap.zoom': 'Zoom',
  'guessMap.zoomIn': 'Acercar',
  'guessMap.zoomOut': 'Alejar',
  'guessMap.size': 'Tamaño del mapa',
  'guessMap.size.small': 'Mapa pequeño',
  'guessMap.size.medium': 'Mapa mediano',
  'guessMap.size.large': 'Mapa grande',
  'guessMap.marker': 'Marcador del mapa',

  // La vista de calle
  'pano.blocked': 'Por ahí no se puede pasar',
  'pano.loading': 'Cargando...',
  'provider.panoramaxCredit': 'Imágenes: colaboradores de Panoramax',

  // Una partida local
  'play.again': 'Jugar de nuevo',
  'play.keepPlaying': 'Seguir jugando',
  'play.skipPlace': 'Saltar este lugar',
  'play.viewFailed': 'Esta vista no se cargó. Revisa tu conexión y vuelve a intentarlo.',
  'play.findingAnother': 'Buscando otro lugar',
  'play.noSpare': 'No hay otro lugar al que cambiar en esta partida.',
  'play.leaveConfirm': '¿Salir de esta partida? Las rondas que has jugado no se guardarán.',
  'play.leave': 'Salir de la partida',
  'play.tooFewPlaces.one': '{name} tiene {count} lugar, insuficiente para {rounds} rondas. Vuelve a empezarla con menos.',
  'play.tooFewPlaces.other': '{name} tiene {count} lugares, insuficientes para {rounds} rondas. Vuelve a empezarla con menos.',
  'play.communityUnavailable':
    'Este mapa está hecho de lugares de Google Street View, que ahora mismo no se pueden mostrar, así que no se puede jugar. Vuelve a intentarlo más tarde.',

  // El panel tras una ronda
  'result.label': 'Resultado de la ronda',
  'result.openInMaps': 'Abrir en Google Maps',
  'result.timedOut': 'Se acabó el tiempo antes de que colocaras un marcador.',
  'result.hinted': 'Usaste la pista, así que esta ronda valió la mitad.',
  'result.next': 'Siguiente ronda',
  'result.seeSummary': 'Ver resumen',

  // El panel tras una partida
  'summary.label': 'Resumen de la partida',
  'summary.finalScore': 'Puntuación final',
  'summary.share': 'Envía el enlace a un amigo y le tocarán los mismos lugares.',
  'summary.copyLink': 'Copiar enlace del desafío',
  'summary.linkLabel': 'Enlace del desafío',

  // Una racha de países
  'streakPlay.notInCountry': 'Eso no está en ningún país',
  'streakPlay.guessCountry': 'Adivinar: {country}',
  'streakPlay.correct': 'Correcto',
  'streakPlay.correctCountry': 'Correcto: {country}',
  'streakPlay.nextFailed': 'No se pudo cargar el siguiente lugar. Revisa tu conexión y vuelve a intentarlo.',
  'streakPlay.endConfirm': '¿Terminar ahora? Tu racha de {streak} se conserva.',
  'streakPlay.end': 'Terminar racha',
  'streakPlay.overLabel': 'Fin de la racha',
  /** tras el número de la racha, que se dibuja en grande a su lado */
  'streakPlay.countries.one': 'país',
  'streakPlay.countries.other': 'países',
  'streakPlay.unbeaten': '{streak} seguidos, y esos son todos los lugares de esta racha.',
  'streakPlay.wrong': 'Era {answer}. Dijiste {guess}.',
  'streakPlay.noPick': 'Era {answer}. No elegiste ningún país.',

  // Una partida guardada, ronda a ronda
  'history.title': 'Partida',
  'history.back': 'Volver a la cuenta',
  'history.loading': 'Cargando la partida',
  'history.daily': 'desafío diario',
  'history.mapLabel': 'Mapa de los lugares y tus respuestas',
  'history.noMap': 'Esta partida se guardó antes de que se conservaran los lugares, así que no tiene mapa.',

  // Las gráficas de progreso
  'chart.label': 'Progreso',
  'chart.title': 'Progreso',
  'chart.empty': 'Aún no hay suficiente historial para dibujarlo. Se añade un punto por cada día en que cambia el XP o la clasificación.',
  'chart.summary': '{name} del {first} al {last}: mínimo {min}, máximo {max}, ahora {now}',

  // Cifras, la barra de nivel y la tabla de partidas de una cuenta o un perfil
  'stats.xp': '{xp} XP',
  'stats.toLevel': '{xp} para el nivel {level}',
  'stats.levelProgress': 'Progreso hacia el siguiente nivel',
  'stats.date': 'Fecha',
  'stats.mode.move': 'Movimiento',
  'stats.mode.no-move': 'Sin movimiento',
  'stats.mode.nmpz': 'NMPZ',
  'stats.openRounds.one': 'Rondas de la partida del {day}, {count} punto',
  'stats.openRounds.other': 'Rondas de la partida del {day}, {count} puntos',

  // Una partida en línea: cargarla, la ronda, salir de ella
  'match.multiplayer': 'Multijugador',
  'match.loading': 'Cargando la partida',
  'match.loadFailed': 'No se pudo cargar la partida. Revisa tu conexión y vuelve a intentarlo.',
  'match.placesFailed': 'No se pudieron cargar los lugares. Revisa tu conexión y vuelve a intentarlo.',
  'match.loadingPlaces': 'Cargando los lugares',
  'match.waitingForPlaces': 'Esperando los lugares',
  'match.roundStartsIn': 'La ronda empieza en {seconds}',
  'match.viewMissing': 'Este lugar no se puede mostrar en este dispositivo. Aun así puedes adivinar.',
  'match.waitForStart': 'Espera a que empiece',
  'match.guessSent': 'Respuesta enviada',
  'match.timeUp': 'Se acabó el tiempo',
  'match.leaveConfirm': '¿Salir de esta partida? No podrás volver a ella.',
  'match.stay': 'Quedarme',
  'match.reportConfirm': '¿Reportar a {name} ante los moderadores?',

  // Una partida en línea: la vida, quién ha respondido, la tabla de la ronda, las posiciones
  'match.health': 'Vida',
  'match.healthOf': 'Vida de {name}',
  'match.nameYou': '{name} (tú)',
  'match.roster.label': 'Respuestas de esta ronda',
  'match.status.guessed': 'respondió',
  'match.status.guessing': 'adivinando',
  'match.status.away': 'ausente',
  'match.players': 'Jugadores',
  'match.total': 'Total',
  'match.roundResult': 'Resultado de la ronda',
  'match.roundOf': 'Ronda {round} de {rounds}',
  'match.nextRoundIn': 'Siguiente ronda en {seconds}',
  'match.finalIn': 'Posiciones finales en {seconds}',
  'match.finalStanding': 'Posiciones finales',
  'match.tag.left': 'salió',
  'match.join.label': 'Te unes a una partida en curso',
  'match.join.title': 'Una partida en curso',
  'match.join.round': 'Entras en la ronda {round}',
  'match.join.story': 'Las rondas anteriores cuentan como cero para ti. Así van los demás.',

  // Equipos en una partida 2v2
  'team.heading': 'Equipo',
  'team.tableLabel': 'Equipos',
  'team.name': 'Equipo {number}',
  'team.nameYours': 'Equipo {number} (el tuyo)',
  'team.yours': 'tuyo',

  // El lobby de una sala
  'lobby.title': 'Sala',
  'lobby.copyLink': 'Copiar enlace para unirse',
  'lobby.joinLink': 'Enlace para unirse',
  'lobby.playerCount': '{count} de {max}',
  'lobby.settings': 'Ajustes',
  'lobby.start': 'Empezar partida',
  'lobby.leave': 'Salir de la sala',
  'lobby.hint.ready': 'Todos los presentes juegan. Empieza cuando quieras.',
  'lobby.hint.needPlayers': 'Una partida necesita al menos dos jugadores. Comparte el código o el enlace.',
  'lobby.hint.waiting': 'Esperando a que el anfitrión empiece la partida.',
  'lobby.invite.title': 'Invitar amigos',
  'lobby.invite.none': 'Desde aquí puedes invitar a los amigos que añadas en el panel Amigos.',
  'lobby.invite.allHere': 'Todos tus amigos están aquí.',
  'lobby.invite.failed': 'No se pudieron cargar tus amigos.',
  'lobby.invite.button': 'Invitar',
  'lobby.invite.label': 'Invitar a {name}',
  'lobby.invite.sent': 'Enviada',

  // El chat en un lobby y sobre una partida
  'chat.messages': 'Mensajes',
  'chat.empty': 'Nadie ha dicho nada todavía.',
  'chat.message': 'Mensaje',
  'chat.placeholder': 'Di algo',
  'chat.send': 'Enviar',
  'chat.reactions': 'Reacciones',
  'chat.close': 'Cerrar chat',
  'chat.unread.one': '{count} nuevo',
  'chat.unread.other': '{count} nuevos',

  // Los paneles de emparejamiento: qué es cada tipo, y la espera
  'queue.ranked.lede':
    'Un rival, y vida en lugar de un total. Cada uno empieza con 5000; en cada ronda, quien saca menos puntos pierde la diferencia. Termina cuando uno se queda sin vida, o tras cinco rondas.',
  'queue.ranked.facts': '1 v 1 · Mundo · con movimiento · hasta 5 rondas · 1 min por ronda · con clasificación',
  'queue.unranked.lede':
    'Una partida pública para quien esté buscando. Cuando aparece un segundo jugador empieza una cuenta regresiva de diez segundos, y quien se una antes de que termine entra, hasta un máximo de diez. Si ya hay una partida en curso con sitio y rondas por jugar, entras en ella y juegas desde su siguiente ronda. Gana el total más alto tras cinco rondas.',
  'queue.unranked.facts': 'De 2 a 10 jugadores · Mundo · con movimiento · 5 rondas · 45 s por ronda · sin clasificación',
  'queue.team.lede':
    'Cuatro jugadores en dos equipos, cada uno con 5000 de vida compartida. En cada ronda, cada equipo obtiene los puntos de su mejor jugador, y el que saca menos pierde la diferencia y tres décimas partes más. Termina cuando un equipo se queda sin vida, o tras cinco rondas.',
  'queue.team.facts': '2 v 2 · Mundo · con movimiento · hasta 5 rondas · 1 min por ronda · sin clasificación',
  'queue.yourRating': 'Tu clasificación: {rating}',
  'queue.find': 'Buscar partida',
  'queue.joining': 'Entrando en la cola',
  'queue.looking': 'Buscando jugadores',
  'queue.startingIn': 'Empieza en {seconds}',
  'queue.waiting.one': '{count} jugador esperando',
  'queue.waiting.other': '{count} jugadores esperando',
  'queue.ranOut': 'La búsqueda terminó sin encontrar partida. Vuelve a empezarla.',

  // Crear una sala y unirse a una
  'party.create.lede': 'Una partida privada para entre dos y cuarenta jugadores. Tú eliges los ajustes, compartes el código y la empiezas cuando estén todos.',
  'party.create.facts': 'De 2 a 40 jugadores · cualquier mapa · tus reglas · sin clasificación',
  'party.create.submit': 'Crear sala',
  'party.join.lede': 'Escribe el código de seis caracteres del anfitrión. Un enlace para unirse lo rellena por ti.',
  'party.join.facts': 'La partida privada de un amigo · sus reglas · sin clasificación',
  'party.join.submit': 'Unirse a la sala',
  'party.join.empty': 'Escribe el código que te dio el anfitrión.',

  // El panel Amigos
  'friends.lede': 'Añade jugadores por su nombre de usuario, mira quién está en línea o en una sala y acepta invitaciones.',
  'friends.what': 'Una lista de amigos',
  'friends.add.label': 'Añadir un amigo por nombre de usuario',
  'friends.add.submit': 'Enviar solicitud',
  'friends.empty': 'Aún no hay amigos. Envía una solicitud por nombre de usuario; a esa persona le aparecerá aquí para aceptarla.',
  'friends.invites': 'Invitaciones a salas',
  'friends.invitedYou': 'te invitó',
  'friends.joinPartyOf': 'Unirse a la sala de {name}',
  'friends.requests': 'Solicitudes',
  'friends.accept': 'Aceptar',
  'friends.acceptName': 'Aceptar a {name}',
  'friends.decline': 'Rechazar',
  'friends.declineName': 'Rechazar a {name}',
  'friends.list': 'Amigos',
  'friends.level': 'nivel {level}',
  'friends.removeName': 'Eliminar a {name}',
  'friends.sent': 'Enviada, pendiente',
  'friends.cancelRequest': 'Cancelar la solicitud a {name}',

  // El panel Rankings
  'leaderboards.lede': 'Los cien mejores jugadores por clasificación, por XP y por racha de países más larga: desde siempre, o por lo que han ganado hoy.',
  'leaderboards.board': 'Tabla',
  'leaderboards.tab.rating': 'Clasificación',
  'leaderboards.tab.xp': 'XP',
  'leaderboards.tab.streak': 'Mejor racha',
  'leaderboards.column.rating': 'Clasif.',
  'leaderboards.column.xp': 'XP',
  'leaderboards.column.streak': 'Racha',
  'leaderboards.loading': 'Cargando la tabla',
  'leaderboards.empty': 'Aún no hay nadie en esta tabla.',
  'leaderboards.yourPlace': 'Estás en el puesto {rank} con {value}.',

  // El perfil de un jugador
  'profile.loading': 'Cargando el perfil',
  'profile.since': 'Juega desde {date}',
  'profile.stats': 'Estadísticas de {name}',
  'profile.noGames': 'Aún no hay partidas.',
  'profile.report.open': 'Reportar jugador',
  'profile.report.placeholder': 'Qué hizo (opcional)',
  'profile.report.sent': 'Reportado. Un moderador lo revisará.',

  // El panel Moderación
  'moderation.lede': 'Mapas y jugadores que otros han reportado. Eliminar un mapa lo borra; un veto impide jugar en línea, no jugar en solitario.',
  'moderation.loading': 'Cargando los reportes',
  'moderation.maps.title': 'Mapas reportados',
  'moderation.maps.empty': 'No hay mapas pendientes de decisión.',
  'moderation.players.title': 'Jugadores reportados',
  'moderation.players.empty': 'No hay jugadores pendientes de decisión.',
  'moderation.by': 'de {maker}',
  'moderation.reports.one': '{count} reporte',
  'moderation.reports.other': '{count} reportes',
  'moderation.banned': 'vetado',
  'moderation.removeMap': 'Eliminar mapa',
  'moderation.removeMapLabel': 'Eliminar el mapa {name}',
  'moderation.dismiss': 'Descartar',
  'moderation.dismissLabel': 'Descartar los reportes sobre {name}',
  'moderation.ban': 'Vetar',
  'moderation.banLabel': 'Vetar a {name} del juego en línea',
  'moderation.unban': 'Levantar veto',
  'moderation.unbanLabel': 'Levantar el veto a {name}',

  // El armazón de la pantalla de inicio: la barra lateral y el aviso de partida sin terminar
  'home.nav': 'Principal',
  'home.menu': 'Menú',
  'home.install': 'Instalar Wherefall',
  'home.profile': 'Perfil',
  'home.waiting.one': '{count} pendiente',
  'home.waiting.other': '{count} pendientes',
  'home.resume.label': 'Partida sin terminar',
  'home.resume.text': 'Estás en una partida que no ha terminado.',
  'home.resume.rejoin': 'Volver a la partida',
  'home.resume.leave': 'Abandonarla',

  // Lo que comparten todos los paneles: el camino de vuelta, la comprobación de la cuenta y sus avisos
  'pane.back': 'Atrás',
  'pane.checkingAccount': 'Comprobando tu cuenta',
  'pane.needsAccount':
    '{what} requiere una cuenta, para que los demás jugadores vean contra quién juegan y tus resultados tengan dónde guardarse. Es gratis y solo pide un nombre de usuario y una contraseña.',
  'pane.banned': 'Esta cuenta tiene vetado el juego en línea: partidas, salas, chat, amigos y creación de mapas. Jugar en solitario sigue funcionando.',
  'pane.playSingleplayer': 'Jugar en solitario',

  // La introducción de la primera visita
  'intro.title': 'Cómo se juega',
  'intro.step.1': 'Apareces en algún lugar de la Tierra, a nivel de calle.',
  'intro.step.2': 'Mira a tu alrededor, recorre la calle si el modo lo permite y pon un marcador en el mapa donde creas que estás.',
  'intro.step.3': 'Cuanto más cerca quede el marcador, más te llevas de los 5000 puntos de cada ronda.',
  'intro.dismiss': 'Entendido',

  // Un jugador
  'singleplayer.lede': 'Cinco lugares, un marcador para cada uno, hasta 5000 puntos por ronda. Elige un mapa y la dificultad.',
  'singleplayer.challenge': 'Desafío',
  'singleplayer.challengeSent': 'Te enviaron un desafío',
  'singleplayer.playChallenge': 'Jugar desafío',
  'singleplayer.start': 'Empezar partida',
  /** `{panoramax}` y `{openfreemap}` son enlaces, cada uno con su propio nombre */
  'singleplayer.credits':
    'Jugar es gratis. Aquí la cuenta es opcional y guarda tus estadísticas. Imágenes de calle de Google Street View donde las hay; si no, de colaboradores de {panoramax} con licencias abiertas. Mapa de {openfreemap} y OpenStreetMap.',

  // Racha de países
  'streak.lede': 'Un lugar tras otro, en cualquier parte del mundo. Haz clic en el país donde está cada uno. El primer país equivocado termina la racha.',
  'streak.best': 'Tu mejor racha: {streak}',
  'streak.start': 'Empezar racha',
  'streak.fine': 'Con la sesión iniciada, tu mejor racha se conserva y cada país acertado da 20 XP.',

  // Desafío diario
  'daily.lede': 'Tres lugares, los mismos para todos, nuevos cada día a medianoche UTC.',
  'daily.loading': 'Cargando el desafío de hoy',
  'daily.today': 'Hoy',
  'daily.yourResult': 'Tu resultado de hoy',
  'daily.notPlayed': 'Hoy no has jugado. Tienes un solo intento.',
  'daily.firstCounts': 'Tienes un solo intento al día.',
  'daily.play': 'Jugar el desafío de hoy',
  'daily.againNote': 'Un solo intento al día. El próximo desafío se abre a medianoche UTC.',
  'daily.leaderboard': 'Ranking',
  'daily.todaysLeaderboard': 'Ranking de hoy',
  'daily.empty': 'Hoy aún no hay resultados. El primero que llegue se pone en cabeza.',

  // Cuenta: el formulario de inicio de sesión
  'account.lede': 'Tu nivel, tus estadísticas y tus partidas, en todos los dispositivos donde inicies sesión. Jugar en solitario sin cuenta sigue siendo gratis.',
  'account.loading': 'Cargando la cuenta',
  'account.login.name': 'Iniciar sesión',
  'account.login.busy': 'Iniciando sesión',
  'account.register.name': 'Crear cuenta',
  'account.register.busy': 'Creando cuenta',
  'account.username': 'Nombre de usuario',
  'account.password': 'Contraseña',
  'account.usernameHint': 'De 3 a 20 letras, números o guiones bajos sueltos, nunca al principio ni al final.',
  'account.passwordHint': 'Al menos 8 caracteres. Al crear la cuenta recibes un código de recuperación: una forma de volver a entrar si olvidas la contraseña.',
  'account.missing': 'Escribe un nombre de usuario y una contraseña.',

  // Cuenta: un jugador con la sesión iniciada
  'account.signedInAs': 'Sesión iniciada como',
  'account.signOut': 'Cerrar sesión',
  'account.stats': 'Tus estadísticas',
  'account.averageRound': 'Media por ronda',
  'account.bestRound': 'Mejor ronda',
  'account.perfectRounds': 'Rondas perfectas',
  'account.bestGame': 'Mejor partida',
  'account.ofMax': 'de {max}',
  'account.noGames': 'Aún no hay partidas. Termina una partida con la sesión iniciada y se guardará aquí.',
  'account.tutorialNote': 'Dos rondas guiadas en lugares famosos. Nunca cuenta para tus estadísticas.',
  'account.newUsername': 'Nuevo nombre de usuario',
  'account.rename': 'Cambiar nombre de usuario',
  'account.renameHint': 'De 3 a 20 letras, números o guiones bajos sueltos, nunca al principio ni al final. Se puede cambiar una vez cada 30 días.',
  'account.renameEmpty': 'Escribe el nombre de usuario que quieres.',

  // Ajustes guardados en este navegador
  'prefs.units': 'Distancias en',
  'prefs.units.km': 'Kilómetros',
  'prefs.units.mi': 'Millas',
  'prefs.sound': 'Sonido',
  'prefs.sound.on': 'Activado',
  'prefs.sound.off': 'Desactivado',

  // Mapas
  'maps.lede': 'Juega un mapa oficial o uno que otro jugador hizo con lugares que eligió. Crea el tuyo con cualquier lugar que tenga Street View.',
  'maps.search': 'Buscar mapas',
  'maps.places.one': '{count} lugar',
  'maps.places.other': '{count} lugares',
  'maps.plays.one': '{count} partida',
  'maps.plays.other': '{count} partidas',
  'maps.likes.one': '{count} me gusta',
  'maps.likes.other': '{count} me gusta',
  'maps.official': 'Mapas oficiales',
  'maps.loadingOfficial': 'Cargando los mapas oficiales',
  'maps.officialFailed': 'No se pudieron cargar los mapas oficiales.',
  'maps.noOfficial': 'No hay ningún mapa oficial con ese nombre.',
  'maps.allCountries.one': '{count} país',
  'maps.allCountries.other': 'Los {count} países',
  'maps.choose': 'Elegir',
  'maps.chooseMap': 'Elegir {name}',
  /** `{maker}` es un enlace al perfil del autor */
  'maps.by': 'de {maker}',
  'maps.edit': 'Editar',
  'maps.loading': 'Cargando mapas',
  'maps.showMore': 'Mostrar más',
  'maps.showMoreOf': 'Mostrar más: {list}',
  'maps.popular': 'Mapas populares de la comunidad',
  'maps.popularEmpty': 'Nadie ha creado un mapa todavía. El tuyo podría ser el primero.',
  'maps.newest': 'Mapas nuevos de la comunidad',
  'maps.newestEmpty': 'Aún no hay nada nuevo.',
  'maps.mine': 'Mis mapas',
  'maps.mineEmpty': 'Aún no has creado ningún mapa.',
  'maps.matching': 'Mapas de la comunidad que coinciden con «{query}»',
  'maps.noCommunity': 'Ningún mapa de la comunidad coincide.',

  // La página de un mapa de la comunidad
  'mapPage.loading': 'Cargando el mapa',
  /** `{maker}` es un enlace al perfil del autor */
  'mapPage.byline': 'Mapa de la comunidad de {maker} · creado el {date}',
  'mapPage.inNumbers': '{name} en cifras',
  'mapPage.plays': 'Partidas',
  'mapPage.likes': 'Me gusta',
  'mapPage.noGoogle':
    'Los mapas de la comunidad están hechos de lugares de Google Street View. Este sitio no tiene configuradas las imágenes de Google en este momento, así que el mapa no se puede jugar ni ver en vista previa aquí.',
  'mapPage.play': 'Jugar este mapa',
  'mapPage.party': 'Crear sala con este mapa',
  'mapPage.like': 'Me gusta',
  'mapPage.unlike': 'Ya no me gusta',
  'mapPage.preview': 'Dónde están los lugares de {name}',
  'mapPage.reportThis': 'Reportar este mapa',
  'mapPage.reportReason': 'Qué problema tiene (opcional)',
  'mapPage.reported': 'Reportado. Alguien lo revisará.',
  'mapPage.yours': 'Tu mapa',
  'mapPage.delete': 'Borrar mapa',
  'mapPage.deleteConfirm': '¿Borrarlo para siempre?',
  'mapPage.deleteYes': 'Sí, borrarlo',
  'mapPage.deleteNo': 'Conservarlo',

  // El editor de mapas
  'editor.lede': 'Haz clic en cualquier punto del mapamundi para añadir el lugar más cercano que tenga Street View, o pega una lista de lugares. Con cinco lugares ya hay mapa; el máximo es cinco mil.',
  /** lo que el aviso de inicio de sesión dice que requiere una cuenta: "{what} requiere una cuenta, …" */
  'editor.what': 'Crear un mapa',
  'editor.loading': 'Cargando el editor',
  'editor.loadFailed': 'No se pudo cargar el editor. Revisa tu conexión y vuelve a intentarlo.',
  'editor.needsGoogle':
    'Crear mapas requiere imágenes de Google Street View: cada lugar en el que haces clic se asocia al panorama de Street View más cercano, y eso es lo que se juega. Este sitio no tiene configuradas las imágenes de Google en este momento, así que aquí no se pueden crear ni cambiar mapas.',
  'editor.backToMaps': 'Volver a los mapas',
  'editor.loadingMap': 'Cargando tu mapa',
  'editor.notYours': 'Este mapa lo hizo otra persona, así que no se puede cambiar desde tu cuenta.',
  'editor.name': 'Nombre',
  'editor.description': 'Descripción corta',
  'editor.mapLabel': 'Mapamundi: haz clic para añadir un lugar',
  'editor.clickToAdd': 'Haz clic en el mapa para añadir un lugar.',
  /** cuántos lugares tiene el mapa, tras la palabra "Lugares": "Lugares · 12 de 500" */
  'editor.placesOf': '{placed} de {max}',
  'editor.removePlace': 'Eliminar el lugar {number}, {country}',
  'editor.looking': 'Buscando Street View ahí',
  'editor.none': 'No hay Street View a menos de 500 m de ese punto.',
  'editor.noCountry': 'Ese Street View no está en ningún país, así que no se puede añadir.',
  'editor.full': 'El mapa está lleno.',
  'editor.duplicate': 'Ese lugar ya está en el mapa.',
  'editor.added': 'Se añadió un lugar en {country}.',
  'editor.unreachable': 'No se pudo conectar con Street View. Prueba ese punto de nuevo en un momento.',
  'editor.publish': 'Publicar mapa',
  'editor.save': 'Guardar cambios',

  // La elección de mapa en los ajustes de una partida
  'picker.loading': 'Cargando los demás mapas',
  'picker.failed': 'No se pudieron cargar los demás mapas. El mapa del mundo sigue funcionando.',
  'picker.aCountry': 'Un país',
  'picker.countries': 'Países',
  'picker.noCountry': 'Ningún país con ese nombre tiene suficientes lugares todavía.',
  'picker.places.one': '{count} lugar',
  'picker.places.other': '{count} lugares',
};
