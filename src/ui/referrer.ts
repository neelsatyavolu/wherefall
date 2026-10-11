import { el } from './dom.ts';

/**
 * What the page tells other sites about where a request came from. A password-reset link carries
 * its token in the address, so while one is there nothing is told at all. It is set here, for as
 * long as the token is in the address, and not for the whole site: Google checks the address of the
 * page its Street View key is used on, and a site that never names itself is one it may refuse.
 */

/** the site's own policy, as vercel.json sends it with every page */
const SITE_POLICY = 'strict-origin-when-cross-origin';

/** A new tag each time: a browser reads the policy when the tag is put into the page. */
function setPolicy(policy: string): void {
  document.querySelector('meta[name="referrer"]')?.remove();
  document.head.append(el('meta', { attrs: { name: 'referrer', content: policy } }));
}

/** From now on no request from this page says where it came from. */
export const hideAddress = (): void => setPolicy('no-referrer');

/** Back to what the site says of itself everywhere else: its origin, and never more than that to another site. */
export const showOrigin = (): void => setPolicy(SITE_POLICY);
