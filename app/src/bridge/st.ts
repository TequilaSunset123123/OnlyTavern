// The only place that touches SillyTavern. The app runs in a same-origin iframe
// created by ../../index.js, so the host page is window.parent.

export type StContext = {
  characters?: unknown[]
  name1?: string
  extensionSettings: Record<string, unknown>
  saveSettingsDebounced(): void
  getRequestHeaders(): Record<string, string>
  [key: string]: unknown
}

/** Exposed by index.js on the SillyTavern page. */
type OnlyTavernHost = {
  close(): void
  download(content: string, fileName: string, contentType: string): Promise<unknown> | void
}

type StWindow = Window & {
  SillyTavern?: { getContext(): StContext }
  OnlyTavernHost?: OnlyTavernHost
}

function host(): StWindow | null {
  try {
    return window.parent !== window ? (window.parent as StWindow) : null
  } catch {
    return null // cross-origin: should not happen, but don't crash
  }
}

/** SillyTavern's context, or null when the app is opened on its own (dev server). */
export function getStContext(): StContext | null {
  try {
    return host()?.SillyTavern?.getContext() ?? null
  } catch {
    return null
  }
}

/** Ask index.js to hide the overlay. */
export function closeApp(): void {
  host()?.OnlyTavernHost?.close()
}

/**
 * Save a text file. Inside SillyTavern this goes through ST's own download()
 * (TauriTavern replaces it with a native save on iPhone); on its own, a plain link.
 */
export async function downloadText(fileName: string, text: string): Promise<void> {
  const st = host()?.OnlyTavernHost
  if (st) {
    await st.download(text, fileName, 'application/json')
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
