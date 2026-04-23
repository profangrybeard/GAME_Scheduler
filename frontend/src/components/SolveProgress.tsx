import { useEffect, useState } from "react"
import type { SolveModeProgress, SolveProgressState } from "../types"

/**
 * Live progress display for an in-flight (or recently-completed) solve.
 *
 * Renders one card per mode with: status pill, objective, sections placed,
 * elapsed time, solutions-found counter. Replaces the old "silent spinner"
 * approach — every number comes from a real solver event, not a timer
 * pretending to be progress.
 *
 * Ticks once a second while any mode is still running so the "elapsed"
 * counter reflects wall-clock instead of freezing between CP-SAT events.
 */

const MODE_LABELS: Record<string, string> = {
  cover_first:     "Cover",
  time_pref_first: "Time Pref",
  // The middle mode is user-tunable: clicking the gear opens SolverTuning,
  // which sends a fresh solve with the new mix as `tunedWeights`.
  balanced:        "Tune",
}

// Tune sits in the middle: extremes on the wings (Cover-First, Time-First),
// the user-tuned mix between them. The middle card is the one with the gear,
// reinforcing that this column is the editable one.
const MODE_ORDER = ["cover_first", "balanced", "time_pref_first"] as const

function formatSeconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  return `${Math.round(s)}s`
}

function statusLabel(mode: SolveModeProgress, liveElapsedMs: number | null): string {
  if (mode.state === "done") {
    if (mode.status === "optimal") return "Optimal"
    if (mode.status === "feasible") return "Feasible"
    if (mode.status === "infeasible") return "Infeasible"
    return mode.status ?? "Done"
  }
  if (mode.state === "running") {
    return liveElapsedMs !== null
      ? `Searching · ${formatSeconds(liveElapsedMs)}`
      : "Searching…"
  }
  return "Waiting"
}

/** Condense the three per-mode statuses into one header pill so the default
 *  done-state view doesn't shout "OPTIMAL" three times in a row. Returns an
 *  empty string if nothing is done yet (caller should hide the pill). */
function computeSummary(modes: Record<string, SolveModeProgress>): string {
  const done = Object.values(modes).filter(m => m.state === "done")
  if (done.length === 0) return ""
  const counts = { optimal: 0, feasible: 0, infeasible: 0, other: 0 }
  for (const m of done) {
    if (m.status === "optimal") counts.optimal++
    else if (m.status === "feasible") counts.feasible++
    else if (m.status === "infeasible") counts.infeasible++
    else counts.other++
  }
  // All-same case reads cleaner as "3/3 optimal" than "3 optimal".
  if (counts.optimal === done.length) return `${done.length}/${done.length} optimal`
  if (counts.feasible === done.length) return `${done.length}/${done.length} feasible`
  if (counts.infeasible === done.length) return `${done.length}/${done.length} infeasible`
  const parts: string[] = []
  if (counts.optimal)    parts.push(`${counts.optimal} optimal`)
  if (counts.feasible)   parts.push(`${counts.feasible} feasible`)
  if (counts.infeasible) parts.push(`${counts.infeasible} infeasible`)
  if (counts.other)      parts.push(`${counts.other} other`)
  return parts.join(" · ")
}

interface Props {
  progress: SolveProgressState | null
  /** true while `solveStatus === "running"` — used to keep the UI mounted
   *  even if no events have arrived yet (e.g., solve_started just fired). */
  isSolving: boolean
  onDismiss: () => void
  /** Currently shown mode (highlights the corresponding card). */
  activeMode?: string
  /** Click on a `done` mode card flips the calendar to that mode's cached
   *  schedule — same effect the now-removed Affinity/Time Pref/Balanced
   *  chip buttons in QuarterSchedule used to have. */
  onSelectMode?: (mode: string) => void
  /** Open the SolverTuning modal. When provided, the middle (Tune) card
   *  surfaces a gear button next to its status pill. */
  onOpenTuning?: () => void
}

