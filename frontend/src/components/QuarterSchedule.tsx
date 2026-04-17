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

const DAY_GROUPS: ReadonlyArray<{ key: DayGroup; label: string }> = [
  { key: 1, label: "MW" },
  { key: 2, label: "TTh" },
] as const

const SOLVE_MODE_OPTIONS: ReadonlyArray<{ key: SolveMode; label: string }> = [
  { key: "affinity_first", label: "Affinity" },
  { key: "time_pref_first", label: "Time Pref" },
  { key: "balanced", label: "Balanced" },
]

const DND_MIME = "application/x-offering"

/** effectiveSlot — assignment (solver output) beats pinned (user placement). */
function effectiveSlot(o: Offering): Slot | null {
  if (o.assignment) return o.assignment.slot
  if (o.pinned) return o.pinned
  return null
}

export interface QuarterScheduleProps {
  offerings: Offering[]
  selectedOfferingId: string | null
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  solveStatus: SolveStatus
  solveMode: SolveMode
  placingId: string | null
  /** null while probing, true if /api/health replied, false if unreachable. */
  apiAvailable: boolean | null
  /** Error message from the last solve / export, if any. */
  solveError: string | null
  /** Live per-mode progress during a streaming solve. null between solves. */
  solveProgress: SolveProgressState | null
  onSelect: (id: string | null) => void
  onSelectProfessor: (id: string | null) => void
  onAdd: (catalog_id: string) => void
  onPinToSlot: (catalog_id: string, slot: Slot | null) => void
  onSetSolveMode: (mode: SolveMode) => void
  onSolve: () => void
  onExport: () => void
  onStartPlacing: (id: string) => void
  onDismissError: () => void
  onDismissProgress: () => void
}

export function QuarterSchedule(props: QuarterScheduleProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [visibleDayGroup, setVisibleDayGroup] = useState<DayGroup>(1)

  const isSolving = props.solveStatus === "running"
  const apiReady = props.apiAvailable === true
  const canGenerate = apiReady && props.offerings.length > 0 && !isSolving
  const canExport = apiReady && props.solveStatus === "done" && !isSolving
  const generateTitle =
    props.apiAvailable === false
      ? "Solver requires the local launcher (run ./launch_workspace.sh)"
      : props.apiAvailable === null
        ? "Checking solver backend..."
        : props.offerings.length === 0
          ? "Add offerings first"
          : isSolving
            ? "Solving..."
            : "Generate schedule"

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

  const handleDrop = (
    e: React.DragEvent,
    target: { kind: "cell"; slot: Slot } | { kind: "dock" },
  ) => {
    e.preventDefault()
    setDragOverKey(null)
    setDraggingId(null)
    const catId =
      e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain")
    if (!catId) return
    const isOffering = props.offerings.some(o => o.catalog_id === catId)
    if (!isOffering) {
      // Dragging a catalogue course that isn't in offerings yet: add first.
      props.onAdd(catId)
    }
    if (target.kind === "cell") {
      props.onPinToSlot(catId, target.slot)
    } else {
      props.onPinToSlot(catId, null)
    }
    props.onSelect(catId)
  }

  const renderCard = (o: Offering) => {
    const course = props.catalog[o.catalog_id]
    const profId = o.assignment?.prof_id ?? o.assigned_prof_id
    const roomId = o.assignment?.room_id ?? o.assigned_room_id
    const prof = profId ? props.professors[profId] : null
    const room = roomId ? props.rooms[roomId] : null
    const dept = course?.department ?? "game"
    const isSelected = props.selectedOfferingId === o.catalog_id
    const isDragging = draggingId === o.catalog_id
    const isPlacing = props.placingId === o.catalog_id

    return (
      <button
        key={o.catalog_id}
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
          props.onSelect(o.catalog_id)
          props.onStartPlacing(o.catalog_id)
        }}
        onDragStart={e => {
          e.dataTransfer.setData(DND_MIME, o.catalog_id)
          e.dataTransfer.setData("text/plain", o.catalog_id)
          e.dataTransfer.effectAllowed = "move"
          setDraggingId(o.catalog_id)
          props.onSelect(o.catalog_id)
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
        <span className="schedule-card__prof">
          {prof ? prof.name.split(" ").slice(-1)[0] : "AUTO"}
        </span>
        <span className="schedule-card__room">
          {room ? room.name.split("–")[0].trim().replace("Room ", "") : "—"}
        </span>
      </button>
    )
  }

  return (
    <section className="panel panel--schedule" aria-label="Quarter Schedule">
      <header className="panel__header">
        <h2 className="panel__title">Quarter Schedule</h2>
        <div className="schedule__toolbar">
          <div className="schedule__mode" role="tablist" aria-label="Solve mode">
            {SOLVE_MODE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                role="tab"
                aria-selected={props.solveMode === opt.key}
                className={
                  "chip" +
                  (props.solveMode === opt.key ? " chip--active" : "")
                }
                onClick={() => props.onSetSolveMode(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="panel__actions">
            <button
              disabled={!canGenerate}
              onClick={props.onSolve}
              title={generateTitle}
            >
              {isSolving ? "Solving…" : "Generate"}
            </button>
            <button
              disabled={!canExport}
              onClick={props.onExport}
              title={apiReady ? "Download Excel" : generateTitle}
            >
              Export
            </button>
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
                {ts}
              </div>
              {DAY_GROUPS.map(g => {
                const cellKey = `${g.key}|${ts}`
                const cards = placedByCell.get(cellKey) ?? []
                const slot: Slot = { day_group: g.key, time_slot: ts }
                const isDropTarget = dragOverKey === cellKey
                const canPinClick =
                  props.selectedOfferingId !== null &&
                  !cards.some(c => c.catalog_id === props.selectedOfferingId)
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
                    onDrop={e => handleDrop(e, { kind: "cell", slot })}
                  >
                    {cards.map(renderCard)}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>

        {/* Thin drop strip — drag a card here to unpin it from the grid */}
        <div
          className={
            "schedule-unpin-strip" +
            (dragOverKey === "dock" ? " schedule-unpin-strip--over" : "")
          }
          aria-label="Drop here to unpin"
          onClick={() => {
            if (props.placingId) props.onPinToSlot(props.placingId, null)
          }}
          onDragOver={e => {
            e.preventDefault()
            e.dataTransfer.dropEffect = "move"
            if (dragOverKey !== "dock") setDragOverKey("dock")
          }}
          onDragLeave={() => {
            if (dragOverKey === "dock") setDragOverKey(null)
          }}
          onDrop={e => handleDrop(e, { kind: "dock" })}
        >
          <span className="schedule-unpin-strip__label">
            {props.placingId ? "Tap to unpin" : "Drop to unpin"}
          </span>
        </div>
      </div>
    </section>
  )
}
