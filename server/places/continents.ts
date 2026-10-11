/**
 * Which of six continents a place is on. This is the game's own table
 * (`src/game/continents.ts`), kept here so the server can judge a Continent
 * Guesser answer and the spread of a match's places for itself; a test holds
 * the two copies together. Antarctica is no answer in the game, so its
 * places have no continent.
 */
export const CONTINENTS = ['africa', 'asia', 'europe', 'north-america', 'oceania', 'south-america'] as const;
export type Continent = (typeof CONTINENTS)[number];

const COUNTRIES: Record<Continent, string> = {
  africa:
    'AC AO BF BI BJ BW CD CF CG CI CM CV DG DJ DZ EA EG EH ER ET GA GH GM GN GQ GW IC IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TA TD TG TN TZ UG YT ZA ZM ZW',
  asia: 'AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  europe: 'AD AL AT AX BA BE BG BY CH CQ CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  'north-america': 'AG AI AW BB BL BM BQ BS BZ CA CP CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  oceania: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
  'south-america': 'AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE',
};

const BY_COUNTRY: ReadonlyMap<string, Continent> = new Map(CONTINENTS.flatMap((continent) => COUNTRIES[continent].split(' ').map((code) => [code, continent] as const)));

const RUSSIA = 'RU';
/** The meridian the Urals roughly follow: Russia east of it is Asia. */
const URALS_LNG = 60;

/** The continent a place is on, or null when it is on none of the six. Russia is the one country split. */
export function continentOf(place: { country: string; lng: number }): Continent | null {
  if (place.country === RUSSIA) {
    // The far east of Russia runs past the date line into negative longitudes.
    return place.lng >= URALS_LNG || place.lng < 0 ? 'asia' : 'europe';
  }
  return BY_COUNTRY.get(place.country) ?? null;
}

/** How many of the six continents some places are on between them. */
export const continentsOf = (places: ReadonlyArray<{ country: string; lng: number }>): number =>
  new Set(places.map(continentOf).filter((continent) => continent !== null)).size;
