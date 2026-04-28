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

interface Props {
  progress: SolveProgressState | null
  /** true while `solveStatus === "running"` — used to keep the UI mounted
   *  even if no events have arrived yet (e.g., solve_started just fired). */
  isSolving: boolean
  /** Accepted but no longer wired — the bar now persists until the next
   *  solve (no dismiss X). Kept on the interface so call sites don't need
   *  to change. */
  onDismiss?: () => void
  /** Currently shown mode (highlights the corresponding card / chip). */
  activeMode?: string
  /** Click on a `done` mode chip (collapsed) or card (expanded) flips the
   *  calendar to that mode's cached schedule. */
  onSelectMode?: (mode: string) => void
  /** Open the SolverTuning modal. When provided, the middle (Tune) card
   *  surfaces a gear button next to its status pill. */
  onOpenTuning?: () => void
}

export function SolveProgress(props: Props) {
  const { progress, isSolving, activeMode, onSelectMode, onOpenTuning } = props

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

  // Expanded-by-default after a solve: the per-mode cards are the whole
  // point of generating, so chairs see them without a "Details" click.
  // During a running solve we force-show the cards — mid-flight numbers
  // are the whole point.
  const [expanded, setExpanded] = useState(true)

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
  // Inline chips let the user flip between the three generated calendars
  // without expanding Details. Only rendered in the collapsed done state;
  // expanded view has the full mode cards for the same action.
  const showModeChips = isCollapsible && !expanded && !!onSelectMode

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
        {showModeChips && (
          <div
            className="solve-progress__mode-chips"
            role="tablist"
            aria-label="Solve mode"
          >
            {orderedKeys.map(key => {
              const m = progress.modes[key]
              if (m.state !== "done") return null
              const isActive = activeMode === key
              const placed =
                m.nPlaced !== null && m.nTotal !== null
                  ? `${m.nPlaced}/${m.nTotal}`
                  : null
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={
                    "solve-progress__mode-chip" +
                    (isActive ? " solve-progress__mode-chip--active" : "")
                  }
                  onClick={() => onSelectMode?.(key)}
                  title={
                    isActive
                      ? `${MODE_LABELS[key] ?? key} — currently shown on the board`
                      : `Show ${MODE_LABELS[key] ?? key} on the board`
                  }
                >
                  <span className="solve-progress__mode-chip-label">
                    {MODE_LABELS[key] ?? key}
                  </span>
                  {placed && (
                    <span className="solve-progress__mode-chip-count">
                      {placed}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
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
                {!(m.state === "done" && m.status === "optimal") && (
                  <span className={`solve-progress__pill solve-progress__pill--${m.state}`}>
                    {statusLabel(m, liveElapsedMs)}
                  </span>
                )}
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
