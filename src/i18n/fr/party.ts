import type { party as english } from '../en/party.ts';
import type { Part } from '../index.ts';

/** Wave 5: party options, host controls, teams and 2v2. Every key of `../en/party.ts`, or the type check fails. */
export const party: Part<typeof english> = {
  'party.rounds.less': 'Moins de manches',
  'party.rounds.more': 'Plus de manches',
  'party.time.note': 'Sans limite, une manche se termine quand tout le monde a répondu ou quand l’hôte y met fin.',
  'party.communication': 'Communication',
  'party.communication.chat': 'Chat',
  'party.communication.reactions': 'Réactions seules',
  'party.communication.off': 'Aucune',
  'party.teams': 'Équipes',
  'party.teams.none': 'Sans équipes',
  'party.teams.best': 'Meilleure réponse',
  'party.teams.average': 'Moyenne',
  'party.teams.coop': 'Coopératif',
  'party.teams.note': 'Avec des équipes, les joueurs se répartissent en deux camps. Une équipe marque sa meilleure réponse de la manche, ou la moyenne de toutes ses réponses. En coopératif, tout le monde joue ensemble et une seule personne place la réponse qui compte.',

  'party.line.chat': 'chat',
  'party.line.reactions': 'réactions seules',
  'party.line.off': 'sans chat',
  'party.line.best': 'équipes à la meilleure réponse',
  'party.line.average': 'équipes à la moyenne',
  'party.line.coop': 'coopératif',

  'party.settings.change': 'Modifier les réglages',
  'party.settings.save': 'Enregistrer les réglages',
  'party.settings.form': 'Réglages du salon',
  'party.lock': 'Verrouiller le salon',
  'party.unlock': 'Déverrouiller le salon',
  'party.locked.tag': 'verrouillé',
  'party.locked.note': 'Ce salon est verrouillé. Personne d’autre ne peut y entrer.',
  'party.team.join': 'Rejoindre',
  'party.team.joinLabel': 'Rejoindre : {team}',
  'party.team.unseated': 'Pas encore d’équipe',
  'party.team.empty': 'Personne pour l’instant',
  'party.team.shuffle': 'Mélanger les équipes',
  'party.team.hint': 'Choisissez une équipe. Les joueurs sans équipe rejoignent la plus petite au lancement du match.',
  'party.pair.button': 'Chercher un 2v2 ensemble',
  'party.pair.note': 'À deux exactement, vous pouvez entrer dans la file du 2v2 en coéquipiers. Le salon se ferme.',
  'party.pair.queued': 'Vous et votre coéquipier êtes ensemble dans la file du 2v2.',

  'host.title': 'Hôte',
  'host.label': 'Commandes de l’hôte',
  'host.kick': 'Exclure',
  'host.kickLabel': 'Exclure {name}',
  'host.kickConfirm': 'Exclure {name} du salon ? Cette personne ne pourra pas revenir.',
  'host.kickYes': 'Exclure',
  'host.makeHost': 'Nommer hôte',
  'host.makeHostLabel': 'Nommer {name} hôte',
  'host.makePicker': 'Faire répondre',
  'host.makePickerLabel': 'Faire répondre {name}',
  'host.moreLabel': 'Actions pour {name}',
  'host.endRound': 'Terminer la manche',

  'party.noTimer.label': 'Pas de chrono',
  'party.noTimer': 'La manche se termine quand tout le monde a répondu, ou quand l’hôte y met fin.',
  'party.noTimerHost': 'La manche se termine quand tout le monde a répondu, ou quand vous y mettez fin.',

  'team.health': 'Vie des équipes',
  'team.healthLeft': '{health} de vie',

  'chat.scope': 'Envoyer à',
  'chat.scope.all': 'Tous',
  'chat.scope.team': 'Équipe',
  'chat.teamTag': 'équipe',

  // Wave 6

  // Co-op: who places the guess, in the lobby, over a round and at the end
  'tag.picker': 'répond',
  'coop.hint': 'Tout le monde joue ensemble. Une personne place la réponse qui compte, et les repères des autres sont des suggestions.',
  'coop.youPick': 'Vous placez la réponse pour tout le monde.',
  'coop.theyPick': '{name} place la réponse. Votre repère est une suggestion.',
  'coop.lock': '{name} répond',
  'outcome.coop': '{score} sur {max} ensemble.',
};
