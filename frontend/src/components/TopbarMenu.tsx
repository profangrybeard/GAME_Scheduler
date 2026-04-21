/**
 * About popover in the desktop topbar. Shows app identity, build info, and a
 * contact line. Previously held Backup / Restore / Commit — those actions
 * were the JSON-overlay persistence flow, which is superseded by the
 * workbook-is-source-of-truth refactor (the workbook's hidden sheet holds
 * configuration now, so there's no parallel JSON state to shuffle around).
 */
import { useEffect, useRef, useState } from "react"

const COMMIT_URL = "https://github.com/profangrybeard/GAME_Scheduler/commit/"
const CONTACT_EMAIL = "tlindsey@scad.edu"

function formatBuildTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

export function TopbarMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape. Mount only when open so we don't keep a
  // global listener around for a popover that's closed 99% of the time.
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

  const sha = __APP_VERSION__
  const builtAt = formatBuildTime(__BUILD_TIME__)
  const isDev = import.meta.env.DEV
  const commitHref = sha === "unknown" ? undefined : `${COMMIT_URL}${sha}`
  const mailtoHref =
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(`GAME_Scheduler build ${sha} — Question`)}`

  return (
    <div className="topbar-menu" ref={rootRef}>
      <button
        type="button"
        className="topbar-menu__trigger"
        onClick={() => setOpen(v => !v)}
        aria-label="About this app"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="About"
      >
        <span aria-hidden="true" className="topbar-menu__trigger-glyph">i</span>
      </button>

      {open && (
        <div className="topbar-menu__popover" role="dialog" aria-label="About">
          <div className="topbar-about">
            <div className="topbar-about__title">GAME_Scheduler</div>
            <div className="topbar-about__meta">
              Build{" "}
              <a
                href={commitHref}
                target="_blank"
                rel="noopener noreferrer"
                className="topbar-about__sha"
                title={commitHref ? "Open commit on GitHub" : undefined}
              >
                {sha}
              </a>
              {isDev && <span className="topbar-about__dev">dev</span>}
            </div>
            <div className="topbar-about__meta">Built {builtAt}</div>
            <div className="topbar-menu__divider" role="separator" />
            <div className="topbar-about__contact">
              <span>Questions? Tim Lindsey</span>
              <a href={mailtoHref} className="topbar-about__mailto">
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
