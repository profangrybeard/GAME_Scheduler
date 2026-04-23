import { Fragment, useMemo, useState } from "react"
import type {
  Course,
  DayGroup,
  Offering,
  Professor,
  Room,
  Slot,
  SolveMode,
  SolveProgressState,
  SolveStatus,
  TimeSlot,
} from "../types"
import { ProfAvatar } from "./ProfAvatar"
import { SolveProgress } from "./SolveProgress"

/**
 * The CONTROLLER panel — Quarter Schedule.
 *
 * Responsibility: the weekly grid. 2 day groups (MW, TTh) × 4 time slots
 * (8, 11, 2, 5). Placed offerings render in their cell. Unplaced offerings
 * sit in a dock below the grid.
 *
 * Interactions:
 *   • Click a card to select it (Class panel updates)
 *   • Click an empty cell with a selection to pin
 *   • Drag a catalogue row, a placed card, or a dock card into any cell to
 *     pin it there
 *   • Drag a placed card into the dock to unpin
 */

const TIME_SLOTS: readonly TimeSlot[] = [
  "8:00AM",
  "11:00AM",
  "2:00PM",
  "5:00PM",
] as const

const TIME_LABELS: Record<TimeSlot, string> = {
  "8:00AM": "8 AM",
  "11:00AM": "11 AM",
  "2:00PM": "2 PM",
  "5:00PM": "5 PM",
}

const DAY_GROUPS: ReadonlyArray<{ key: DayGroup; label: string }> = [
  { key: 1, label: "MW" },
  { key: 2, label: "TTh" },
  { key: 3, label: "F" },
] as const

/** DnD MIME for dragging an existing placed/docked offering (payload:
 *  offering_id). Catalogue drags use `application/x-course` with a catalog_id
 *  payload; the drop handler checks both and dispatches add+pin accordingly. */
const DND_MIME_OFFERING = "application/x-offering"
const DND_MIME_COURSE = "application/x-course"

/** effectiveSlot — assignment (solver output) beats pinned (user placement). */
function effectiveSlot(o: Offering): Slot | null {
  if (o.assignment) return o.assignment.slot
  if (o.pinned) return o.pinned
  return null
}

const QUARTER_OPTIONS: ReadonlyArray<string> = ["Fall", "Winter", "Spring", "Summer"]

export interface QuarterScheduleProps {
  offerings: Offering[]
  selectedOfferingId: string | null
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  /** Current quarter label (e.g. "Fall"). Rendered in the panel title with an
   *  inline <select> so the user can swap the header without leaving the grid. */
  quarter: string
  solveStatus: SolveStatus
  solveMode: SolveMode
  placingId: string | null
  /** null while probing, true if /api/health replied, false if unreachable. */
  apiAvailable: boolean | null
  /** Error message from the last solve / export, if any. */
  solveError: string | null
  /** Live per-mode progress during a streaming solve. null between solves. */
  solveProgress: SolveProgressState | null
  onSelect: (offering_id: string | null) => void
  onSelectProfessor: (id: string | null) => void
  /** Add an offering for catalog_id. Returns the new (or existing) offering_id
   *  so the DnD drop handler can chain onPinToSlot without a re-render wait. */
  onAdd: (catalog_id: string) => string | null
  onPinToSlot: (offering_id: string, slot: Slot | null) => void
  onSetSolveMode: (mode: SolveMode) => void
  onSetQuarter: (quarter: string) => void
  onSolve: () => void
  onEmptyCalendar: () => void
  /** True when the Clear button is in stage-2 (next click also drops user
   *  pins). Renders a matching red dot on the button so the cue lines up
   *  with the pins' own dots. */
  clearArmed: boolean
  onStartPlacing: (offering_id: string) => void
  onDismissError: () => void
  onDismissProgress: () => void
  /** Open the SolverTuning modal — forwarded to the Tune mode card. */
  onOpenTuning: () => void
}

