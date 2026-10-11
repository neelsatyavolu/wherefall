import type { match as english } from '../en/match.ts';
import type { Part } from '../index.ts';

/** Wave 5: guests, parties, 2v2, chat and the queues. Every key of `../en/match.ts`, or the type check fails. */
export const match: Part<typeof english> = {
  // Gäste: ohne Konto spielen, und was ein Konto dazubringt
  'guest.signUp': 'Konto erstellen',
  'guest.label': 'Gastsitzung',
  'guest.needsAccount':
    'Dafür brauchst du ein Konto. Du bist als {name} hier, als Gast, und als Gast kannst du nicht mehr spielen. Ein Konto speichert deine Ergebnisse und öffnet alle Modi, Freunde, Chat und das Erstellen von Karten. Es ist kostenlos und braucht nur einen Benutzernamen und ein Passwort.',
  'guest.chatNote': 'Gäste können Reaktionen senden. Für Nachrichten brauchst du ein Konto.',
  'session.ended': 'Du bist nicht mehr angemeldet.',

  // Ein Match: die abgelaufene Sitzung, und was der Endstand anbietet
  'match.sessionEnded': 'Du bist nicht mehr angemeldet und damit nicht mehr in diesem Match.',
  'match.guestEnded': 'Deine Gastsitzung ist abgelaufen, damit bist du nicht mehr in diesem Match. Eine Gastsitzung dauert 24 Stunden.',
  'match.backToLobby': 'Zurück zur Lobby',
  'match.hostLobby': 'Zurück zur Lobby nimmt alle mit, die noch hier sind.',
  'match.stayForLobby': 'Bleib auf diesem Bildschirm, um in der Party zu bleiben. Der Host kann alle zurück in die Lobby holen.',
  'match.xpEarned': 'Du hast {xp} XP verdient.',
  'match.xpEarnedRanked': 'Du hast {xp} XP verdient. Wertungsduelle bringen das Doppelte.',
  'match.roster.count': '{guessed} / {players} haben getippt',
  'match.reportSent': 'Du hast {name} gemeldet. Die Moderation sieht es sich an.',

  // Der Bildschirm vor der ersten Runde eines Wertungsduells
  'versus.word': 'gegen',
  'versus.label': 'Wertungsduell: {first} gegen {second}',

  // Die Suche: das Warten, die Sperre, die Rückkehr, wenn der Gegner geht
  'queue.ranked.xp': 'Runden mit Wertung bringen doppelte XP.',
  'queue.waited': 'Wartezeit: {time}',
  'queue.window': 'Gegner innerhalb von ±{points} deiner Wertung',
  'queue.locked': 'Du hast zwei Wertungsduelle verlassen, bevor sie begannen. Du kannst in {time} wieder suchen.',
  'queue.dodged': 'Der andere Spieler ist gegangen, bevor das Match begann. Deine Wertung bleibt unverändert, und du bist wieder in der Suche.',

  // Chat: einen Spieler stummschalten
  'chat.mute.title': 'Spieler stummschalten',
  'chat.mute.note': 'Was ein stummgeschalteter Spieler sagt, wird dir für den Rest des Matches nicht angezeigt.',
  'chat.mute.tag': 'stumm',
  'chat.mute.button': 'Stumm',
  'chat.mute.undo': 'Aufheben',
  'chat.mute.label': '{name} stummschalten',
  'chat.mute.undoLabel': 'Stummschaltung von {name} aufheben',

  // Wave 6
  'match.placesRefused': 'Die für dieses Match gezogenen Orte wurden nicht angenommen: {error}',
  'match.drawAgain': 'Neue Orte ziehen',
  'match.removed.label': 'Entfernt',
  'queue.typical': 'Übliche Wartezeit: {wait}',
  'queue.typical.underMinute': 'meist unter einer Minute',
  'queue.typical.minutes.one': 'etwa {count} Minute',
  'queue.typical.minutes.other': 'etwa {count} Minuten',
  'queue.typical.none': 'zuletzt keine Spiele',
};
