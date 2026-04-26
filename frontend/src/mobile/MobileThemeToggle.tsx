/**
 * Small sun/moon button that cycles the theme preference between
 * system → default light → default dark. Used on both mobile screens.
 *
 * Wraps the same `useTheme()` hook as the desktop toggle so a user's
 * choice is persisted under the same localStorage key and honored
 * across surfaces. Goes disabled when an override theme (Phosphor /
 * Rio / Assemble / Chair-*) is active — the user must clear the
 * override from the schedule … menu to re-enable light/dark cycling.
 */
import { useTheme, themeKind } from "../hooks/useTheme"

export function MobileThemeToggle() {
  const { theme, resolved, isOverride, cycle } = useTheme()
  const isDark = themeKind(resolved) === "dark"
  return (
    <button
      type="button"
      className={
        "mobile-theme-toggle" +
        (isOverride ? " mobile-theme-toggle--locked" : "")
      }
      onClick={cycle}
      disabled={isOverride}
      title={
        isOverride
          ? `Theme override active (${resolved}). Reset from the schedule … menu.`
          : `Theme: ${theme} (${resolved})`
      }
      aria-label={
        isOverride
          ? `Light/dark toggle disabled — theme override "${resolved}" is active`
          : `Switch theme, currently ${theme}`
      }
    >
      <span aria-hidden="true">{isDark ? "☾" : "☀"}</span>
      {theme === "system" && <span className="mobile-theme-toggle__auto">A</span>}
    </button>
  )
}
