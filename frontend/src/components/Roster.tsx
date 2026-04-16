import { useMemo } from "react"
import type { Course, Offering, Professor } from "../types"
import { classifyOffering } from "../types"
import { ProfAvatar } from "./ProfAvatar"

/**
 * The ROSTER panel — unplaced offerings.
 *
 * Shows offerings that aren't yet placed on the schedule grid. Once an
 * offering is pinned or locked to a time slot, it disappears from here
 * and lives on the grid. Empty roster = everything scheduled.
 *
 * Reads  (props):  offerings, catalog, professors, selectedOfferingId
 * Writes (events): onSelect, onRemove, onOpenCatalogue
 */

const DND_MIME = "application/x-offering"

const PRIORITY_ORDER: Record<string, number> = {
  must_have: 0,
  should_have: 1,
  could_have: 2,
  nice_to_have: 3,
}

export interface RosterProps {
  offerings: Offering[]
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  selectedOfferingId: string | null
  placingId: string | null
  onSelect: (id: string | null) => void
  onSelectProfessor: (id: string | null) => void
  onRemove: (catalog_id: string) => void
  onOpenCatalogue: () => void
  onStartPlacing: (id: string) => void
}

/** An offering is "placed" if it has a slot on the grid. */
function isPlaced(o: Offering): boolean {
  return !!(o.pinned || o.locked || o.assignment)
}

export function Roster(props: RosterProps) {
  const sorted = useMemo(() => {
    return props.offerings
      .filter(o => !isPlaced(o))
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 9
        const pb = PRIORITY_ORDER[b.priority] ?? 9
        if (pa !== pb) return pa - pb
        return a.catalog_id.localeCompare(b.catalog_id)
      })
  }, [props.offerings])

  return (
    <aside className="panel panel--roster" aria-label="Roster">
      <header className="panel__header">
        <h2 className="panel__title">Roster</h2>
        <span className="panel__count">{sorted.length} / {props.offerings.length}</span>
        <button
          type="button"
          className="roster__add-btn"
          onClick={props.onOpenCatalogue}
          title="Add courses from catalogue"
        >
          + Add
        </button>
      </header>

      <div className="panel__body roster__list">
        {sorted.length === 0 && (
          <p className="placeholder placeholder--empty">
            {props.offerings.length === 0
              ? <>No offerings yet.<br />Click <strong>+ Add</strong> to pick courses.</>
              : "All placed — nice work."}
          </p>
        )}
        {sorted.map(offering => {
          const course = props.catalog[offering.catalog_id]
          if (!course) return null

          const state = classifyOffering(offering)
          const prof = offering.assigned_prof_id
            ? props.professors[offering.assigned_prof_id]
            : null
          const isSelected = props.selectedOfferingId === offering.catalog_id
          const isLocked = state === "locked"
          const isPlacing = props.placingId === offering.catalog_id

          return (
            <div
              key={offering.catalog_id}
              role="button"
              tabIndex={0}
              draggable={!isLocked}
              className={
                "roster-card" +
                ` dept--${course.department}` +
                (isSelected ? " roster-card--selected" : "") +
                (isLocked ? " roster-card--locked" : "") +
                (isPlacing ? " roster-card--placing" : "")
              }
              onClick={() => {
                props.onSelect(offering.catalog_id)
                if (!isLocked) props.onStartPlacing(offering.catalog_id)
              }}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  props.onSelect(offering.catalog_id)
                }
              }}
              onDragStart={e => {
                if (isLocked) {
                  e.preventDefault()
                  return
                }
                e.dataTransfer.setData(DND_MIME, offering.catalog_id)
                e.dataTransfer.setData("text/plain", offering.catalog_id)
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
                className="roster-card__remove"
                role="button"
                aria-label={`Remove ${course.id} from offerings`}
                onClick={e => {
                  e.stopPropagation()
                  props.onRemove(offering.catalog_id)
                }}
              >
                ×
              </span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
