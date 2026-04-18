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
  affinity_first:  "Affinity",
  time_pref_first: "Time Pref",
  balanced:        "Balanced",
}

const MODE_ORDER = ["affinity_first", "time_pref_first", "balanced"] as const

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
  onDismiss: () => void
}

export function SolveProgress(props: Props) {
  const { progress, isSolving, onDismiss } = props

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
            ? "Solve failed"
            : anyRunning
              ? "Solving…"
              : "Solve complete"}
        </span>
        <span className="solve-progress__elapsed">
          {formatSeconds(Math.round(totalElapsedMs))}
        </span>
        {!anyRunning && (
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

      <div className="solve-progress__modes">
        {orderedKeys.map(key => {
          const m = progress.modes[key]
          const liveElapsedMs =
            m.state === "running" && progress.startedAt !== null
              ? Math.max(0, now - progress.startedAt)
              : m.elapsedMs
          return (
            <div
              key={key}
              className={`solve-progress__mode solve-progress__mode--${m.state}`}
              data-mode={key}
            >
              <div className="solve-progress__mode-row">
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
                  <span className="solve-progress__metric-label">Score</span>
                  <span className="solve-progress__metric-value solve-progress__metric-value--numeric">
                    {m.bestObjective !== null ? m.bestObjective : "—"}
                  </span>
                </span>
                <span
                  className="solve-progress__metric"
                  title="Each time the solver finds a better arrangement than its previous best, this ticks up. The number you see at the end is the one displayed on the board — earlier ones were stepping stones."
                >
                  <span className="solve-progress__metric-label">Solutions</span>
                  <span className="solve-progress__metric-value solve-progress__metric-value--numeric">
                    {m.solutionsFound}
                  </span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
