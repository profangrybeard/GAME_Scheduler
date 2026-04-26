import { useCallback, useEffect, useSyncExternalStore } from "react"

/**
 * Theme system — two-tier model.
 *
 *   Tier 1: Default light + dark, plus "system" auto-resolve. The
 *   topbar sun/moon toggle cycles through these three. This is the
 *   shipping UX for everyone who doesn't go hunting in the menu.
 *
 *   Tier 2: Override themes — five curated palettes plus seven
 *   chair-mode dept swatches. Picking one is a deliberate "I'm
 *   opting out of system light/dark, give me this exact palette."
 *   The override is sticky across reloads, and the topbar toggle
 *   goes disabled while it's active. The user returns to default
 *   mode by hitting "Reset" in the menu.
 *
 *   Each theme can also override the SYNTHESIZE button's CTA verb
 *   via ctaLabel — the verb IS the theme's signature. Defaults use
 *   "Solve" (boring + accurate); overrides use a flavored verb that
 *   nods to the muse.
 *
 * Stored preference (localStorage["theme"]) is one of:
 *   - "system" — resolve from prefers-color-scheme
 *   - DEFAULT_LIGHT_ID / DEFAULT_DARK_ID — explicit default-tier pick
 *   - any override theme id
 * Resolved theme: always a concrete theme id painted to <html data-theme="...">.
 */

export type ThemeId =
  | "outrun"
  | "executive-day"
  | "vault"
  | "assemble"
  | "marauder"
  | "nightmare"
  | "forest"
  | "chair-game"
  | "chair-mome"
  | "chair-ai"
  | "chair-ixds"
  | "chair-iact"
  | "chair-digi"
  | "chair-adbr"
export type ThemePref = ThemeId | "system"
export type ResolvedTheme = ThemeId
export type ThemeKind = "dark" | "light"

export interface ThemeMeta {
  id: ThemeId
  name: string
  kind: ThemeKind
  /** Display swatch color — used by the chair-mode swatch row. */
  swatch: string
  description: string
  /** Theme-specific CTA verb for the SYNTHESIZE button. Defaults to
   *  "Solve" / "Solving…" (the boring + accurate fallback) when unset. */
  ctaLabel?: { idle: string; solving: string }
}

export const DEFAULT_DARK_ID: ThemeId = "outrun"
export const DEFAULT_LIGHT_ID: ThemeId = "executive-day"

const FALLBACK_CTA = { idle: "SOLVE", solving: "SOLVING…" } as const

/**
 * Main theme presets — defaults + five curated overrides. Each
 * override has its own CTA verb that IS the theme's title.
 */
export const THEMES: readonly ThemeMeta[] = [
  {
    id: "outrun",
    name: "Executive Outrun",
    kind: "dark",
    swatch: "#66FCF1",
    description: "1980s tactical workstation — obsidian + tube cyan",
    ctaLabel: { idle: "SOLVE", solving: "SOLVING…" },
  },
  {
    id: "executive-day",
    name: "Executive Day",
    kind: "light",
    swatch: "#0EA5E9",
    description: "Daylight Outrun — off-white bezel + sky-teal accent",
    ctaLabel: { idle: "SOLVE", solving: "SOLVING…" },
  },
  {
    id: "assemble",
    name: "Assemble",
    kind: "dark",
    swatch: "#E0B863",
    description: "Avengers Endgame — gunmetal + battle-worn gold",
    ctaLabel: { idle: "ASSEMBLE!", solving: "ASSEMBLING…" },
  },
  {
    id: "vault",
    name: "Vault",
    kind: "dark",
    swatch: "#39FF14",
    description: "Fallout terminal — Pip-Boy phosphor green-on-black",
    ctaLabel: { idle: "EXECUTE", solving: "EXECUTING…" },
  },
  {
    id: "marauder",
    name: "Marauder",
    kind: "light",
    swatch: "#8B0000",
    description: "Marauder's Map — aged parchment + sepia ink + crimson wax",
    ctaLabel: { idle: "MANAGE", solving: "MANAGING…" },
  },
  {
    id: "nightmare",
    name: "Nightmare",
    kind: "dark",
    swatch: "#B91C1C",
    description: "Burton / Nightmare Before Christmas — monochrome + pop of red",
    ctaLabel: { idle: "FINALIZE", solving: "FINALIZING…" },
  },
  {
    id: "forest",
    name: "Forest",
    kind: "light",
    swatch: "#4A7C3F",
    description: "Ghibli forest — sage + mossy cream + dusk lavender",
    ctaLabel: { idle: "CULTIVATE", solving: "CULTIVATING…" },
  },
] as const

