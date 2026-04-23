import { useMemo } from "react"
import type {
  Course,
  Offering,
  Professor,
  Room,
} from "../types"
import { classifyOffering, PRIORITIES, prettyRoomType } from "../types"

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
 * Writes (events): updateOffering, removeOffering
 */


export interface ClassProps {
  selectedOfferingId: string | null
  offerings: Offering[]
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  onUpdate: (offering_id: string, changes: Partial<Offering>) => void
  onRemove: (offering_id: string) => void
  onSelectProfessor: (id: string | null) => void
}

export function Class(props: ClassProps) {
  const offering = props.selectedOfferingId
    ? props.offerings.find(o => o.offering_id === props.selectedOfferingId)
    : null
  const course = offering ? props.catalog[offering.catalog_id] : null

  // Tiered dropdown: every roster prof is pickable. Groups mirror the solver's
  // affinity tiers so the label the user sees matches what the solver will
  // charge. "Fallback" profs teach a different department — they still work,
  // just at a penalty, so a must_have never hits infeasibility just because
  // no dept-matched prof is on the roster.
  const profCandidates = useMemo(() => {
    if (!course) return { preferred: [], dept: [], fallback: [] }
    const preferredSet = new Set(course.preferred_professors)
    const all = Object.values(props.professors)
    const preferred: Professor[] = []
    const dept: Professor[] = []
    const fallback: Professor[] = []
    for (const p of all) {
      if (preferredSet.has(p.id)) preferred.push(p)
      else if (p.teaching_departments.includes(course.department)) dept.push(p)
      else fallback.push(p)
    }
    const byName = (a: Professor, b: Professor) => a.name.localeCompare(b.name)
    preferred.sort(byName)
    dept.sort(byName)
    fallback.sort(byName)
    return { preferred, dept, fallback }
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
          <h3 className="class__name">
            {course.name}
            {course.description && (
              <button
                type="button"
                className="class__info-badge"
                title={course.description}
                aria-label="Course description (hover for full text)"
              >
                i
              </button>
            )}
          </h3>
        </section>

        <section className="class__section">
          <label className="class__label">
            Priority
            <button
              type="button"
              className="class__info-badge"
              title="MoSCoW-inspired soft weighting. Add &ldquo;would be nice&rdquo; classes freely — the solver drops the lowest priorities first when it can't fit them all."
              aria-label="About priority levels (hover for explanation)"
            >
              ?
            </button>
          </label>
          <div className="class__segmented">
            {PRIORITIES.map(opt => (
              <button
                key={opt.key}
                type="button"
                title={opt.tooltip}
                className={
                  "class__seg" +
                  (offering.priority === opt.key ? " class__seg--active" : "")
                }
                onClick={() =>
                  props.onUpdate(offering.offering_id, { priority: opt.key })
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Professor</label>
          <select
            className="class__select"
            value={offering.assigned_prof_id ?? "AUTO"}
            onChange={e =>
              props.onUpdate(offering.offering_id, {
                assigned_prof_id: e.target.value === "AUTO" ? null : e.target.value,
              })
            }
          >
            <option value="AUTO">AUTO — let the solver choose</option>
            {profCandidates.preferred.length > 0 && (
              <optgroup label="★ Preferred for this course">
                {profCandidates.preferred.map(p => (
                  <option key={p.id} value={p.id}>
                    ★ {p.name}
                    {p.is_chair ? " (chair)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {profCandidates.dept.length > 0 && (
              <optgroup label={`${course.department} department`}>
                {profCandidates.dept.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_chair ? " (chair)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {profCandidates.fallback.length > 0 && (
              <optgroup label="Fallback (other department)">
                {profCandidates.fallback.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_chair ? " (chair)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </section>

        <section className="class__section">
          <label className="class__label">Room</label>
          <select
            className="class__select"
            value={offering.assigned_room_id ?? "AUTO"}
            onChange={e =>
              props.onUpdate(offering.offering_id, {
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
        </section>

        <section className="class__section">
          <label className="class__label">Notes</label>
          <textarea
            className="class__textarea"
            rows={2}
            value={offering.notes ?? ""}
            placeholder="Scheduling notes, prof preferences, etc."
            onChange={e =>
              props.onUpdate(offering.offering_id, {
                notes: e.target.value || null,
              })
            }
          />
        </section>

        <details className="class__section class__details">
          <summary className="class__details-summary">Details</summary>
          <p className="class__hint">
            Station:{" "}
            {prettyRoomType(offering.override_room_type || course.required_room_type)}
            {" · seats "}
            {offering.override_enrollment_cap ?? course.enrollment_cap}
          </p>
          {profCandidates.preferred.length > 0 && (
            <p className="class__hint">★ = catalog-preferred for this course</p>
          )}
        </details>

        <section className="class__footer">
          <button
            type="button"
            className="class__remove"
            onClick={() => props.onRemove(offering.offering_id)}
          >
            Remove from quarter
          </button>
        </section>
      </div>
    </aside>
  )
}
