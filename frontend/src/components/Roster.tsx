import { useMemo, useState } from "react"
import type { Course, Offering, Professor, Room, RosterCapacity } from "../types"
import {
  capacityChipTitle,
  capacityState,
  classifyOffering,
  PRIORITY_INDEX,
  profContractCeiling,
  profContractFloor,
  profLoadedCount,
  STATION_TYPE_LABELS,
} from "../types"
import { ProfAvatar } from "./ProfAvatar"

/**
 * The ROSTER panel — browsable index of everything the scheduler touches.
 *
 * Three tabs:
 *   - Offerings: unplaced courses (drag to grid)
 *   - Profs:     all professors (click to edit availability in detail panel)
 *   - Rooms:     all rooms      (click to edit availability in detail panel)
 *
 * Tab is local UI state. Selection lives in App.tsx (single source of truth).
 * Only the Offerings tab participates in drag-and-drop.
 */

/** DnD MIME for dragging an existing offering (payload: offering_id). The
 *  roster is the source + target for existing offerings only; catalogue→schedule
 *  drops use a separate `application/x-course` MIME handled by QuarterSchedule. */
const DND_MIME_OFFERING = "application/x-offering"

type RosterTab = "offerings" | "profs" | "rooms"

export interface RosterProps {
  offerings: Offering[]
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  /** Department-wide contract capacity for the Profs-tab nag & per-card
   *  meters. Computed in App.tsx so the topbar chip and the roster share
   *  one source of truth. */
  capacity: RosterCapacity
  selectedOfferingId: string | null
  selectedProfId: string | null
  selectedRoomId: string | null
  placingId: string | null
  onSelect: (id: string | null) => void
  onSelectProfessor: (id: string | null) => void
  onSelectRoom: (id: string | null) => void
  onRemove: (offering_id: string) => void
  /** Add another sibling (section) for this catalog_id. Siblings share
   *  catalog-level settings but pin independently. */
  onAddSectionOffering: (catalog_id: string) => void
  onOpenCatalogue: () => void
  onStartPlacing: (offering_id: string) => void
  /** Called when a schedule card is dropped onto the offerings list —
   *  unpins it back to the unplaced roster. */
  onUnpinToRoster: (offering_id: string) => void
  /** Create a fresh professor with sensible defaults and open for editing. */
  onAddProfessor: () => void
  /** Clear the entire professors list — dept starts from zero. Confirmed in UI. */
  onClearProfessors: () => void
  /** Create a fresh room with sensible defaults and open it for editing. */
  onAddRoom: () => void
  /** Clear the entire rooms list — dept starts from zero. Confirmed in UI. */
  onClearRooms: () => void
}

