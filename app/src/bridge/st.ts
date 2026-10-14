// The only place that touches SillyTavern. The app runs in a same-origin iframe
// created by ../../index.js, so the host page is window.parent.

type StContext = {
  characters?: unknown[];
  name1?: string;
  [key: string]: unknown;
};

type StHost = Window & { SillyTavern?: { getContext(): StContext } };

function host(): StHost | null {
  try {
    return window.parent !== window ? (window.parent as StHost) : null;
  } catch {
    return null; // cross-origin: should not happen, but don't crash
  }
}

/** SillyTavern's context, or null when the app is opened on its own (dev server). */
export function getStContext(): StContext | null {
  try {
    return host()?.SillyTavern?.getContext() ?? null;
  } catch {
    return null;
  }
}

/** Ask index.js to hide the overlay. */
export function closeApp(): void {
  host()?.postMessage({ type: 'onlytavern:close' }, window.location.origin);
}