export function SolveProgress(props: Props) {
  const { progress, isSolving, onDismiss, activeMode, onSelectMode, onOpenTuning } = props

  // `now` is driven by a 250ms interval while a solve is in flight. Using
  // state (instead of calling performance.now() during render) keeps the
  // component pure per React's rules-of-hooks lint. First update lands on
  // the first interval tick — elapsed reads "0ms" for up to 250ms after
  // the stream opens, which is imperceptible next to the 10–30s solve.
  const [now, setNow] = useState<number>(() => performance.now())
  useEffect(() => {
    if (!progress || progress.endedAt !== null) return
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [progress, progress?.endedAt])

  // Collapsed-by-default for done states: the summary pill ("3/3 optimal")
  // is enough at a glance. Expanding reveals the per-mode metrics grid.
  // During a running solve we force-show the cards — mid-flight numbers
  // are the whole point.
  const [expanded, setExpanded] = useState(false)

  if (!progress && !isSolving) return null
  if (!progress) {
    return (
      <div className="solve-progress solve-progress--starting" role="status">
        <span className="solve-progress__title">Starting solve…</span>
      </div>
    )
  }

  const anyRunning = Object.values(progress.modes).some(m => m.state === "running")
  const totalElapsedMs = progress.endedAt !== null && progress.startedAt !== null
    ? Math.max(0, progress.endedAt - progress.startedAt)
    : progress.startedAt !== null
      ? Math.max(0, now - progress.startedAt)
      : 0

  // Preserve the canonical mode ordering so the cards don't jump around as
  // events arrive for different modes.
  const orderedKeys: string[] = MODE_ORDER.filter(k => progress.modes[k])
  // Include any unexpected mode names (future-proofing) at the end.
  for (const k of Object.keys(progress.modes)) {
    if (!orderedKeys.includes(k)) orderedKeys.push(k)
  }

  // Can the user collapse/expand? Yes when we're in a settled done state
  // without an error. Mid-solve, writing, or error state → always show the
  // cards (hiding them would lose actionable detail).
  const isCollapsible =
    !anyRunning &&
    !progress.errorMessage &&
    progress.phase !== "writing" &&
    progress.phase !== "solving"
  const showModes = !isCollapsible || expanded
  const summaryText = isCollapsible ? computeSummary(progress.modes) : ""

  return (
    <div
      className={
        "solve-progress" +
        (anyRunning ? " solve-progress--running" : " solve-progress--done") +
        (progress.errorMessage ? " solve-progress--error" : "")
      }
      role="status"
      aria-live="polite"
    >
      <div className="solve-progress__header">
        <span className="solve-progress__title">
          {progress.errorMessage
            ? (progress.phase === "writing" || progress.phase === "exported"
                ? "Export failed"
                : "Solve failed")
            : progress.phase === "exported"
              ? "Export complete"
              : progress.phase === "writing"
                ? "Writing Excel…"
                : progress.phase === "solving"
                  ? "Building xlsx…"
                  : anyRunning
                    ? "Solving…"
                    : "Solve complete"}
        </span>
        <span className="solve-progress__elapsed">
          {formatSeconds(Math.round(totalElapsedMs))}
        </span>
        {summaryText && (
          <span className="solve-progress__summary">{summaryText}</span>
        )}
        {isCollapsible && onOpenTuning && (
          <button
            type="button"
            className="solve-progress__tune-btn solve-progress__tune-btn--header"
            onClick={onOpenTuning}
            aria-label="Tune solver weights"
            title="Tune the solver's weight mix"
          >
            ⚙
          </button>
        )}
        {isCollapsible && (
          <button
            type="button"
            className="solve-progress__toggle"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            title={expanded ? "Hide per-mode metrics" : "Show per-mode metrics"}
          >
            <span className="solve-progress__toggle-label">
              {expanded ? "Hide" : "Details"}
            </span>
            <span
              className={
                "solve-progress__toggle-chevron" +
                (expanded ? " solve-progress__toggle-chevron--open" : "")
              }
              aria-hidden="true"
            >
              ▸
            </span>
          </button>
        )}
        {/* Hide Dismiss while xlsx_writing is in flight — closing the panel
            would suggest the work is canceled, but the network call continues
            and the download fires either way. */}
        {!anyRunning && progress.phase !== "writing" && (
          <button
            type="button"
            className="solve-progress__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss solve progress"
          >
            ×
          </button>
        )}
      </div>

      {progress.errorMessage && (
        <div className="solve-progress__error-message">{progress.errorMessage}</div>
      )}

      {showModes && (
      <div className="solve-progress__modes">
        {orderedKeys.map(key => {
          const m = progress.modes[key]
          const liveElapsedMs =
            m.state === "running" && progress.startedAt !== null
              ? Math.max(0, now - progress.startedAt)
              : m.elapsedMs
          // The card is clickable only when the mode finished AND a
          // selection callback is wired. While solving, clicking would
          // be a no-op (no cached result to flip to).
          const isSelectable = m.state === "done" && !!onSelectMode
          const isActive = activeMode === key
          // The middle (balanced) card carries the Tune affordance. Surface
          // the gear whenever onOpenTuning is wired — even mid-solve, so
          // chairs can re-open and re-tune without waiting.
          const isTuneCard = key === "balanced" && !!onOpenTuning
          const className =
            "solve-progress__mode" +
            ` solve-progress__mode--${m.state}` +
            (isActive ? " solve-progress__mode--active" : "") +
            (isSelectable ? " solve-progress__mode--selectable" : "") +
            (isTuneCard ? " solve-progress__mode--tune" : "")
          const cardContent = (
            <>
              <div className="solve-progress__mode-row">
                {isTuneCard && (
                  <button
                    type="button"
                    className="solve-progress__tune-btn"
                    onClick={(e) => {
                      // The card-level handler (when selectable) would
                      // also flip the board to balanced — the gear is a
                      // distinct intent (open the modal), so swallow it.
                      e.stopPropagation()
                      onOpenTuning?.()
                    }}
                    onKeyDown={(e) => {
                      // Keep Enter/Space from also bubbling to the card's
                      // role=button (which would re-fire selection).
                      if (e.key === "Enter" || e.key === " ") e.stopPropagation()
                    }}
                    aria-label="Tune solver weights"
                    title="Tune the solver's weight mix"
                  >
                    ⚙
                  </button>
                )}
                <span className="solve-progress__mode-name">
                  {MODE_LABELS[key] ?? key}
                </span>
                <span className={`solve-progress__pill solve-progress__pill--${m.state}`}>
                  {statusLabel(m, liveElapsedMs)}
                </span>
              </div>
              <div className="solve-progress__metrics">
                <span
                  className="solve-progress__metric"
                  title="How many class sections the solver fit into a time slot, out of all it tried. Anything less than full means some sections couldn't fit — see the Unscheduled list in the exported Excel."
                >
                  <span className="solve-progress__metric-label">Placed</span>
                  <span className="solve-progress__metric-value">
                    {m.nPlaced !== null && m.nTotal !== null
                      ? `${m.nPlaced}/${m.nTotal}`
                      : "—"}
                  </span>
                </span>
                <span
                  className="solve-progress__metric"
                  title="Total penalty for soft preferences missed: professor-course affinity, time-of-day fit, day-of-week balance. Lower is better. Hard rules (no double-booking, room capacity) are enforced absolutely and don't add to this score."
                >
                  <span className="solve-progress__metric-label">Penalty</span>
                  <span className="solve-progress__metric-value solve-progress__metric-value--numeric">
                    {m.bestObjective !== null ? m.bestObjective : "—"}
                  </span>
                </span>
                <span
                  className="solve-progress__metric"
                  title="Each time the solver finds a better arrangement than its previous best, this ticks up. The number you see at the end is the one displayed on the board — earlier ones were stepping stones."
                >
                  <span className="solve-progress__metric-label">Tries</span>
                  <span className="solve-progress__metric-value solve-progress__metric-value--numeric">
                    {m.solutionsFound}
                  </span>
                </span>
              </div>
            </>
          )
          // When the Tune card needs to host a real <button> (the gear), we
          // can't also be a <button> — so render as a div with role=button
          // and keyboard handling. Other cards keep the cleaner native-button
          // path when selectable.
          if (isTuneCard) {
            return (
              <div
                key={key}
                className={className}
                data-mode={key}
                role={isSelectable ? "button" : undefined}
                tabIndex={isSelectable ? 0 : undefined}
                aria-pressed={isSelectable ? isActive : undefined}
                onClick={isSelectable ? () => onSelectMode?.(key) : undefined}
                onKeyDown={isSelectable ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelectMode?.(key)
                  }
                } : undefined}
                title={
                  isSelectable
                    ? (isActive
                        ? `${MODE_LABELS[key] ?? key} — currently shown on the board`
                        : `Show ${MODE_LABELS[key] ?? key} on the board`)
                    : undefined
                }
              >
                {cardContent}
              </div>
            )
          }
          // Render as a real <button> when selectable so keyboard + screen-
          // reader users get the same affordance as click. Otherwise plain div.
          return isSelectable ? (
            <button
              key={key}
              type="button"
              className={className}
              data-mode={key}
              onClick={() => onSelectMode?.(key)}
              aria-pressed={isActive}
              title={
                isActive
                  ? `${MODE_LABELS[key] ?? key} — currently shown on the board`
                  : `Show ${MODE_LABELS[key] ?? key} on the board`
              }
            >
              {cardContent}
            </button>
          ) : (
            <div key={key} className={className} data-mode={key}>
              {cardContent}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
