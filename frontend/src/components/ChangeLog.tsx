import { useEffect, useRef, useState } from "react"

/**
 * Tiny "discovered it" log chip in the bottom-left corner. Rolled up by
 * default — a muted ⋯ glyph — clicks open a small panel of the last N
 * user actions. In-memory only; resets on refresh (not persisted).
 *
 * Not a critical affordance: anyone who uses it has earned it. Mouse-
 * hover lifts opacity so the chip can be spotted without being loud
 * during normal work.
 */

export interface ChangeLogEntry {
  /** Monotonic — used as the React key. */
  id: number
  /** Date.now() when the event fired. */
  ts: number
  /** Short slug for the colored badge ("pin", "unpin", "mode", ...). */
  type: string
  /** Human-readable sentence. */
  text: string
}

interface Props {
  entries: ChangeLogEntry[]
  onClear?: () => void
}

const MAX_VISIBLE = 8

function formatAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return "now"
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return `${h}h`
}

export function ChangeLog({ entries, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState<number>(() => Date.now())
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [open])

  // Click outside closes. Only armed while open so we don't pay for the
  // listener in steady state.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])

  // Escape closes — same pattern as other floating panels.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  const visible = entries.slice(0, MAX_VISIBLE)

  return (
    <div
      ref={rootRef}
      className={"change-log" + (open ? " change-log--open" : "")}
    >
      {open && (
        <div className="change-log__panel" role="log" aria-live="off">
          <div className="change-log__panel-head">
            <span className="change-log__title">Recent changes</span>
            {entries.length > 0 && onClear && (
              <button
                type="button"
                className="change-log__clear"
                onClick={onClear}
                title="Clear log"
              >
                clear
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <div className="change-log__empty">No changes yet.</div>
          ) : (
            <ul className="change-log__list">
              {visible.map(e => (
                <li key={e.id} className="change-log__entry">
                  <span
                    className={`change-log__badge change-log__badge--${e.type}`}
                    aria-hidden="true"
                  >
                    {e.type}
                  </span>
                  <span className="change-log__text">{e.text}</span>
                  <span className="change-log__time">{formatAgo(e.ts, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        className="change-log__toggle"
        aria-label={open ? "Hide change log" : "Show recent changes"}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span aria-hidden="true">{"\u22EF"}</span>
      </button>
    </div>
  )
}
