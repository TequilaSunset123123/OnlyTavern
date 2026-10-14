/**
 * useTheme — reads/writes the active theme as a `data-theme` attribute
 * on `<html>`, with localStorage persistence so the choice survives
 * reloads + popout windows.
 *
 * SSR-safe: the initial state matches whatever the pre-hydration script
 * in layout.tsx already wrote, so there's no flash of wrong theme.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "onlytavern:theme";

// Fastt uses data-theme; @fanvue/ui uses the .dark class. Set both.
function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.classList.toggle("dark", t === "dark");
}

function readInitialTheme(): Theme {
  let t: Theme = "dark";
  try { if (window.localStorage.getItem(STORAGE_KEY) === "light") t = "light"; } catch { /* ignore */ }
  applyTheme(t);
  return t;
}

export function useTheme() {
  // Lazy init so we don't run the DOM read on every render. The pre-
  // hydration script in layout.tsx has already set data-theme to the
  // persisted value before React boots, so `readInitialTheme` always
  // returns the user's actual preference.
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // React to the same setting being toggled from another tab. The
  // popout window and the inbox tab share localStorage; without this
  // listener flipping the theme in one would leave the other stale.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const next = e.newValue === "light" ? "light" : "dark";
      applyTheme(next);
      setThemeState(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}
