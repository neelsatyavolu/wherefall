import type { daily as english } from '../en/daily.ts';
import type { Part } from '../index.ts';

/** Wave 5: the daily challenge. Every key of `../en/daily.ts`, or the type check fails. */
export const daily: Part<typeof english> = {
  'daily.rule': 'Sans indice. Un seul essai par jour.',
  'daily.next': 'Prochain défi dans',

  'daily.visitor.open':
    'Vous n’êtes pas connecté. Vous pouvez jouer une fois aujourd’hui. Le résultat est conservé dans ce navigateur, hors classement, et rejoint votre compte si vous en créez un. {signIn}.',
  'daily.visitor.done': 'Ce résultat est conservé dans ce navigateur, hors classement. Créez un compte et il y sera ajouté. {signIn}.',
  'daily.started': 'Vous avez commencé le défi du jour et l’avez quitté avant la fin : l’essai d’aujourd’hui est utilisé. Un nouveau défi vous attend demain.',
  'daily.claimFailed': 'Les résultats joués avant votre connexion n’ont pas pu être ajoutés à votre compte.',
  'daily.rank': 'Rang',
  'daily.beat': 'Mieux que {share} des joueurs',

  'daily.record': 'Vos chiffres au défi du jour',
  'daily.days.one': '{count} jour',
  'daily.days.other': '{count} jours',
  'daily.streak.best': 'Record : {days}',
  'daily.streak.risk': 'en danger',
  'daily.streak.start': 'Jouez aujourd’hui pour en commencer une.',
  'daily.streak.atRisk': 'Jouez aujourd’hui pour la garder.',
  'daily.streak.spent': 'Aujourd’hui ne comptera pas. Un jour manqué sur sept est pardonné.',
  'daily.streak.kept': 'À l’abri pour aujourd’hui.',
  'daily.played': 'Joués',
  'daily.best': 'Meilleur score',
  'daily.average': 'Moyenne',
  'daily.history': 'Les 14 derniers jours',
  'daily.history.played': '{date} : score {score}',
  'daily.history.missed': '{date} : non joué',
  'daily.history.open': 'Aujourd’hui : pas encore joué',
  'daily.history.todayPlayed': 'Aujourd’hui : score {score}',

  'daily.distribution': 'Scores du jour',
  'daily.distribution.bar.one': 'De {from} à {to} : {count} joueur',
  'daily.distribution.bar.other': 'De {from} à {to} : {count} joueurs',

  'daily.page': 'Page {page}',
  'daily.previous': 'Précédente',
  'daily.nextPage': 'Suivante',

  'daily.nav.open': 'Pas encore joué aujourd’hui',
  'daily.nav.atRisk': 'Série en danger',
  'daily.nav.done': 'Joué aujourd’hui',

  'daily.leaveConfirm': 'Quitter le défi du jour ? Vous avez un seul essai par jour, et quitter l’utilise.',
  'daily.summary.share': 'Tout le monde a les trois mêmes lieux aujourd’hui. Partager votre résultat n’en dévoile aucun.',
  'daily.kept': 'Il est conservé dans ce navigateur et rejoint votre compte si vous en créez un.',
  'daily.share.title': 'Défi du jour Wherefall · {date}',

  'daily.personalBest': 'Record personnel',
  'daily.average.title': 'Face à la moyenne du jour',
  'daily.average.above': '{points} au-dessus de la moyenne',
  'daily.average.below': '{points} en dessous de la moyenne',
  'daily.average.level': 'Pile dans la moyenne',
  'daily.visitor.unclaimable': 'Ce résultat est conservé dans ce navigateur, hors classement. Il a été joué avant que les résultats puissent rejoindre un compte : il reste ici.',

  'daily.stale.note': 'Wherefall a été mis à jour pendant votre partie : ce résultat n’a pas pu être enregistré.',
  'daily.stale.explain':
    'La mise à jour a changé les trois lieux du jour, et cette partie s’est jouée sur les précédents. Rechargez pour obtenir la nouvelle version. L’essai d’aujourd’hui est utilisé : le défi ne peut plus être joué aujourd’hui. Le prochain ouvre à minuit UTC.',
  'daily.stale.reload': 'Recharger',
  'daily.stale.spent': 'Le résultat d’aujourd’hui n’a pas pu être enregistré : Wherefall a été mis à jour pendant votre partie, et la mise à jour a changé les lieux du jour. L’essai d’aujourd’hui est utilisé. Un nouveau défi vous attend demain.',
};
