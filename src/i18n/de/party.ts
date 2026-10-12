import type { party as english } from '../en/party.ts';
import type { Part } from '../index.ts';

/** Wave 5: party options, host controls, teams and 2v2. Every key of `../en/party.ts`, or the type check fails. */
export const party: Part<typeof english> = {
  'party.rounds.less': 'Weniger Runden',
  'party.rounds.more': 'Mehr Runden',
  'party.time.note': 'Ohne Limit endet eine Runde, wenn alle getippt haben oder der Host sie beendet.',
  'party.communication': 'Kommunikation',
  'party.communication.chat': 'Chat',
  'party.communication.reactions': 'Nur Reaktionen',
  'party.communication.off': 'Aus',
  'party.teams': 'Teams',
  'party.teams.none': 'Keine Teams',
  'party.teams.best': 'Bester Tipp',
  'party.teams.average': 'Durchschnitt',
  'party.teams.coop': 'Koop',
  'party.teams.note': 'Mit Teams teilen sich die Spieler in zwei Seiten auf. Ein Team bekommt für die Runde seinen besten Tipp oder den Durchschnitt aller seiner Tipps. Im Koop spielen alle zusammen, und eine Person gibt den Tipp ab, der zählt.',

  'party.line.chat': 'Chat',
  'party.line.reactions': 'nur Reaktionen',
  'party.line.off': 'kein Chat',
  'party.line.best': 'Teams nach bestem Tipp',
  'party.line.average': 'Teams nach Durchschnitt',
  'party.line.coop': 'Koop',

  'party.settings.change': 'Einstellungen ändern',
  'party.settings.save': 'Einstellungen speichern',
  'party.settings.form': 'Einstellungen der Party',
  'party.lock': 'Party sperren',
  'party.unlock': 'Party öffnen',
  'party.locked.tag': 'gesperrt',
  'party.locked.note': 'Diese Party ist gesperrt. Es kann niemand mehr beitreten.',
  'party.team.join': 'Beitreten',
  'party.team.joinLabel': '{team} beitreten',
  'party.team.unseated': 'Noch ohne Team',
  'party.team.empty': 'Noch niemand',
  'party.team.shuffle': 'Teams mischen',
  'party.team.hint': 'Wähle ein Team. Wer keins hat, kommt beim Start ins kleinere Team.',
  'party.pair.button': 'Zusammen 2v2 suchen',
  'party.pair.note': 'Seid ihr genau zu zweit, könnt ihr als Team in die 2v2-Suche gehen. Die Party wird dabei geschlossen.',
  'party.pair.queued': 'Du und dein Teampartner seid zusammen in der 2v2-Suche.',

  'host.title': 'Host',
  'host.label': 'Host-Menü',
  'host.kick': 'Entfernen',
  'host.kickLabel': '{name} entfernen',
  'host.kickConfirm': '{name} aus der Party entfernen? Zurückkommen geht dann nicht mehr.',
  'host.kickYes': 'Entfernen',
  'host.makeHost': 'Zum Host machen',
  'host.makeHostLabel': '{name} zum Host machen',
  'host.makePicker': 'Tippen lassen',
  'host.makePickerLabel': '{name} tippen lassen',
  'host.moreLabel': 'Aktionen für {name}',
  'host.endRound': 'Runde beenden',

  'party.noTimer.label': 'Kein Timer',
  'party.noTimer': 'Die Runde endet, wenn alle getippt haben oder der Host sie beendet.',
  'party.noTimerHost': 'Die Runde endet, wenn alle getippt haben oder du sie beendest.',

  'team.health': 'Leben der Teams',
  'team.healthLeft': '{health} Leben',

  'chat.scope': 'Senden an',
  'chat.scope.all': 'Alle',
  'chat.scope.team': 'Team',
  'chat.teamTag': 'Team',

  // Wave 6

  // Co-op: who places the guess, in the lobby, over a round and at the end
  'tag.picker': 'tippt',
  'coop.hint': 'Alle spielen zusammen. Eine Person gibt den Tipp ab, der zählt, und die Pins der anderen sind Vorschläge.',
  'coop.youPick': 'Du gibst den Tipp für alle ab.',
  'coop.theyPick': '{name} gibt den Tipp ab. Dein Pin ist ein Vorschlag.',
  'coop.lock': '{name} tippt',
  'outcome.coop': '{score} von {max} zusammen.',
};