/**
 * Chair Mode — per-department palettes that inherit the Outrun base
 * (obsidian, glass cards, tube glow) but route every accent and glow
 * through the chair's home-department color. CTA falls back to
 * "Solve" since chair-themes are flavored defaults, not muses.
 */
export const CHAIR_THEMES: readonly ThemeMeta[] = [
  {
    id: "chair-game",
    name: "GAME",
    kind: "dark",
    swatch: "#FFD556",
    description: "Chair palette: Game Design",
  },
  {
    id: "chair-mome",
    name: "MOME",
    kind: "dark",
    swatch: "#C77DFF",
    description: "Chair palette: Motion Media",
  },
  {
    id: "chair-ai",
    name: "AI",
    kind: "dark",
    swatch: "#9D7BFF",
    description: "Chair palette: Interactive AI",
  },
  {
    id: "chair-ixds",
    name: "IXDS",
    kind: "dark",
    swatch: "#66FCF1",
    description: "Chair palette: Interaction Design",
  },
  {
    id: "chair-iact",
    name: "IACT",
    kind: "dark",
    swatch: "#FFB347",
    description: "Chair palette: Interactive Design",
  },
  {
    id: "chair-digi",
    name: "DIGI",
    kind: "dark",
    swatch: "#5BE3A8",
    description: "Chair palette: Digital Media",
  },
  {
    id: "chair-adbr",
    name: "ADBR",
    kind: "dark",
    swatch: "#FF6B89",
    description: "Chair palette: Advertising / Branding",
  },
] as const

const ALL_THEMES: readonly ThemeMeta[] = [...THEMES, ...CHAIR_THEMES]

const DEFAULT_PREFS = new Set<ThemePref>([
  "system",
  DEFAULT_DARK_ID,
  DEFAULT_LIGHT_ID,
])

const STORAGE_KEY = "theme"
const MQ = "(prefers-color-scheme: dark)"

const VALID_PREFS: readonly ThemePref[] = [
  "system",
  ...ALL_THEMES.map(t => t.id),
] as const

function getStoredPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && (VALID_PREFS as readonly string[]).includes(v)) {
      return v as ThemePref
    }
    if (v === "light") return DEFAULT_LIGHT_ID
    if (v === "dark") return DEFAULT_DARK_ID
    /* Migrate old aesthetic-experiment ids that no longer exist. */
    if (v === "phosphor") return "vault"
    if (v === "rio" || v === "paper") return DEFAULT_LIGHT_ID
  } catch {
    /* localStorage unavailable */
  }
  return "system"
}

function getSystemKind(): ThemeKind {
  return window.matchMedia(MQ).matches ? "dark" : "light"
}

function defaultThemeForKind(kind: ThemeKind): ThemeId {
  return kind === "dark" ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return defaultThemeForKind(getSystemKind())
  return pref
}

function applyToDOM(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved
}

let currentPref = getStoredPref()
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): ThemePref {
  return currentPref
}

function setPref(next: ThemePref) {
  currentPref = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* noop */
  }
  applyToDOM(resolve(next))
  listeners.forEach(cb => cb())
}

applyToDOM(resolve(currentPref))

export function themeKind(id: ResolvedTheme): ThemeKind {
  const meta = ALL_THEMES.find(t => t.id === id)
  return meta ? meta.kind : "dark"
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getSnapshot)
  const resolved = resolve(pref)
  const isOverride = !DEFAULT_PREFS.has(pref)

  useEffect(() => {
    if (pref !== "system") return
    const mq = window.matchMedia(MQ)
    const handler = () => applyToDOM(resolve("system"))
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [pref])

  useEffect(() => {
    applyToDOM(resolved)
  }, [resolved])

  const cycle = useCallback(() => {
    const order: ThemePref[] = ["system", DEFAULT_LIGHT_ID, DEFAULT_DARK_ID]
    const idx = order.indexOf(pref)
    setPref(order[(idx + 1) % order.length])
  }, [pref])

  const setTheme = useCallback((next: ThemePref) => setPref(next), [])
  const clearOverride = useCallback(() => setPref("system"), [])

  const overrideThemes = THEMES.filter(
    t => t.id !== DEFAULT_DARK_ID && t.id !== DEFAULT_LIGHT_ID,
  )

  const ctaLabel =
    ALL_THEMES.find(t => t.id === resolved)?.ctaLabel ?? FALLBACK_CTA

  return {
    theme: pref,
    resolved,
    isOverride,
    cycle,
    setTheme,
    clearOverride,
    themes: THEMES,
    overrideThemes,
    chairThemes: CHAIR_THEMES,
    ctaLabel,
  } as const
}
