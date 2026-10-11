/** The countries an account can show as its flag, the guess made from the browser, and the search over their names. */

/** Every ISO 3166-1 country and territory, and Kosovo, which the standard has yet to list. */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
  'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ' +
  'ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ ' +
  'LA LB LC LI LK LR LS LT LU LV LY ' +
  'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA ' +
  'RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
  'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ ' +
  'VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

const KNOWN = new Set(COUNTRY_CODES);

/**
 * The country a new account starts with: the region of the browser's language ("en-GB" is GB),
 * or none when it names no region, or one that is not a country ("es-419" is Latin America).
 */
export function countryFromLocale(locale: string | null | undefined): string | null {
  if (!locale) {
    return null;
  }
  try {
    const region = new Intl.Locale(locale).region;
    return region !== undefined && KNOWN.has(region) ? region : null;
  } catch {
    // not a language tag at all
    return null;
  }
}

export interface CountryChoice {
  code: string;
  name: string;
}

/** Every country under its name in a language, in that language's alphabetical order. */
export function countryChoices(nameOf: (code: string) => string, locale: string): CountryChoice[] {
  const collator = new Intl.Collator(locale);
  return COUNTRY_CODES.map((code) => ({ code, name: nameOf(code) })).sort((a, b) => collator.compare(a.name, b.name));
}

/** A name as it is compared: lower case, without its accents, so "cote" finds "Côte d’Ivoire". */
const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The countries whose name contains what was typed; all of them when nothing was. */
export function matchingCountries(choices: readonly CountryChoice[], query: string): CountryChoice[] {
  const wanted = folded(query.trim());
  return wanted === '' ? [...choices] : choices.filter((choice) => folded(choice.name).includes(wanted));
}
