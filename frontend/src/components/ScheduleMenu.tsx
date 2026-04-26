import { useEffect, useRef, useState } from "react"
import { useTheme, type ThemePref } from "../hooks/useTheme"

/**
 * Overflow menu (⋯) on the schedule toolbar. Houses calendar-wide
 * actions and the theme override picker.
 *
 *   - Empty Calendar (two-stage)
 *   - Theme overrides — Phosphor, Rio, Assemble — pick one to opt
 *     out of system light/dark mode. Disables the topbar toggle
 *     until the user resets.
 *   - Chair Mode swatch row — per-department palettes that all
 *     count as overrides.
 *   - Reset to default (only shown while an override is active).
 *
 * Two-stage Empty Calendar (keep / also-drop-pins) survives the
 * move: the menu stays open between stages so the armed click is a
 * quick confirm instead of a re-open.
 */

export interface ScheduleMenuProps {
  onEmptyCalendar: () => void
  /** True after the first Empty Calendar click when user pins survived —
   *  the second click also clears pins. UI shows a red dot while armed. */
  clearArmed: boolean
  /** Disable the whole menu while a solve is in flight so the user
   *  can't accidentally yank the ground out from under the solver. */
  disabled: boolean
}

export function ScheduleMenu({ onEmptyCalendar, clearArmed, disabled }: ScheduleMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const {
    theme,
    isOverride,
    setTheme,
    clearOverride,
    overrideThemes,
    chairThemes,
  } = useTheme()

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const handleEmpty = () => {
    onEmptyCalendar()
    if (clearArmed) setOpen(false)
  }

  const pickTheme = (id: ThemePref) => {
    setTheme(id)
    // Don't close — let the user A/B between themes without re-opening.
  }

  return (
    <div className="schedule-menu" ref={rootRef}>
      <button
        type="button"
        className="schedule-menu__trigger"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-label="More calendar actions"
        aria-expanded={open}
        aria-haspopup="menu"
        title="More calendar actions"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div className="schedule-menu__popover" role="menu" aria-label="Calendar actions">
          <button
            type="button"
            role="menuitem"
            className={
              "schedule-menu__item" +
              (clearArmed ? " schedule-menu__item--armed" : "")
            }
            onClick={handleEmpty}
            title={
              clearArmed
                ? "Click again to also clear your manually placed cards."
                : "Clear solver results and start over. User-placed cards stay."
            }
          >
            <span>Empty Calendar</span>
            {clearArmed && (
              <span className="schedule-menu__armed-dot" aria-hidden="true" />
            )}
          </button>

          <div className="schedule-menu__divider" role="separator" />
          <div className="schedule-menu__section-label" aria-hidden="true">
            Theme Override
          </div>
          <div className="schedule-menu__section-hint">
            Picks here disable light/dark mode.
          </div>

          {overrideThemes.map(t => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === t.id}
              className={
                "schedule-menu__item schedule-menu__item--theme" +
                (theme === t.id ? " is-active" : "")
              }
              onClick={() => pickTheme(t.id)}
              title={t.description}
            >
              <span>{t.name}</span>
              {theme === t.id && (
                <span className="schedule-menu__check" aria-hidden="true">●</span>
              )}
            </button>
          ))}

          <div className="schedule-menu__divider" role="separator" />
          <div className="schedule-menu__section-label" aria-hidden="true">
            Chair Override
          </div>

          <div className="schedule-menu__chair-row" role="group" aria-label="Chair palette">
            {chairThemes.map(t => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.id}
                className={
                  "schedule-menu__chair-swatch" +
                  (theme === t.id ? " is-active" : "")
                }
                onClick={() => pickTheme(t.id)}
                style={{ background: t.swatch }}
                title={`${t.description} — ${t.name}`}
                aria-label={t.description}
              >
                <span className="schedule-menu__chair-label">{t.name}</span>
              </button>
            ))}
          </div>

          {isOverride && (
            <>
              <div className="schedule-menu__divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="schedule-menu__item schedule-menu__item--reset"
                onClick={() => {
                  clearOverride()
                  setOpen(false)
                }}
                title="Drop the override and re-enable the topbar light/dark toggle."
              >
                <span>Reset to Light / Dark mode</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
