import { t } from '../i18n/index.ts';

/** What the two teams are called, wherever one is named: the lobby, the round table, health, the standing. */

export const teamName = (team: 0 | 1) => t('team.name', { number: team + 1 });

/** A team's name, saying so when it is the viewer's own. */
export const teamNameFor = (team: 0 | 1, yours: boolean) => (yours ? t('team.nameYours', { number: team + 1 }) : teamName(team));

/** in a row of players the column is headed "Team", so the number is enough */
export const teamNumber = (team: 0 | 1 | null) => (team === null ? '' : String(team + 1));
