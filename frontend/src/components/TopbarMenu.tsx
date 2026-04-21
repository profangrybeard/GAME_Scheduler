/**
 * About popover in the desktop topbar. Shows app identity, build info, and a
 * contact line. Previously held Backup / Restore / Commit — those actions
 * were the JSON-overlay persistence flow, which is superseded by the
 * workbook-is-source-of-truth refactor (the workbook's hidden sheet holds
 * configuration now, so there's no parallel JSON state to shuffle around).
 */
import { useCallback, useEffect, useRef, useState } from "react"

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
  // Transient status from the "Show backups folder" action — null while idle,
  // string during the async call / after completion. Shown inline so the user
  // knows whether their click actually did anything, since the OS file-browser
  // window pops up outside this tab and is easy to miss.
  const [backupsStatus, setBackupsStatus] = useState<string | null>(null)
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
  const semver = __APP_SEMVER__
  const builtAt = formatBuildTime(__BUILD_TIME__)
  const isDev = import.meta.env.DEV
  const commitHref = sha === "unknown" ? undefined : `${COMMIT_URL}${sha}`
  const mailtoHref =
    `mailto:${CONTACT_EMAIL}` +
    `?subject=${encodeURIComponent(`GAME_Scheduler v${semver} — Question`)}`

  const revealBackups = useCallback(async () => {
    setBackupsStatus("Opening…")
    try {
      const res = await fetch("/api/backups/reveal")
      if (res.ok) {
        setBackupsStatus("Opened in file browser.")
      } else {
        // Surface the backend's human-readable detail (e.g. "No backups folder
        // yet" / "unavailable in hosted mode") so the user knows what happened.
        const detail = (await res.json().catch(() => ({})))?.detail
        setBackupsStatus(detail || `Couldn't open (HTTP ${res.status})`)
      }
    } catch (e) {
      setBackupsStatus(e instanceof Error ? e.message : "Couldn't reach the local API.")
    }
  }, [])

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
            <div className="topbar-about__title">GAME_Scheduler v{semver}</div>
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
            <button
              type="button"
              className="topbar-about__action"
              onClick={revealBackups}
              title="Open the local .backups folder in your file browser"
            >
              Show backups folder
            </button>
            {backupsStatus && (
              <div className="topbar-about__status" aria-live="polite">
                {backupsStatus}
              </div>
            )}
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