export function Roster(props: RosterProps) {
  const [tab, setTab] = useState<RosterTab>("offerings")

  const unplaced = useMemo(() => {
    return props.offerings
      .filter(o => classifyOffering(o) !== "placed")
      .sort((a, b) => {
        const pa = PRIORITY_INDEX[a.priority] ?? 9
        const pb = PRIORITY_INDEX[b.priority] ?? 9
        if (pa !== pb) return pa - pb
        // Stable tiebreaker: catalog_id groups siblings, then offering_id
        // disambiguates within a group so order stays deterministic.
        const byCid = a.catalog_id.localeCompare(b.catalog_id)
        if (byCid !== 0) return byCid
        return a.offering_id.localeCompare(b.offering_id)
      })
  }, [props.offerings])

  const profList = useMemo(() => {
    return Object.values(props.professors).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [props.professors])

  const roomList = useMemo(() => {
    return Object.values(props.rooms).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [props.rooms])

  const count =
    tab === "offerings"
      ? `${unplaced.length} / ${props.offerings.length}`
      : tab === "profs"
        ? `${profList.length}`
        : `${roomList.length}`

  const handleClearRooms = () => {
    const n = roomList.length
    if (n === 0) return
    if (!window.confirm(
      `Clear all ${n} room${n === 1 ? "" : "s"}?\n\n` +
      `Your dept's list will start empty. Add rooms one at a time to build ` +
      `your deck. This only affects your browser until you Commit to disk.`
    )) return
    props.onClearRooms()
  }

  const handleClearProfs = () => {
    const n = profList.length
    if (n === 0) return
    if (!window.confirm(
      `Clear all ${n} professor${n === 1 ? "" : "s"}?\n\n` +
      `Your dept's faculty list will start empty. Add professors one at a ` +
      `time to build your roster. This only affects your browser until you ` +
      `Commit to disk.`
    )) return
    props.onClearProfessors()
  }

  return (
    <aside className="panel panel--roster" aria-label="Roster">
      <header className="panel__header">
        <h2 className="panel__title">Roster</h2>
        <span className="panel__count">{count}</span>
        {tab === "offerings" && (
          <button
            type="button"
            className="roster__add-btn"
            onClick={props.onOpenCatalogue}
            title="Add courses from catalogue"
          >
            + Add
          </button>
        )}
        {tab === "profs" && (
          <>
            <button
              type="button"
              className="roster__add-btn"
              onClick={props.onAddProfessor}
              title="Add a new professor to your dept's roster"
            >
              + Add
            </button>
            <button
              type="button"
              className="roster__clear-all-btn"
              onClick={handleClearProfs}
              disabled={profList.length === 0}
              title="Remove every professor and start from scratch"
            >
              Clear All
            </button>
          </>
        )}
        {tab === "rooms" && (
          <>
            <button
              type="button"
              className="roster__add-btn"
              onClick={props.onAddRoom}
              title="Add a new room to your dept's list"
            >
              + Add
            </button>
            <button
              type="button"
              className="roster__clear-all-btn"
              onClick={handleClearRooms}
              disabled={roomList.length === 0}
              title="Remove every room and start from scratch"
            >
              Clear All
            </button>
          </>
        )}
      </header>

      <div className="roster__tabs" role="tablist" aria-label="Roster view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "offerings"}
          className={
            "roster__tab" + (tab === "offerings" ? " roster__tab--active" : "")
          }
          onClick={() => setTab("offerings")}
        >
          Offerings
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "profs"}
          className={
            "roster__tab" + (tab === "profs" ? " roster__tab--active" : "")
          }
          onClick={() => setTab("profs")}
        >
          Profs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rooms"}
          className={
            "roster__tab" + (tab === "rooms" ? " roster__tab--active" : "")
          }
          onClick={() => setTab("rooms")}
        >
          Rooms
        </button>
      </div>

      {tab === "offerings" && (
        <OfferingsList
          unplaced={unplaced}
          totalCount={props.offerings.length}
          capacity={props.capacity}
          catalog={props.catalog}
          professors={props.professors}
          selectedOfferingId={props.selectedOfferingId}
          placingId={props.placingId}
          onSelect={props.onSelect}
          onSelectProfessor={props.onSelectProfessor}
          onRemove={props.onRemove}
          onAddSectionOffering={props.onAddSectionOffering}
          onStartPlacing={props.onStartPlacing}
          onUnpinToRoster={props.onUnpinToRoster}
        />
      )}

      {tab === "profs" && (
        <ProfsList
          profs={profList}
          offerings={props.offerings}
          capacity={props.capacity}
          selectedProfId={props.selectedProfId}
          onSelect={props.onSelectProfessor}
        />
      )}

      {tab === "rooms" && (
        <RoomsList
          rooms={roomList}
          selectedRoomId={props.selectedRoomId}
          onSelect={props.onSelectRoom}
        />
      )}
    </aside>
  )
}

// ─── Offerings tab (previous behavior, unchanged) ──────────────────

interface OfferingsListProps {
  unplaced: Offering[]
  totalCount: number
  /** Department capacity so the sub-header chip sits in the placement flow,
   *  not in the easily-ignored topbar. */
  capacity: RosterCapacity
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  selectedOfferingId: string | null
  placingId: string | null
  onSelect: (id: string | null) => void
  onSelectProfessor: (id: string | null) => void
  onRemove: (offering_id: string) => void
  onAddSectionOffering: (catalog_id: string) => void
  onStartPlacing: (offering_id: string) => void
  onUnpinToRoster: (offering_id: string) => void
}

function OfferingsList(props: OfferingsListProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    // Accept an existing offering (unpin flow). A catalogue row dragged here
    // would need to be an "add" — currently a no-op, so we don't highlight.
    if (!e.dataTransfer.types.includes(DND_MIME_OFFERING) &&
        !e.dataTransfer.types.includes("text/plain")) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (!isDragOver) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the list, not when crossing between children.
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const offeringId =
      e.dataTransfer.getData(DND_MIME_OFFERING) ||
      e.dataTransfer.getData("text/plain")
    if (offeringId) props.onUnpinToRoster(offeringId)
  }

  const capState = capacityState(props.capacity)
  const overloadSlots = props.capacity.ceilingTotal - props.capacity.floorTotal

  return (
    <>
      <div
        className={`roster__capacity roster__capacity--${capState}`}
        title={capacityChipTitle(props.capacity, capState)}
        aria-label={capacityChipTitle(props.capacity, capState)}
      >
        <span className="roster__capacity-count">
          {props.capacity.loaded}
          <span className="roster__capacity-sep">/</span>
          {props.capacity.floorTotal}
        </span>
        {overloadSlots > 0 && (
          <span className="roster__capacity-overload">
            +{overloadSlots} OL
          </span>
        )}
        <span className="roster__capacity-hint">
          {capState === "under" && "keep loading"}
          {capState === "contract" && "contract met"}
          {capState === "overload" && "in overload"}
          {capState === "maxed" && "clip full"}
        </span>
      </div>
      <div
        className={
          "panel__body roster__list" +
          (isDragOver ? " roster__list--drag-over" : "")
        }
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {props.unplaced.length === 0 && (
          <p className="placeholder placeholder--empty">
            {props.totalCount === 0
              ? <>No offerings yet.<br />Click <strong>+ Add</strong> to pick courses.</>
              : isDragOver
                ? "Drop here to unpin"
                : "All placed — nice work."}
          </p>
        )}
      {props.unplaced.map(offering => {
        const course = props.catalog[offering.catalog_id]
        if (!course) return null

        const state = classifyOffering(offering)
        const prof = offering.assigned_prof_id
          ? props.professors[offering.assigned_prof_id]
          : null
        const isSelected = props.selectedOfferingId === offering.offering_id
        const isPlacing = props.placingId === offering.offering_id

        return (
          <div
            key={offering.offering_id}
            role="button"
            tabIndex={0}
            draggable
            className={
              "roster-card" +
              ` dept--${course.department}` +
              (isSelected ? " roster-card--selected" : "") +
              (isPlacing ? " roster-card--placing" : "")
            }
            onClick={() => {
              props.onSelect(offering.offering_id)
              props.onStartPlacing(offering.offering_id)
            }}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                props.onSelect(offering.offering_id)
              }
            }}
            onDragStart={e => {
              e.dataTransfer.setData(DND_MIME_OFFERING, offering.offering_id)
              e.dataTransfer.setData("text/plain", offering.offering_id)
              e.dataTransfer.effectAllowed = "move"
            }}
          >
            <span
              className="roster-card__avatar-hit"
              role="button"
              tabIndex={-1}
              onClick={e => {
                e.stopPropagation()
                if (offering.assigned_prof_id) {
                  props.onSelectProfessor(offering.assigned_prof_id)
                }
              }}
            >
              <ProfAvatar
                profId={offering.assigned_prof_id}
                name={prof?.name}
                size={32}
                className="roster-card__avatar"
              />
            </span>
            <span className="roster-card__course">
              <span className="roster-card__id">{course.id}</span>
              {" "}
              <span className="roster-card__name">{course.name}</span>
            </span>
            <span className="roster-card__prof">
              {prof ? prof.name.split(" ").pop() : "AUTO"}
            </span>
            <span
              className={`roster-card__status roster-card__status--${state}`}
              title={state}
            />
            <span
              className="roster-card__add-section"
              role="button"
              aria-label={`Add another section of ${course.id}`}
              title={`Add another section of ${course.id}`}
              onClick={e => {
                e.stopPropagation()
                props.onAddSectionOffering(offering.catalog_id)
              }}
            >
              +
            </span>
            <span
              className="roster-card__remove"
              role="button"
              aria-label={`Remove ${course.id} from offerings`}
              onClick={e => {
                e.stopPropagation()
                props.onRemove(offering.offering_id)
              }}
            >
              ×
            </span>
          </div>
        )
      })}
      </div>
    </>
  )
}

