import { useId, useMemo, useState } from "react"
import type {
  Course,
  Offering,
  Professor,
  Room,
} from "../types"
import {
  normalizeEquipmentTag,
  prettyEquipmentTag,
  PRIORITIES,
} from "../types"

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
  /** In-doc equipment tag vocabulary — union of tags already used on any
   *  room + any course. Powers chip autocomplete here and on RoomCard. */
  knownEquipmentTags: ReadonlyArray<string>
  onUpdate: (offering_id: string, changes: Partial<Offering>) => void
  /** Edit the catalog entry. Used by the equipment chip editors; course tags
   *  are authored at catalog level (not per-offering) so one edit reaches
   *  every section the chair schedules this quarter and next. */
  onUpdateCourse: (course_id: string, changes: Partial<Course>) => void
  onRemove: (offering_id: string) => void
  onSelectProfessor: (id: string | null) => void
}

export function Class(props: ClassProps) {
  const offering = props.selectedOfferingId
    ? props.offerings.find(o => o.offering_id === props.selectedOfferingId)
    : null
  const course = offering ? props.catalog[offering.catalog_id] : null

  const [reqDraft, setReqDraft] = useState("")
  const [prefDraft, setPrefDraft] = useState("")
  const reqListId = useId()
  const prefListId = useId()

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
    const required = course.required_equipment ?? []
    const all = Object.values(props.rooms)
    if (required.length === 0) return { matching: all, other: [] }
    const matches = (r: Room) => {
      const have = new Set(r.equipment_tags ?? [])
      return required.every(t => have.has(t))
    }
    return {
      matching: all.filter(matches),
      other: all.filter(r => !matches(r)),
    }
  }, [course, props.rooms])

  if (!offering || !course) {
    return (
      <aside className="panel panel--class" aria-label="Class">
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

  return (
    <aside className="panel panel--class" aria-label="Class">
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
              <optgroup
                label={
                  (course.required_equipment?.length ?? 0) > 0
                    ? `Matching (${(course.required_equipment ?? []).map(prettyEquipmentTag).join(", ")})`
                    : "All rooms"
                }
              >
                {roomCandidates.matching.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
            {roomCandidates.other.length > 0 && (
              <optgroup label="Other rooms (missing required equipment)">
                {roomCandidates.other.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </section>

        <EquipmentChips
          label="Required equipment"
          hint="Rooms MUST have all of these tags to host this course. Edits apply to every offering of this course."
          placeholder="e.g. pen_display"
          tags={course.required_equipment ?? []}
          draft={reqDraft}
          setDraft={setReqDraft}
          listId={reqListId}
          knownTags={props.knownEquipmentTags}
          onCommit={() => {
            const normalized = normalizeEquipmentTag(reqDraft)
            setReqDraft("")
            const current = course.required_equipment ?? []
            if (!normalized || current.includes(normalized)) return
            props.onUpdateCourse(course.id, {
              required_equipment: [...current, normalized],
            })
          }}
          onRemove={tag => {
            const current = course.required_equipment ?? []
            props.onUpdateCourse(course.id, {
              required_equipment: current.filter(t => t !== tag),
            })
          }}
        />

        <EquipmentChips
          label="Preferred equipment"
          hint="Soft bonus when the assigned room has these tags. Missing tags don't block scheduling, just cost a little."
          placeholder="e.g. large_display, vr"
          tags={course.preferred_equipment ?? []}
          draft={prefDraft}
          setDraft={setPrefDraft}
          listId={prefListId}
          knownTags={props.knownEquipmentTags}
          onCommit={() => {
            const normalized = normalizeEquipmentTag(prefDraft)
            setPrefDraft("")
            const current = course.preferred_equipment ?? []
            if (!normalized || current.includes(normalized)) return
            props.onUpdateCourse(course.id, {
              preferred_equipment: [...current, normalized],
            })
          }}
          onRemove={tag => {
            const current = course.preferred_equipment ?? []
            props.onUpdateCourse(course.id, {
              preferred_equipment: current.filter(t => t !== tag),
            })
          }}
        />

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
            {(course.required_equipment?.length ?? 0) > 0
              ? `Needs: ${(course.required_equipment ?? []).map(prettyEquipmentTag).join(", ")}`
              : "Any room"}
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

// Shared chip editor for the Required/Preferred equipment rows. Kept inline
// because it's specific to this panel's prose/hint structure — if a third
// tag surface appears, hoist it to its own file.
interface EquipmentChipsProps {
  label: string
  hint: string
  placeholder: string
  tags: ReadonlyArray<string>
  draft: string
  setDraft: (v: string) => void
  listId: string
  knownTags: ReadonlyArray<string>
  onCommit: () => void
  onRemove: (tag: string) => void
}

function EquipmentChips(p: EquipmentChipsProps) {
  return (
    <details className="class__section prof-card__specs" open={p.tags.length > 0}>
      <summary className="prof-card__specs-summary">
        <span>{p.label}</span>
        {p.tags.length > 0 && (
          <span className="prof-card__specs-count">{p.tags.length}</span>
        )}
      </summary>
      <div className="prof-card__tags">
        {p.tags.map(tag => (
          <span key={tag} className="prof-card__spec">
            {prettyEquipmentTag(tag)}
            <button
              type="button"
              className="prof-card__spec-remove"
              aria-label={`Remove ${tag}`}
              onClick={() => p.onRemove(tag)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="prof-card__spec-input"
          list={p.listId}
          placeholder={p.tags.length ? "Add…" : p.placeholder}
          value={p.draft}
          onChange={e => p.setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault()
              p.onCommit()
            }
          }}
          onBlur={p.onCommit}
        />
        <datalist id={p.listId}>
          {p.knownTags.map(t => (
            <option key={t} value={prettyEquipmentTag(t)} />
          ))}
        </datalist>
      </div>
      <p className="class__hint">{p.hint}</p>
    </details>
  )
}
