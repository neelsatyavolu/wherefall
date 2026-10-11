/** When a visitor is welcomed before the home screen. No DOM in here. */

/** How a browser arrives: the address it opened, and what it remembers. */
export interface Arrival {
  /** the address's hash and query, as the browser gives them */
  hash: string;
  search: string;
  /** the welcome was answered in this browser: the tutorial was chosen, or it was skipped */
  answered: boolean;
  /** this browser was here before there was a welcome: it dismissed the how-to box, or has been shown a place */
  returning: boolean;
}

/** what a query may carry and still be the plain home page: the language to read it in */
const PLAIN_PARAMS: readonly string[] = ['lang'];

/** True for the home page itself: no nav item named, and nothing in the query that leads somewhere. */
const plainHome = (hash: string, search: string): boolean => hash === '' && [...new URLSearchParams(search).keys()].every((name) => PLAIN_PARAMS.includes(name));

/**
 * True when this browser is welcomed before the home screen: a new one, on the plain home page. A
 * challenge link, a party link, a profile, a map or a nav link goes where it leads. Whether the
 * visitor has an account is the server's to say, and is asked only when this is true.
 */
export const welcomeDue = (arrival: Arrival): boolean => !arrival.answered && !arrival.returning && plainHome(arrival.hash, arrival.search);
