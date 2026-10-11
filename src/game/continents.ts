import type { Location } from './locations.ts';

/**
 * Which of six continents a place is on, for the Continent Guesser. The place lists carry only four
 * regions per country (Europe, the Americas, Asia & Oceania, Africa), and not for every country, so
 * the continent comes from the country code instead, after the United Nations' grouping of
 * countries: Central America and the Caribbean are North America; Turkey, Cyprus and the Caucasus
 * are Asia. Russia is the one country split, at the Urals. Antarctica is no answer in the game, so
 * its places have no continent.
 */

export const CONTINENTS = ['africa', 'asia', 'europe', 'north-america', 'oceania', 'south-america'] as const;
export type Continent = (typeof CONTINENTS)[number];

/** two-letter codes as the borders file names territories, which is how the place lists were made */
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
/** the meridian the Urals roughly follow: Russia east of it is Asia */
const URALS_LNG = 60;

/** The countries and territories of a continent, by code. Russia is listed under Europe. */
export const countriesOf = (continent: Continent): string[] => COUNTRIES[continent].split(' ');

/** The continent a country is on by its code alone, or null when it is on none of the six. */
export const continentOfCountry = (country: string): Continent | null => BY_COUNTRY.get(country) ?? null;

/** The continent a place is on, or null when it is on none of the six. */
export function continentOf(place: Pick<Location, 'country' | 'lng'>): Continent | null {
  if (place.country === RUSSIA) {
    // the far east of Russia runs past the date line into negative longitudes
    return place.lng >= URALS_LNG || place.lng < 0 ? 'asia' : 'europe';
  }
  return continentOfCountry(place.country);
}
