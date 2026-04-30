import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { QUARTER_OPTIONS } from "../types"
import type {
  Course,
  DayGroup,
  Offering,
  Professor,
  Room,
  RoomBlackout,
  Slot,
  SolveMode,
  SolveProgressState,
  SolveStatus,
  TimeSlot,
} from "../types"
import { useTheme } from "../hooks/useTheme"
import { ProfAvatar } from "./ProfAvatar"
import { ScheduleMenu } from "./ScheduleMenu"
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


export interface QuarterScheduleProps {
  offerings: Offering[]
  selectedOfferingId: string | null
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  /** External holds on (room × slot) cells. Render as muted striped cards
   *  alongside class cards in the cell where their slot lives. */
  roomBlackouts: RoomBlackout[]
  /** Current quarter label (e.g. "Fall"). Rendered as an inline <select>
   *  in the grid's top-left corner so the context sits on the calendar
   *  itself instead of floating in the topbar. */
  quarter: string
  /** Setter for the quarter label. Fires from the corner-cell select. */
  onSetQuarter: (quarter: string) => void
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
  /** Add a room blackout for (room, slot) with a free-form note. App.tsx
   *  trims and caps the note; this just hands the form values up. */
  onAddBlackout: (room_id: string, slot: Slot, note: string) => void
  /** Remove a blackout by id (the muted card's hover-X dispatches this). */
  onRemoveBlackout: (id: string) => void
  onSetSolveMode: (mode: SolveMode) => void
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
  /** Left-side slot in the schedule panel header — sits where a title used
   *  to. Used by App.tsx to render "Resume from Excel" + loaded-file info as
   *  the input half of the Resume → Assemble data flow. */
  inputSlot?: ReactNode
}

