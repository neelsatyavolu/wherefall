/**
 * Wherefall as an installable app: the service worker that keeps the app shell for offline starts, and
 * the browser's offer to install, held until the player asks for it.
 */

/** Chrome's install offer. It is not in the standard DOM types. */
interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
}

let offer: InstallPrompt | null = null;
let onOffer: (available: boolean) => void = () => {};

/** Registers the worker (built site only: in development it would only get in the way) and listens for the install offer. */
export function startPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // the browser's own banner is held back: the offer is made from the sidebar instead
    event.preventDefault();
    offer = event as InstallPrompt;
    onOffer(true);
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    onOffer(false);
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

/** Calls back now and whenever the browser starts or stops allowing an install. */
export function watchInstall(listener: (available: boolean) => void): void {
  onOffer = listener;
  listener(offer !== null);
}

/** Shows the browser's install dialog. Does nothing when no offer is standing. */
export async function install(): Promise<void> {
  const standing = offer;
  offer = null;
  onOffer(false);
  await standing?.prompt();
}
