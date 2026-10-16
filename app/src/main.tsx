import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/dm-serif-display/latin-400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A new build replaces the hashed files in dist/assets, but SillyTavern keeps this iframe
// open: the old app then asks for a page chunk that is gone ("Failed to fetch dynamically
// imported module"). Reload once to pick up the new build; not again within a minute, in
// case the file is really missing.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'onlytavern:reloadedForBuild'
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last > 60_000) sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // No storage: still reload once (this page load).
  }
  if (Date.now() - last <= 60_000) return
  event.preventDefault()
  // A fresh ?v= like index.js uses when it opens the app, so the browser does not hand back the cached old index.html.
  location.replace(`${location.pathname}?v=${Date.now()}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