export function QuarterSchedule(props: QuarterScheduleProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [visibleDayGroup, setVisibleDayGroup] = useState<DayGroup>(1)
  // Ticks on each Assemble click so the gold chaser element re-mounts and
  // re-plays its 1s perimeter trace. Cleared by the chaser's onAnimationEnd.
  const [chaseKey, setChaseKey] = useState(0)
  // The cell that's showing the "block this slot" inline popover, or null.
  // Cell-key form (`${dg}|${ts}`) — only one popover open at a time.
  const [blackoutOpenKey, setBlackoutOpenKey] = useState<string | null>(null)

  const { ctaLabel } = useTheme()
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

  // Same shape as placedByCell, keyed identically. Cells render blackouts
  // alongside class cards under the same density-grid auto-layout.
  const blackoutsByCell = useMemo(() => {
    const m = new Map<string, RoomBlackout[]>()
    for (const b of props.roomBlackouts) {
      const key = `${b.slot.day_group}|${b.slot.time_slot}`
      const bucket = m.get(key) ?? []
      bucket.push(b)
      m.set(key, bucket)
    }
    return m
  }, [props.roomBlackouts])

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

    // One red dot for any chair touch. Tooltip enumerates which dimensions
    // are pinned (slot / professor / room). The inspector keeps per-field
    // ★ pinned badges; this is the card-level rollup.
    const pinParts: string[] = []
    if (o.pinned !== null) pinParts.push("slot")
    if (o.chair_pinned_prof) pinParts.push("professor")
    if (o.chair_pinned_room) pinParts.push("room")
    const hasAnyPin = pinParts.length > 0
    const pinPhrase =
      pinParts.length === 1
        ? pinParts[0]
        : pinParts.length === 2
          ? `${pinParts[0]} and ${pinParts[1]}`
          : `${pinParts[0]}, ${pinParts[1]}, and ${pinParts[2]}`
    const pinTitle = hasAnyPin ? `You pinned the ${pinPhrase}.` : ""

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
        {hasAnyPin && (
          <span
            className="schedule-card__pin-dot"
            aria-label={pinTitle}
            title={pinTitle}
          />
        )}
      </button>
    )
  }

  const renderBlackoutCard = (b: RoomBlackout) => {
    const room = props.rooms[b.room_id]
    const roomLabel = room
      ? room.name.split("–")[0].trim().replace("Room ", "")
      : b.room_id
    const fullLabel = room ? room.name : b.room_id
    const tooltip = b.note
      ? `${fullLabel} — ${b.note}`
      : `${fullLabel} (no note)`
    return (
      <div
        key={b.id}
        className="schedule-blackout"
        title={tooltip}
        role="note"
        aria-label={`Blackout: ${tooltip}`}
      >
        <span className="schedule-blackout__room">{roomLabel}</span>
        <span className="schedule-blackout__note">{b.note || "blocked"}</span>
        <button
          type="button"
          className="schedule-blackout__remove"
          aria-label={`Remove blackout for ${fullLabel}`}
          title="Remove this blackout"
          onClick={e => {
            e.stopPropagation()
            props.onRemoveBlackout(b.id)
          }}
        >
          ×
        </button>
      </div>
    )
  }

  const quarterValue = QUARTER_OPTIONS.includes(props.quarter) ? props.quarter : "Fall"

  return (
    <section className="panel panel--schedule" aria-label={`${quarterValue} Schedule`}>
      <header className="panel__header">
        {props.inputSlot}
        <div className="schedule__toolbar">
          {/* Mode selection moved to the SolveProgress mode cards — clicking
              an Affinity/Time Pref/Balanced card flips the calendar to that
              mode's cached results. The redundant chip row was removed. */}
          <div className="panel__actions">
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
            <button
              type="button"
              className={
                "btn-generate" +
                (isSolving ? " btn-generate--solving" : "") +
                (chaseKey > 0 ? " btn-generate--chasing" : "")
              }
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
                  className="btn-chaser"
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
              {isSolving ? ctaLabel.solving : ctaLabel.idle}
            </button>
            <ScheduleMenu
              onEmptyCalendar={props.onEmptyCalendar}
              clearArmed={props.clearArmed}
              disabled={isSolving}
            />
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
          className="schedule__laser"
          data-active={isSolving ? "true" : "false"}
          aria-hidden="true"
        />
        <div
          className={
            "schedule-grid" + (props.placingId ? " schedule-grid--placing" : "")
          }
          role="grid"
        >
          <div className="schedule-grid__corner">
            <span className="schedule-grid__quarter-wrap">
              <select
                className="schedule-grid__quarter-select"
                value={quarterValue}
                onChange={e => props.onSetQuarter(e.target.value)}
                aria-label="Quarter"
              >
                {QUARTER_OPTIONS.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
              <span className="schedule-grid__quarter-caret" aria-hidden="true">▾</span>
            </span>
          </div>
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
          {/* TIME_SLOTS rows below — each cell knows about blackouts via
              blackoutsByCell + the BlackoutPopover defined at file bottom. */}
          {TIME_SLOTS.map(ts => (
            <Fragment key={ts}>
              <div className="schedule-grid__time-header" role="rowheader">
                {TIME_LABELS[ts]}
              </div>
              {DAY_GROUPS.map(g => {
                const cellKey = `${g.key}|${ts}`
                const cards = placedByCell.get(cellKey) ?? []
                const blackouts = blackoutsByCell.get(cellKey) ?? []
                const slot: Slot = { day_group: g.key, time_slot: ts }
                const isDropTarget = dragOverKey === cellKey
                const canPinClick =
                  props.selectedOfferingId !== null &&
                  !cards.some(c => c.offering_id === props.selectedOfferingId)
                const isHidden = g.key !== visibleDayGroup // only hidden on portrait via CSS
                // Blackouts share the cell's density grid with class cards.
                const totalTiles = cards.length + blackouts.length
                const densityClass =
                  totalTiles >= 5
                    ? " schedule-grid__cell--grid schedule-grid__cell--dense"
                    : totalTiles >= 3
                      ? " schedule-grid__cell--grid"
                      : ""
                const popoverOpen = blackoutOpenKey === cellKey
                const blockedRoomIds = new Set(blackouts.map(b => b.room_id))
                return (
                  <div
                    key={`c-${g.key}-${ts}`}
                    className={
                      "schedule-grid__cell" +
                      densityClass +
                      (isDropTarget ? " schedule-grid__cell--over" : "") +
                      (isHidden ? " schedule-grid__cell--hidden" : "") +
                      (popoverOpen ? " schedule-grid__cell--popover-open" : "")
                    }
                    role="gridcell"
                    data-day-group={g.key}
                    data-time-slot={ts}
                    data-count={totalTiles}
                    onClick={() => {
                      // Don't claim clicks meant for the popover or for placement.
                      if (popoverOpen) return
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
                    {blackouts.map(renderBlackoutCard)}
                    <button
                      type="button"
                      className="schedule-grid__block-btn"
                      aria-label="Block this slot"
                      title="Block this slot for another department"
                      onClick={e => {
                        e.stopPropagation()
                        setBlackoutOpenKey(popoverOpen ? null : cellKey)
                      }}
                    >
                      <span aria-hidden="true">⊘</span>
                    </button>
                    {popoverOpen && (
                      <BlackoutPopover
                        rooms={props.rooms}
                        excludeRoomIds={blockedRoomIds}
                        onCancel={() => setBlackoutOpenKey(null)}
                        onSubmit={(room_id, note) => {
                          props.onAddBlackout(room_id, slot, note)
                          setBlackoutOpenKey(null)
                        }}
                      />
                    )}
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

// ─── Blackout popover ───────────────────────────────────────────────
//
// Tiny inline form anchored to a schedule cell. Two fields: room (dropdown,
// excluding rooms already blacked out in this slot) and note (free text,
// 140-char cap enforced upstream in App.tsx::addBlackout). Submit → bubble
// up via onSubmit; Esc / Cancel → onCancel. Click-outside closes via the
// overlay sibling rendered below the panel.

interface BlackoutPopoverProps {
  rooms: Record<string, Room>
  excludeRoomIds: Set<string>
  onSubmit: (room_id: string, note: string) => void
  onCancel: () => void
}

function BlackoutPopover(props: BlackoutPopoverProps) {
  const available = useMemo(() => {
    return Object.values(props.rooms)
      .filter(r => r.available !== false && !props.excludeRoomIds.has(r.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [props.rooms, props.excludeRoomIds])
  const [roomId, setRoomId] = useState<string>(available[0]?.id ?? "")
  const [note, setNote] = useState<string>("")
  const noteRef = useRef<HTMLInputElement | null>(null)

  // Auto-focus the note input on open — room defaults to first option, the
  // chair almost always wants to type the note first ("for X").
  useEffect(() => {
    noteRef.current?.focus()
  }, [])

  // Esc anywhere closes; Enter inside the form submits if a room is chosen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [props])

  const canSubmit = roomId !== ""

  return (
    <>
      <div
        className="schedule-blackout-popover__overlay"
        onClick={props.onCancel}
        aria-hidden="true"
      />
      <form
        className="schedule-blackout-popover"
        role="dialog"
        aria-label="Block this slot for another department"
        onClick={e => e.stopPropagation()}
        onSubmit={e => {
          e.preventDefault()
          if (canSubmit) props.onSubmit(roomId, note)
        }}
      >
        <label className="schedule-blackout-popover__field">
          <span className="schedule-blackout-popover__label">Room</span>
          <select
            className="schedule-blackout-popover__select"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
          >
            {available.length === 0 && (
              <option value="">No rooms available — all blocked here</option>
            )}
            {available.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="schedule-blackout-popover__field">
          <span className="schedule-blackout-popover__label">Reason</span>
          <input
            ref={noteRef}
            type="text"
            className="schedule-blackout-popover__input"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={140}
            placeholder="e.g. Virtual Film Club"
          />
        </label>
        <div className="schedule-blackout-popover__actions">
          <button
            type="button"
            className="schedule-blackout-popover__btn schedule-blackout-popover__btn--ghost"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="schedule-blackout-popover__btn schedule-blackout-popover__btn--primary"
            disabled={!canSubmit}
          >
            Block
          </button>
        </div>
      </form>
    </>
  )
}