// ─── Profs tab ─────────────────────────────────────────────────────

interface ProfsListProps {
  profs: Professor[]
  offerings: Offering[]
  capacity: RosterCapacity
  selectedProfId: string | null
  onSelect: (id: string | null) => void
}

function ProfsList(props: ProfsListProps) {
  const state = capacityState(props.capacity)
  const nag = capacityNag(props.capacity, state)

  return (
    <div className="panel__body roster__list">
      {props.profs.length === 0 && (
        <p className="placeholder placeholder--empty">
          No professors yet.<br />Click <strong>+ Add</strong> to build your roster.
        </p>
      )}
      {props.profs.length > 0 && (
        <p className={`roster__nag roster__nag--${state}`}>{nag}</p>
      )}
      {props.profs.map(p => {
        const isSelected = props.selectedProfId === p.id
        const floor = profContractFloor(p)
        const ceiling = profContractCeiling(p)
        const loaded = profLoadedCount(p.id, props.offerings)
        const loadState =
          loaded >= ceiling ? "maxed"
          : loaded > floor ? "overload"
          : loaded === floor ? "contract"
          : "under"
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            className={
              "roster-card roster-card--person" +
              (isSelected ? " roster-card--selected" : "")
            }
            onClick={() => props.onSelect(p.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                props.onSelect(p.id)
              }
            }}
          >
            <span className="roster-card__avatar-hit">
              <ProfAvatar
                profId={p.id}
                name={p.name}
                size={32}
                className="roster-card__avatar"
              />
            </span>
            <span className="roster-card__course">
              <span className="roster-card__name roster-card__name--primary">
                {p.name}
              </span>
            </span>
            <ProfMeter
              loaded={loaded}
              floor={floor}
              ceiling={ceiling}
              state={loadState}
            />
            <span
              className="roster-card__quarters"
              title={`Available: ${p.available_quarters.join(", ") || "none"}`}
            >
              {p.available_quarters
                .slice()
                .sort()
                .map(q => q.charAt(0).toUpperCase())
                .join("")}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Contract meter + floor/ceiling badge for a single prof card. */
function ProfMeter(props: {
  loaded: number
  floor: number
  ceiling: number
  state: "under" | "contract" | "overload" | "maxed"
}) {
  const { loaded, floor, ceiling, state } = props
  const title =
    state === "under"
      ? `${floor - loaded} to contract · ceiling ${ceiling}`
      : state === "contract"
        ? `Contract met · ${ceiling - floor} overload available`
        : state === "overload"
          ? `Overload in use · ${ceiling - loaded} slot left`
          : "Maxed out"
  const dots: Array<"filled" | "overload" | "empty"> = []
  for (let i = 0; i < ceiling; i++) {
    if (i < loaded) dots.push(i < floor ? "filled" : "overload")
    else dots.push("empty")
  }
  return (
    <span className={`prof-meter prof-meter--${state}`} title={title}>
      <span className="prof-meter__dots" aria-hidden="true">
        {dots.map((d, i) => (
          <span key={i} className={`prof-meter__dot prof-meter__dot--${d}`} />
        ))}
      </span>
      <span className="prof-meter__ratio">
        {loaded}/{floor}
        {ceiling > floor && (
          <span className="prof-meter__ceiling">·{ceiling}</span>
        )}
      </span>
    </span>
  )
}

/** Three-state nag copy for the Profs-tab header — matches the "All placed
 *  — nice work" cadence on the Offerings tab. */
function capacityNag(
  cap: RosterCapacity,
  state: "under" | "contract" | "overload" | "maxed",
): string {
  const gap = cap.floorTotal - cap.loaded
  const overloadSlots = cap.ceilingTotal - cap.floorTotal
  const overloadLeft = cap.ceilingTotal - cap.loaded
  switch (state) {
    case "under":
      return `${gap} slot${gap === 1 ? "" : "s"} under contract — keep loading.`
    case "contract":
      return `Contract met. ${overloadSlots} overload slot${overloadSlots === 1 ? "" : "s"} open for MUSTs.`
    case "overload":
      return `Overload in use — ${overloadLeft} slot${overloadLeft === 1 ? "" : "s"} left.`
    case "maxed":
      return "Clip's full — nice work."
  }
}

// ─── Rooms tab ─────────────────────────────────────────────────────

interface RoomsListProps {
  rooms: Room[]
  selectedRoomId: string | null
  onSelect: (id: string | null) => void
}

function RoomsList(props: RoomsListProps) {
  return (
    <div className="panel__body roster__list">
      {props.rooms.length === 0 && (
        <p className="placeholder placeholder--empty">
          No rooms yet.<br />Click <strong>+ Add</strong> to build your deck.
        </p>
      )}
      {props.rooms.map(r => {
        const isSelected = props.selectedRoomId === r.id
        const isOffline = r.available === false
        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            className={
              "roster-card roster-card--room" +
              (isSelected ? " roster-card--selected" : "") +
              (isOffline ? " roster-card--offline" : "")
            }
            onClick={() => props.onSelect(r.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                props.onSelect(r.id)
              }
            }}
          >
            <span className="roster-card__icon" aria-hidden="true">▦</span>
            <span className="roster-card__course">
              <span className="roster-card__name roster-card__name--primary">
                {r.name || "(untitled room)"}
              </span>
              <span className="roster-card__sub">
                {r.building && <>{r.building}{" · "}</>}
                {r.station_count}×
                {(STATION_TYPE_LABELS[r.station_type] ?? r.station_type).toUpperCase()}
                {" · cap "}{r.capacity}
              </span>
            </span>
            <span
              className={
                "roster-card__dot" +
                (isOffline
                  ? " roster-card__dot--offline"
                  : " roster-card__dot--available")
              }
              title={isOffline ? "Offline for this quarter" : "Available"}
            />
          </div>
        )
      })}
    </div>
  )
}
