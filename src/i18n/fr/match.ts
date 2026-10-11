import type { match as english } from '../en/match.ts';
import type { Part } from '../index.ts';

/** Wave 5: guests, parties, 2v2, chat and the queues. Every key of `../en/match.ts`, or the type check fails. */
export const match: Part<typeof english> = {
  // Invités : jouer sans compte, et ce qu’un compte ajoute
  'guest.signUp': 'Créer un compte',
  'guest.label': 'Session d’invité',
  'guest.needsAccount':
    'Il faut un compte pour cela. Vous êtes ici en tant que {name}, un invité, et un invité ne peut plus jouer. Un compte conserve vos résultats et ouvre tous les modes, les amis, le chat et la création de cartes. C’est gratuit et il suffit d’un nom d’utilisateur et d’un mot de passe.',
  'guest.chatNote': 'Les invités peuvent envoyer des réactions. Pour écrire des messages, il faut un compte.',
  'session.ended': 'Vous n’êtes plus connecté.',

  // Un match : la session qui expire, et ce que propose l’écran final
  'match.sessionEnded': 'Vous n’êtes plus connecté et ne faites donc plus partie de ce match.',
  'match.guestEnded': 'Votre session d’invité est terminée et vous ne faites donc plus partie de ce match. Une session d’invité dure 24 heures.',
  'match.backToLobby': 'Retour au salon',
  'match.hostLobby': 'En retournant au salon, vous emmenez toutes les personnes encore présentes.',
  'match.stayForLobby': 'Restez sur cet écran pour rester dans le salon. L’hôte peut y ramener tout le monde.',
  'match.xpEarned': 'Vous avez gagné {xp} XP.',
  'match.xpEarnedRanked': 'Vous avez gagné {xp} XP. Les duels classés rapportent le double.',
  'match.roster.count': '{guessed} / {players} ont répondu',
  'match.reportSent': 'Vous avez signalé {name}. Un modérateur va examiner le signalement.',

  // L’écran avant la première manche d’un duel classé
  'versus.word': 'contre',
  'versus.label': 'Duel classé : {first} contre {second}',

  // Les files d’attente : l’attente, le blocage, le retour quand l’adversaire part
  'queue.ranked.xp': 'Les manches classées rapportent le double d’XP.',
  'queue.waited': 'En attente depuis {time}',
  'queue.window': 'Adversaires à ±{points} de votre cote',
  'queue.locked': 'Vous avez quitté deux duels classés avant leur début. Vous pourrez relancer une recherche dans {time}.',
  'queue.dodged': 'L’autre joueur est parti avant le début du match. Votre cote n’a pas changé et vous êtes de retour dans la file d’attente.',

  // Chat : mettre un joueur en sourdine
  'chat.mute.title': 'Mettre des joueurs en sourdine',
  'chat.mute.note': 'Ce que dit un joueur en sourdine vous est masqué jusqu’à la fin du match.',
  'chat.mute.tag': 'en sourdine',
  'chat.mute.button': 'Sourdine',
  'chat.mute.undo': 'Réactiver',
  'chat.mute.label': 'Mettre {name} en sourdine',
  'chat.mute.undoLabel': 'Réactiver {name}',

  // Wave 6
  'match.placesRefused': 'Les lieux tirés pour ce match n’ont pas été acceptés : {error}',
  'match.drawAgain': 'Tirer d’autres lieux',
  'match.removed.label': 'Exclu',
  'queue.typical': 'Attente habituelle : {wait}',
  'queue.typical.underMinute': 'en général moins d’une minute',
  'queue.typical.minutes.one': 'environ {count} minute',
  'queue.typical.minutes.other': 'environ {count} minutes',
  'queue.typical.none': 'aucune partie récente',
};
