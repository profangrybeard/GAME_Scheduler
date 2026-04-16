import { useCallback, useEffect, useSyncExternalStore } from "react"

/**
 * Theme hook — defaults to OS preference, manual override via localStorage.
 *
 * Stored preference: "light" | "dark" | "system" (or absent → "system").
 * Resolved theme: always "light" or "dark" — what actually applies.
 *
 * Sets `data-theme` on <html> so CSS selectors `:root[data-theme="light"]`
 * can override the default dark palette.
 */

type ThemePref = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

const STORAGE_KEY = "theme"
const MQ = "(prefers-color-scheme: dark)"

function getStoredPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === "light" || v === "dark" || v === "system") return v
  } catch { /* localStorage unavailable */ }
  return "system"
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(MQ).matches ? "dark" : "light"
}

function resolve(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref
}

function applyToDOM(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved
}

// External store for the preference (survives across renders)
let currentPref = getStoredPref()
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): ThemePref {
  return currentPref
}

function setPref(next: ThemePref) {
  currentPref = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* noop */ }
  applyToDOM(resolve(next))
  listeners.forEach(cb => cb())
}

// Apply on module load so there's no flash
applyToDOM(resolve(currentPref))

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getSnapshot)
  const resolved = resolve(pref)

  // Listen for OS preference changes when in "system" mode
  useEffect(() => {
    if (pref !== "system") return
    const mq = window.matchMedia(MQ)
    const handler = () => applyToDOM(resolve("system"))
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [pref])

  // Keep DOM in sync on mount/pref change
  useEffect(() => { applyToDOM(resolved) }, [resolved])

  const cycle = useCallback(() => {
    const order: ThemePref[] = ["system", "light", "dark"]
    const idx = order.indexOf(pref)
    setPref(order[(idx + 1) % order.length])
  }, [pref])

  return { theme: pref, resolved, cycle } as const
}
