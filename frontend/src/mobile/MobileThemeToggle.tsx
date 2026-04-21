/**
 * Small sun/moon button that cycles the theme preference
 * (system → light → dark → system). Used on both mobile screens.
 *
 * Wraps the same `useTheme()` hook as the desktop toggle so a user's choice
 * is persisted under the same localStorage key and honored across surfaces.
 * Icon mirrors desktop: sun for light, moon for dark, tiny "A" badge when
 * the preference is "system" (i.e. tracking the OS).
 */
import { useTheme } from "../hooks/useTheme"

export function MobileThemeToggle() {
  const { theme, resolved, cycle } = useTheme()
  return (
    <button
      type="button"
      className="mobile-theme-toggle"
      onClick={cycle}
      title={`Theme: ${theme} (${resolved})`}
      aria-label={`Switch theme, currently ${theme}`}
    >
      <span aria-hidden="true">{resolved === "dark" ? "\u263E" : "\u2600"}</span>
      {theme === "system" && <span className="mobile-theme-toggle__auto">A</span>}
    </button>
  )
}
