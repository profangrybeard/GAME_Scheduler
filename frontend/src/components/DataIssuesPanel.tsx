/**
 * Topbar popover that surfaces structured validation errors from the most
 * recent /api/state/parse. Mirrors TopbarMenu's popover idiom (trigger + outside
 * click / Escape close) so the user learns one pattern, not two.
 *
 * Phase 3.1: passive display only. Clicking an entry does nothing yet — the
 * fix flow lands in Phase 3.3. Empty state hides the trigger entirely; no
 * point advertising a panel with nothing in it.
 *
 * Severity handling: entries group by severity (error → warning → info) then
 * by sheet then by row, so the most actionable issues float to the top.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ValidationError } from "../api"

interface DataIssuesPanelProps {
  errors: ValidationError[] | null
}

const SEVERITY_ORDER: Record<ValidationError["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const SEVERITY_LABEL: Record<ValidationError["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
}

/** Turn a technical sheet name like `_data_offerings` into `Offerings`.
 *  Falls back to the raw name for anything unexpected, so a future sheet we
 *  haven't mapped still shows *something* readable. */
function friendlySheet(sheet: string): string {
  const stripped = sheet.startsWith("_data_") ? sheet.slice("_data_".length) : sheet
  if (!stripped) return sheet
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).replace(/_/g, " ")
}

export function DataIssuesPanel({ errors }: DataIssuesPanelProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const sorted = useMemo(() => {
    if (!errors || errors.length === 0) return []
    return [...errors].sort((a, b) => {
      const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (sev !== 0) return sev
      if (a.sheet !== b.sheet) return a.sheet.localeCompare(b.sheet)
      return a.row - b.row
    })
  }, [errors])

  const count = sorted.length

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

  if (count === 0) return null

  const hasErrors = sorted.some(e => e.severity === "error")

  return (
    <div className="topbar-menu data-issues" ref={rootRef}>
      <button
        type="button"
        className={
          "topbar-menu__trigger data-issues__trigger" +
          (hasErrors ? " data-issues__trigger--errors" : " data-issues__trigger--warnings")
        }
        onClick={() => setOpen(v => !v)}
        aria-label={`Data issues (${count})`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${count} data issue${count === 1 ? "" : "s"} from the last load`}
      >
        <span aria-hidden="true" className="data-issues__glyph">!</span>
        <span className="data-issues__badge" aria-hidden="true">{count}</span>
      </button>

      {open && (
        <div className="topbar-menu__popover data-issues__popover" role="dialog" aria-label="Data Issues">
          <div className="data-issues__header">
            <span className="data-issues__title">Data Issues</span>
            <span className="data-issues__count">{count} total</span>
          </div>
          <ul className="data-issues__list">
            {sorted.map((e, i) => (
              <li key={i} className={`data-issues__item data-issues__item--${e.severity}`}>
                <div className="data-issues__item-head">
                  <span className={`data-issues__chip data-issues__chip--${e.severity}`}>
                    {SEVERITY_LABEL[e.severity]}
                  </span>
                  <span className="data-issues__loc">
                    {friendlySheet(e.sheet)} · row {e.row} · {e.column}
                  </span>
                </div>
                <div className="data-issues__reason">{e.reason}</div>
              </li>
            ))}
          </ul>
          <div className="data-issues__footnote">
            Fix these in the workbook and reload to clear them. Click-to-edit
            arrives in a later phase.
          </div>
        </div>
      )}
    </div>
  )
}
