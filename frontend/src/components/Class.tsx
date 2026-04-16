import { useMemo } from "react"
import type {
  Course,
  Offering,
  Priority,
  Professor,
  Room,
} from "../types"
import { ProfAvatar } from "./ProfAvatar"

/**
 * The DETAIL panel — Class.
 *
 * ── BENDING THE RUBRIC (deliberate, documented) ──────────────────
 * AI 201 Project 2 says the Detail View should only READ. This panel
 * reads AND writes, because the scheduler's natural flow is:
 *
 *     Catalogue (pick)  →  Class (assign)  →  Quarter Schedule (place)
 *
 * The middle step is inherently authorial — assigning a professor, a room,
 * setting priority, editing notes. See docs/state-flow.md for the
 * architectural note ("Record of Resistance").
 * ──────────────────────────────────────────────────────────────────
 *
 * Reads  (props):  the currently selected offering + reference data
 * Writes (events): updateOffering, toggleLock, removeOffering
 */

const PRIORITY_OPTIONS: ReadonlyArray<{ key: Priority; label: string }> = [
  { key: "must_have", label: "Must" },
  { key: "should_have", label: "Should" },
  { key: "could_have", label: "Could" },
  { key: "nice_to_have", label: "Nice" },
]

type OfferingState =
  | "offering" // in offerings, prof+room AUTO, no slot
  | "kitted"   // prof and/or room assigned, no slot
  | "placed"   // pinned/assigned to a slot, unlocked
  | "locked"   // locked to a slot

function classifyOffering(o: Offering): OfferingState {
  if (o.locked) return "locked"
  if (o.pinned || o.assignment) return "placed"
  if (o.assigned_prof_id || o.assigned_room_id) return "kitted"
  return "offering"
}

export interface ClassProps {
  selectedOfferingId: string | null
  offerings: Offering[]
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  onUpdate: (catalog_id: string, changes: Partial<Offering>) => void
  onToggleLock: (catalog_id: string) => void
  onRemove: (catalog_id: string) => void
}