export function QuarterSchedule(props: QuarterScheduleProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [visibleDayGroup, setVisibleDayGroup] = useState<DayGroup>(1)
  // Ticks on each Assemble click so the gold chaser element re-mounts and
  // re-plays its 1s perimeter trace. Cleared by the chaser's onAnimationEnd.
  const [chaseKey, setChaseKey] = useState(0)

  const isSolving = props.solveStatus === "running"
  const apiReady = props.apiAvailable === true
  const canGenerate = apiReady && props.offerings.length > 0 && !isSolving
  const generateTitle =
    props.apiAvailable === false
      ? "Solver requires the local launcher (run ./launch_workspace.sh)"
      : props.apiAvailable === null
        ? "Checking solver backend..."
        : props.offerings.length === 0
          ? "Add offerings first"
          : isSolving
            ? "Assembling..."
            : "Assemble the schedule"

  const placedByCell = useMemo(() => {
    const placed = new Map<string, Offering[]>()
    for (const o of props.offerings) {
      const slot = effectiveSlot(o)
      if (!slot) continue
      const key = `${slot.day_group}|${slot.time_slot}`
      const bucket = placed.get(key) ?? []
      bucket.push(o)
      placed.set(key, bucket)
    }
    return placed
  }, [props.offerings])

  const handleDrop = (e: React.DragEvent, slot: Slot) => {
    e.preventDefault()
    setDragOverKey(null)
    setDraggingId(null)

    // Offering drags carry offering_id (existing row). Catalogue drags carry
    // catalog_id — we add + pin in one gesture. text/plain is a last-ditch
    // fallback for browsers that strip custom MIME types.
    let offeringId = e.dataTransfer.getData(DND_MIME_OFFERING)
    const catalogId = e.dataTransfer.getData(DND_MIME_COURSE)
    const textFallback = e.dataTransfer.getData("text/plain")

    if (!offeringId && catalogId) {
      const newId = props.onAdd(catalogId)
      if (!newId) return
      offeringId = newId
    } else if (!offeringId && textFallback) {
      // Legacy / cross-origin fallback: decide whether it's an offering_id
      // already in state, or a catalog_id to add.
      const existing = props.offerings.find(o => o.offering_id === textFallback)
      if (existing) {
        offeringId = existing.offering_id
      } else {
        const newId = props.onAdd(textFallback)
        if (!newId) return
        offeringId = newId
      }
    }
    if (!offeringId) return

    props.onPinToSlot(offeringId, slot)
    props.onSelect(offeringId)
  }

  const renderCard = (o: Offering) => {
    const course = props.catalog[o.catalog_id]
    const profId = o.assignment?.prof_id ?? o.assigned_prof_id
    const roomId = o.assignment?.room_id ?? o.assigned_room_id
    const prof = profId ? props.professors[profId] : null
    const room = roomId ? props.rooms[roomId] : null
    const dept = course?.department ?? "game"
    const isSelected = props.selectedOfferingId === o.offering_id
    const isDragging = draggingId === o.offering_id
    const isPlacing = props.placingId === o.offering_id
    // Prof text is "tentative" (italic, faint) when the displayed name will
    // NOT survive a move — i.e. no manual pick. Covers both AUTO (no prof)
    // and solver-assigned (prof came from the solver, drops on drag).
    const profIsTentative = !o.assigned_prof_id

    return (
      <button
        key={o.offering_id}
        type="button"
        draggable
        className={
          "schedule-card dept--" +
          dept +
          (isSelected ? " schedule-card--selected" : "") +
          (isDragging ? " schedule-card--dragging" : "") +
          (isPlacing ? " schedule-card--placing" : "")
        }
        onClick={e => {
          e.stopPropagation()
          props.onSelect(o.offering_id)
          props.onStartPlacing(o.offering_id)
        }}
        onDragStart={e => {
          e.dataTransfer.setData(DND_MIME_OFFERING, o.offering_id)
          e.dataTransfer.setData("text/plain", o.offering_id)
          e.dataTransfer.effectAllowed = "move"
          setDraggingId(o.offering_id)
          props.onSelect(o.offering_id)
        }}
        onDragEnd={() => setDraggingId(null)}
      >
        <span
          className="schedule-card__avatar-hit"
          role="button"
          tabIndex={-1}
          onClick={e => {
            e.stopPropagation()
            if (profId) props.onSelectProfessor(profId)
          }}
        >
          <ProfAvatar
            profId={profId}
            name={prof?.name}
            size={24}
            className="schedule-card__avatar"
          />
        </span>
        <span className="schedule-card__id">{o.catalog_id}</span>
        <span
          className={
            "schedule-card__prof" +
            (profIsTentative ? " schedule-card__prof--tentative" : "")
          }
        >
          {prof ? prof.name.split(" ").slice(-1)[0] : "AUTO"}
        </span>
        <span className="schedule-card__room">
          {room ? room.name.split("–")[0].trim().replace("Room ", "") : "—"}
        </span>
        {o.pinned !== null && (
          <span
            className="schedule-card__pin-dot"
            aria-label="Manually placed by you"
            title="You placed this card. Use Empty Calendar twice to remove it."
          />
        )}
      </button>
    )
  }

  const quarterValue = QUARTER_OPTIONS.includes(props.quarter) ? props.quarter : "Fall"

  return (
    <section className="panel panel--schedule" aria-label={`${quarterValue} Schedule`}>
      <header className="panel__header">
        <h2 className="panel__title">
          <span className="panel__title-select-wrap">
            <select
              className="panel__title-select"
              value={quarterValue}
              onChange={e => props.onSetQuarter(e.target.value)}
              aria-label="Quarter"
            >
              {QUARTER_OPTIONS.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
            <span className="panel__title-select-caret" aria-hidden="true">▾</span>
          </span>
          {" "}Schedule
        </h2>
        <div className="schedule__toolbar">
          {/* Mode selection moved to the SolveProgress mode cards — clicking
              an Affinity/Time Pref/Balanced card flips the calendar to that
              mode's cached results. The redundant chip row was removed. */}
          <div className="panel__actions">
            <button
              type="button"
              className={"btn-generate" + (isSolving ? " btn-generate--solving" : "")}
              disabled={!canGenerate}
              onClick={() => {
                setChaseKey(k => k + 1)
                props.onSolve()
              }}
              title={generateTitle}
            >
              {chaseKey > 0 && (
                <span
                  key={chaseKey}
                  className="btn-generate__chaser"
                  aria-hidden="true"
                  onAnimationEnd={() => setChaseKey(0)}
                />
              )}
              {isSolving ? (
                <span className="btn-generate__spinner" aria-hidden="true" />
              ) : (
                <svg
                  className="btn-generate__icon"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
                </svg>
              )}
              {isSolving ? "Assembling…" : "ASSEMBLE"}
            </button>
            <button
              className={
                "btn-empty-calendar" +
                (props.clearArmed ? " btn-empty-calendar--armed" : "")
              }
              disabled={isSolving}
              onClick={props.onEmptyCalendar}
              title={
                props.clearArmed
                  ? "Click again to also clear your manually placed cards."
                  : "Clear solver results and start over. User-placed cards stay."
              }
            >
              Empty Calendar
              {props.clearArmed && (
                <span
                  className="btn-empty-calendar__armed-dot"
                  aria-hidden="true"
                />
              )}
            </button>
            <a
              className="solver-badge"
              href="https://developers.google.com/optimization/cp/cp_solver"
              target="_blank"
              rel="noopener noreferrer"
              title={
                "Assemble runs Google OR-Tools CP-SAT locally — a constraint" +
                " solver, not AI. It enumerates schedules that respect every" +
                " rule (rooms, professors, time slots) and picks the best fit." +
                " Click to learn more."
              }
              aria-label="Learn about the OR-Tools constraint solver"
            >
              <span className="solver-badge__label">OR</span>
            </a>
          </div>
        </div>
      </header>

      {props.solveError && (
        <div className="schedule__error" role="alert">
          <span className="schedule__error-text">{props.solveError}</span>
          <button
            type="button"
            className="schedule__error-dismiss"
            onClick={props.onDismissError}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <SolveProgress
        progress={props.solveProgress}
        isSolving={isSolving}
        onDismiss={props.onDismissProgress}
        activeMode={props.solveMode}
        onSelectMode={(mode) => props.onSetSolveMode(mode as typeof props.solveMode)}
        onOpenTuning={props.onOpenTuning}
      />

      <div className="schedule__day-toggle" role="tablist" aria-label="Day group">
        {DAY_GROUPS.map(g => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={visibleDayGroup === g.key}
            className={
              "chip" + (visibleDayGroup === g.key ? " chip--active" : "")
            }
            onClick={() => setVisibleDayGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="panel__body schedule-body">
        <div
          className={
            "schedule-grid" + (props.placingId ? " schedule-grid--placing" : "")
          }
          role="grid"
        >
          <div className="schedule-grid__corner" aria-hidden="true" />
          {DAY_GROUPS.map(g => (
            <div
              key={`h-${g.key}`}
              className={
                "schedule-grid__day-header" +
                (g.key !== visibleDayGroup ? " schedule-grid__day-header--hidden" : "")
              }
              role="columnheader"
            >
              {g.label}
            </div>
          ))}
          {TIME_SLOTS.map(ts => (
            <Fragment key={ts}>
              <div className="schedule-grid__time-header" role="rowheader">
                {TIME_LABELS[ts]}
              </div>
              {DAY_GROUPS.map(g => {
                const cellKey = `${g.key}|${ts}`
                const cards = placedByCell.get(cellKey) ?? []
                const slot: Slot = { day_group: g.key, time_slot: ts }
                const isDropTarget = dragOverKey === cellKey
                const canPinClick =
                  props.selectedOfferingId !== null &&
                  !cards.some(c => c.offering_id === props.selectedOfferingId)
                const isHidden = g.key !== visibleDayGroup // only hidden on portrait via CSS
                // Density: 1-2 → column; 3-4 → 2-col grid; 5+ → 2-col + compact cards.
                const densityClass =
                  cards.length >= 5
                    ? " schedule-grid__cell--grid schedule-grid__cell--dense"
                    : cards.length >= 3
                      ? " schedule-grid__cell--grid"
                      : ""
                return (
                  <div
                    key={`c-${g.key}-${ts}`}
                    className={
                      "schedule-grid__cell" +
                      densityClass +
                      (isDropTarget ? " schedule-grid__cell--over" : "") +
                      (isHidden ? " schedule-grid__cell--hidden" : "")
                    }
                    role="gridcell"
                    data-day-group={g.key}
                    data-time-slot={ts}
                    data-count={cards.length}
                    onClick={() => {
                      if (props.placingId) {
                        props.onPinToSlot(props.placingId, slot)
                      } else if (canPinClick && props.selectedOfferingId) {
                        props.onPinToSlot(props.selectedOfferingId, slot)
                      }
                    }}
                    onDragOver={e => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                      if (dragOverKey !== cellKey) setDragOverKey(cellKey)
                    }}
                    onDragLeave={() => {
                      if (dragOverKey === cellKey) setDragOverKey(null)
                    }}
                    onDrop={e => handleDrop(e, slot)}
                  >
                    {cards.map(renderCard)}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  )
}
