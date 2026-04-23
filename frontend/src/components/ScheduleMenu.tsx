import { useEffect, useRef, useState } from "react"

/**
 * Overflow menu (⋯) on the schedule toolbar. Houses calendar-wide actions
 * that don't need to be chilling on the topbar all the time — today just
 * Empty Calendar; later things like Lock all / Export to PNG / etc.
 *
 * Two-stage Empty Calendar (keep / also-drop-pins) survives the move:
 * the menu stays open between stages so the armed click is a quick
 * confirm instead of a re-open.
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

  // Close on outside click / Escape — same pattern as TopbarMenu. Only mount
  // the listener while open so we don't keep a global handler around.
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
    // Stay open after the first click so the armed state is visible +
    // the confirming second click is one tap away. After the second click
    // clearArmed flips back to false and the caller decides the flow.
    if (clearArmed) setOpen(false)
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
        </div>
      )}
    </div>
  )
}
