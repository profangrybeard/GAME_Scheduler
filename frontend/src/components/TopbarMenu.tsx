/**
 * Right-side overflow menu in the desktop topbar. Collects the low-frequency
 * overlay-persistence actions (Backup / Restore / Commit) and the build
 * version badge so the topbar can foreground what's actually used minute-to-
 * minute (Export + theme toggle).
 *
 * Commit is still gated behind `apiAvailable === true` — the hosted preview
 * can't write back to disk, so the row disables with a tooltip instead of
 * disappearing. Keeping it visible prevents users from wondering why a
 * feature they've seen before "vanished" on the hosted surface.
 */
import { useEffect, useRef, useState } from "react"
import { VersionBadge } from "./VersionBadge"

interface TopbarMenuProps {
  apiAvailable: boolean | null
  onBackup: () => void
  onRestore: () => void
  onCommit: () => void
}

export function TopbarMenu(props: TopbarMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape. Mount only when open so we don't keep a
  // global listener around for a menu that's closed 99% of the time.
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

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div className="topbar-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-menu__trigger"
        onClick={() => setOpen(v => !v)}
        aria-label="Open settings menu"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Backup, restore, commit, version"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div className="topbar-menu__popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="topbar-menu__item"
            onClick={() => run(props.onBackup)}
          >
            <span className="topbar-menu__label">Backup</span>
            <span className="topbar-menu__hint">Download edits as JSON</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="topbar-menu__item"
            onClick={() => run(props.onRestore)}
          >
            <span className="topbar-menu__label">Restore</span>
            <span className="topbar-menu__hint">Replace edits from JSON</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="topbar-menu__item"
            onClick={() => run(props.onCommit)}
            disabled={props.apiAvailable !== true}
            title={
              props.apiAvailable === true
                ? "Write edits to data/*.json on disk"
                : "Requires the local launcher"
            }
          >
            <span className="topbar-menu__label">Commit</span>
            <span className="topbar-menu__hint">
              {props.apiAvailable === true
                ? "Write to data/*.json"
                : "Local launcher only"}
            </span>
          </button>
          <div className="topbar-menu__divider" role="separator" />
          <div className="topbar-menu__footer">
            <VersionBadge />
          </div>
        </div>
      )}
    </div>
  )
}