export function Class(props: ClassProps) {
  const offering = props.selectedOfferingId
    ? props.offerings.find(o => o.catalog_id === props.selectedOfferingId)
    : null
  const course = offering ? props.catalog[offering.catalog_id] : null

  const profCandidates = useMemo(() => {
    if (!course) return []
    const preferred = new Set(course.preferred_professors)
    const all = Object.values(props.professors).filter(p =>
      p.teaching_departments.includes(course.department),
    )
    return all.sort((a, b) => {
      const aPref = preferred.has(a.id) ? 0 : 1
      const bPref = preferred.has(b.id) ? 0 : 1
      if (aPref !== bPref) return aPref - bPref
      return a.name.localeCompare(b.name)
    })
  }, [course, props.professors])

  const roomCandidates = useMemo(() => {
    if (!course) return { matching: [], other: [] }
    const requiredType = offering?.override_room_type || course.required_room_type
    const all = Object.values(props.rooms)
    return {
      matching: all.filter(r => r.room_type === requiredType),
      other: all.filter(r => r.room_type !== requiredType),
    }
  }, [course, offering, props.rooms])

  if (!offering || !course) {
    return (
      <aside className="panel panel--class" aria-label="Class">
        <header className="panel__header">
          <h2 className="panel__title">Class</h2>
        </header>
        <div className="panel__body">
          <p className="placeholder placeholder--empty">
            No offering selected.
            <br />
            Pick a course from the Catalogue.
          </p>
        </div>
      </aside>
    )
  }

  const state = classifyOffering(offering)
  const preferred = new Set(course.preferred_professors)
  const assignedProf = offering.assigned_prof_id
    ? props.professors[offering.assigned_prof_id]
    : null

  return (
    <aside className="panel panel--class" aria-label="Class">
      <header className="panel__header">
        <h2 className="panel__title">Class</h2>
        <span className={"class__state class__state--" + state}>{state}</span>
      </header>

      <div className="panel__body class__body">
        <section className="class__hero">
          <div className="class__hero-row">
            <span className={"class__id dept dept--" + course.department}>
              {course.id}
            </span>
            <span className="class__credits">{course.credits} cr</span>
          </div>
          <h3 className="class__name">{course.name}</h3>
          <div className="class__prof-lockup">
            <ProfAvatar
              profId={offering.assigned_prof_id}
              name={assignedProf?.name}
              size={36}
              className="class__prof-avatar"
            />
            <div className="class__prof-text">
              <div className="class__prof-name">
                {assignedProf?.name ?? "AUTO professor"}
              </div>
              <div className="class__prof-sub">
                {assignedProf
                  ? (assignedProf.is_chair ? "Chair · " : "") +
                    assignedProf.home_department.toUpperCase()
                  : "Solver will pick"}
              </div>
            </div>
          </div>
          {course.description && (
            <p className="class__desc">{course.description}</p>
          )}
        </section>

        <section className="class__section">
          <label className="class__label">Priority</label>
          <div className="class__segmented">
            {PRIORITY_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={
                  "class__seg" +
                  (offering.priority === opt.key ? " class__seg--active" : "")
                }
                onClick={() =>
                  props.onUpdate(offering.catalog_id, { priority: opt.key })
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Sections</label>
          <div className="class__stepper">
            <button
              type="button"
              disabled={offering.sections <= 1}
              onClick={() =>
                props.onUpdate(offering.catalog_id, {
                  sections: Math.max(1, offering.sections - 1),
                })
              }
            >
              −
            </button>
            <span className="class__stepper-value">{offering.sections}</span>
            <button
              type="button"
              disabled={offering.sections >= 4}
              onClick={() =>
                props.onUpdate(offering.catalog_id, {
                  sections: Math.min(4, offering.sections + 1),
                })
              }
            >
              +
            </button>
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Professor</label>
          <select
            className="class__select"
            value={offering.assigned_prof_id ?? "AUTO"}
            onChange={e =>
              props.onUpdate(offering.catalog_id, {
                assigned_prof_id: e.target.value === "AUTO" ? null : e.target.value,
              })
            }
          >
            <option value="AUTO">AUTO — let the solver choose</option>
            {profCandidates.map(p => (
              <option key={p.id} value={p.id}>
                {preferred.has(p.id) ? "★ " : ""}
                {p.name}
                {p.is_chair ? " (chair)" : ""}
              </option>
            ))}
          </select>
          {preferred.size > 0 && (
            <p className="class__hint">★ = catalog-preferred for this course</p>
          )}
        </section>

        <section className="class__section">
          <label className="class__label">Room</label>
          <select
            className="class__select"
            value={offering.assigned_room_id ?? "AUTO"}
            onChange={e =>
              props.onUpdate(offering.catalog_id, {
                assigned_room_id: e.target.value === "AUTO" ? null : e.target.value,
              })
            }
          >
            <option value="AUTO">AUTO — let the solver choose</option>
            {roomCandidates.matching.length > 0 && (
              <optgroup label={`Matching (${course.required_room_type})`}>
                {roomCandidates.matching.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
            {roomCandidates.other.length > 0 && (
              <optgroup label="Other rooms">
                {roomCandidates.other.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="class__hint">
            Required: <code>{course.required_room_type}</code> · cap{" "}
            {offering.override_enrollment_cap ?? course.enrollment_cap}
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Notes</label>
          <textarea
            className="class__textarea"
            rows={2}
            value={offering.notes ?? ""}
            placeholder="Scheduling notes, prof preferences, etc."
            onChange={e =>
              props.onUpdate(offering.catalog_id, {
                notes: e.target.value || null,
              })
            }
          />
        </section>

        <section className="class__footer">
          <button
            type="button"
            className="class__lock"
            disabled={!offering.pinned && !offering.assignment}
            onClick={() => props.onToggleLock(offering.catalog_id)}
          >
            {offering.locked ? "🔒 Unlock slot" : "🔓 Lock slot"}
          </button>
          <button
            type="button"
            className="class__remove"
            onClick={() => props.onRemove(offering.catalog_id)}
          >
            Remove from quarter
          </button>
        </section>
      </div>
    </aside>
  )
}
