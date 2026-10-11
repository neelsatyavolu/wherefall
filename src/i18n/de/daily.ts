import type { daily as english } from '../en/daily.ts';
import type { Part } from '../index.ts';

/** Wave 5: the daily challenge. Every key of `../en/daily.ts`, or the type check fails. */
export const daily: Part<typeof english> = {
  'daily.rule': 'Keine Hinweise. Ein Versuch pro Tag.',
  'daily.next': 'Nächste Challenge in',

  'daily.visitor.open':
    'Du bist nicht angemeldet. Du kannst heute einmal spielen. Das Ergebnis bleibt in diesem Browser, außerhalb der Rangliste, und wandert in dein Konto, wenn du eines erstellst. {signIn}.',
  'daily.visitor.done': 'Dieses Ergebnis ist in diesem Browser gespeichert, außerhalb der Rangliste. Erstelle ein Konto, dann wird es dorthin übernommen. {signIn}.',
  'daily.started': 'Du hast die heutige Challenge begonnen und vor dem Ende verlassen. Damit ist der heutige Versuch verbraucht. Morgen wartet eine neue.',
  'daily.claimFailed': 'Die Ergebnisse, die du vor dem Anmelden gespielt hast, konnten nicht in dein Konto übernommen werden.',
  'daily.rank': 'Platz',
  'daily.beat': 'Besser als {share} der Spieler',

  'daily.record': 'Deine Bilanz der Tages-Challenge',
  'daily.days.one': '{count} Tag',
  'daily.days.other': '{count} Tage',
  'daily.streak.best': 'Rekord: {days}',
  'daily.streak.risk': 'in Gefahr',
  'daily.streak.start': 'Spiel heute, um eine zu beginnen.',
  'daily.streak.atRisk': 'Spiel heute, um sie zu halten.',
  'daily.streak.spent': 'Heute zählt nicht mehr. Ein verpasster Tag in sieben wird verziehen.',
  'daily.streak.kept': 'Für heute sicher.',
  'daily.played': 'Gespielt',
  'daily.best': 'Bestes Ergebnis',
  'daily.average': 'Durchschnitt',
  'daily.history': 'Die letzten 14 Tage',
  'daily.history.played': '{date}: Ergebnis {score}',
  'daily.history.missed': '{date}: nicht gespielt',
  'daily.history.open': 'Heute: noch nicht gespielt',
  'daily.history.todayPlayed': 'Heute: Ergebnis {score}',

  'daily.distribution': 'Ergebnisse von heute',
  'daily.distribution.bar.one': '{from} bis {to}: {count} Spieler',
  'daily.distribution.bar.other': '{from} bis {to}: {count} Spieler',

  'daily.page': 'Seite {page}',
  'daily.previous': 'Zurück',
  'daily.nextPage': 'Weiter',

  'daily.nav.open': 'Heute noch nicht gespielt',
  'daily.nav.atRisk': 'Serie in Gefahr',
  'daily.nav.done': 'Heute gespielt',

  'daily.leaveConfirm': 'Heutige Challenge verlassen? Du hast einen Versuch pro Tag, und mit dem Verlassen ist er verbraucht.',
  'daily.summary.share': 'Heute bekommen alle dieselben drei Orte. Dein geteiltes Ergebnis verrät keinen davon.',
  'daily.kept': 'Es bleibt in diesem Browser und wandert in dein Konto, wenn du eines erstellst.',
  'daily.share.title': 'Wherefall Tages-Challenge · {date}',

  'daily.personalBest': 'Persönlicher Rekord',
  'daily.average.title': 'Im Vergleich zum Tagesschnitt',
  'daily.average.above': '{points} über dem Schnitt',
  'daily.average.below': '{points} unter dem Schnitt',
  'daily.average.level': 'Genau im Schnitt',
  'daily.visitor.unclaimable': 'Dieses Ergebnis ist in diesem Browser gespeichert, außerhalb der Rangliste. Es wurde gespielt, bevor Ergebnisse in ein Konto übernommen werden konnten, und bleibt deshalb hier.',

  'daily.stale.note': 'Wherefall wurde aktualisiert, während du gespielt hast. Dieses Ergebnis konnte deshalb nicht gespeichert werden.',
  'daily.stale.explain':
    'Mit dem Update haben sich die drei Orte von heute geändert, und dieses Spiel lief noch mit den alten. Lade neu, um die neue Version zu bekommen. Der heutige Versuch ist verbraucht, die Challenge kann heute also nicht noch einmal gespielt werden. Die nächste öffnet um Mitternacht UTC.',
  'daily.stale.reload': 'Neu laden',
  'daily.stale.spent': 'Das heutige Ergebnis konnte nicht gespeichert werden: Wherefall wurde aktualisiert, während du gespielt hast, und mit dem Update haben sich die Orte von heute geändert. Der heutige Versuch ist verbraucht. Morgen wartet eine neue Challenge.',
};
