import { useId, useState } from "react"
import type { Campus, Room } from "../types"
import {
  CAMPUSES,
  normalizeEquipmentTag,
  prettyEquipmentTag,
} from "../types"

/**
 * The ROOM card — the room editor. Rendered in the detail panel when a
 * room row is clicked in the Roster's Rooms tab.
 *
 * Fully editable: name, building, station_count, display_count, capacity,
 * equipment_tags, availability, notes. The id stays read-only — it's the
 * foreign key other code joins on. Name used to be identity but now that
 * users add rooms from scratch, renaming has to work.
 *
 * Edits flow through `onUpdate` → App's `updateRoom` → full-list localStorage
 * override, then ride the Backup / Restore / Commit pipeline.
 *
 * Delete removes the room from state + localStorage + (on Commit) disk.
 * Mirrors ProfessorCard patterns for section chrome and back button.
 */

export interface RoomCardProps {
  room: Room
  /** Tag vocabulary collected from the current document (rooms + catalog).
   *  Powers the in-doc autocomplete on the equipment chip input. */
  knownEquipmentTags: ReadonlyArray<string>
  /** Buildings already in use, grouped by campus. Powers the Building
   *  datalist — typing narrows to buildings on the selected campus. */
  knownBuildingsByCampus: Readonly<Record<Campus, ReadonlyArray<string>>>
  onUpdate: (room_id: string, changes: Partial<Room>) => void
  onDelete: (room_id: string) => void
  onClose: () => void
}

export function RoomCard(props: RoomCardProps) {
  const { room: r } = props
  const isAvailable = r.available !== false
  const tags = r.equipment_tags ?? []
  const [tagDraft, setTagDraft] = useState("")
  const tagListId = useId()
  const campus: Campus = r.campus ?? "Atlanta"
  const buildingSuggestions = props.knownBuildingsByCampus[campus] ?? []

  const commitTag = () => {
    const normalized = normalizeEquipmentTag(tagDraft)
    setTagDraft("")
    if (!normalized || tags.includes(normalized)) return
    props.onUpdate(r.id, { equipment_tags: [...tags, normalized] })
  }

  const removeTag = (tag: string) => {
    props.onUpdate(r.id, {
      equipment_tags: tags.filter(t => t !== tag),
    })
  }

  const handleDelete = () => {
    const label = r.name || r.id
    if (!window.confirm(
      `Delete "${label}"?\n\n` +
      `This removes the room from your dept's list. Offerings pinned to ` +
      `this room will keep the id but the solver will skip them.`
    )) return
    props.onDelete(r.id)
  }

  return (
    <aside className="panel panel--room-card" aria-label="Room">
      <header className="panel__header">
        <h2 className="panel__title">Room</h2>
        <button
          type="button"
          className="prof-card__back"
          onClick={props.onClose}
          aria-label="Back to class view"
        >
          ← Back
        </button>
      </header>

      <div className="panel__body prof-card__body">
        <section className="room-card__hero">
          <div className="room-card__icon" aria-hidden="true">▦</div>
          <div className="prof-card__identity">
            <h3 className="prof-card__name">{r.name || "(untitled room)"}</h3>
            <span className="prof-card__role">
              {[campus, r.building, r.room_number].filter(Boolean).join(" · ")}
              {(campus || r.building || r.room_number) ? " · " : ""}
              {r.station_count} stations · cap {r.capacity}
            </span>
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Name</label>
          <input
            className="class__input"
            type="text"
            value={r.name}
            placeholder="Room 263 — PC Game Lab"
            onChange={e => props.onUpdate(r.id, { name: e.target.value })}
          />
          <p className="class__hint">
            Shown everywhere the room appears. Edit freely.
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Campus</label>
          <select
            className="class__input"
            value={campus}
            onChange={e =>
              props.onUpdate(r.id, { campus: e.target.value as Campus })
            }
          >
            {CAMPUSES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <p className="class__hint">
            Which SCAD campus the room lives on.
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Building</label>
          <select
            className="class__input"
            value={r.building}
            onChange={e => props.onUpdate(r.id, { building: e.target.value })}
          >
            {!r.building && <option value="" disabled>Select a building…</option>}
            {/* Include the current value even if it's not in the canonical
             *  list for this campus — avoids silently blanking a room when
             *  the chair typed a building that's not (yet) in BUILDINGS_BY_CAMPUS. */}
            {r.building && !buildingSuggestions.includes(r.building) && (
              <option value={r.building}>{r.building}</option>
            )}
            {buildingSuggestions.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <p className="class__hint">
            SCAD buildings on {campus}.
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Room Number</label>
          <input
            className="class__input"
            type="text"
            value={r.room_number ?? ""}
            placeholder="263"
            onChange={e =>
              props.onUpdate(r.id, {
                room_number: e.target.value || undefined,
              })
            }
          />
          <p className="class__hint">
            Free text — room numbers can be alphanumeric (e.g. "B114").
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Stations</label>
          <div className="class__stepper">
            <button
              type="button"
              disabled={r.station_count <= 0}
              onClick={() =>
                props.onUpdate(r.id, {
                  station_count: Math.max(0, r.station_count - 1),
                })
              }
            >
              −
            </button>
            <span className="class__stepper-value">{r.station_count}</span>
            <button
              type="button"
              disabled={r.station_count >= 40}
              onClick={() =>
                props.onUpdate(r.id, {
                  station_count: Math.min(40, r.station_count + 1),
                })
              }
            >
              +
            </button>
          </div>
          <p className="class__hint">
            Number of workstations. 0 = teacher-station-only / lecture.
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Available This Quarter</label>
          <div className="class__segmented">
            <button
              type="button"
              className={
                "class__seg" + (isAvailable ? " class__seg--active" : "")
              }
              onClick={() => props.onUpdate(r.id, { available: true })}
            >
              Available
            </button>
            <button
              type="button"
              className={
                "class__seg" + (!isAvailable ? " class__seg--active" : "")
              }
              onClick={() => props.onUpdate(r.id, { available: false })}
            >
              Offline
            </button>
          </div>
          <p className="class__hint">
            {isAvailable
              ? "Solver may schedule classes here."
              : "Solver will skip this room."}
          </p>
        </section>

        <section className="class__section">
          <label className="class__label">Displays</label>
          <div className="class__stepper">
            <button
              type="button"
              disabled={r.display_count <= 0}
              onClick={() =>
                props.onUpdate(r.id, {
                  display_count: Math.max(0, r.display_count - 1),
                })
              }
            >
              −
            </button>
            <span className="class__stepper-value">{r.display_count}</span>
            <button
              type="button"
              disabled={r.display_count >= 8}
              onClick={() =>
                props.onUpdate(r.id, {
                  display_count: Math.min(8, r.display_count + 1),
                })
              }
            >
              +
            </button>
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Capacity</label>
          <div className="class__stepper">
            <button
              type="button"
              disabled={r.capacity <= 1}
              onClick={() =>
                props.onUpdate(r.id, {
                  capacity: Math.max(1, r.capacity - 1),
                })
              }
            >
              −
            </button>
            <span className="class__stepper-value">{r.capacity}</span>
            <button
              type="button"
              disabled={r.capacity >= 60}
              onClick={() =>
                props.onUpdate(r.id, {
                  capacity: Math.min(60, r.capacity + 1),
                })
              }
            >
              +
            </button>
          </div>
          <p className="class__hint">
            {r.station_count} stations · {r.capacity} seats
          </p>
        </section>

        <details className="class__section prof-card__specs" open={tags.length > 0}>
          <summary className="prof-card__specs-summary">
            <span>Equipment</span>
            {tags.length > 0 && (
              <span className="prof-card__specs-count">{tags.length}</span>
            )}
          </summary>
          <div className="prof-card__tags">
            {tags.map(tag => (
              <span key={tag} className="prof-card__spec">
                {prettyEquipmentTag(tag)}
                <button
                  type="button"
                  className="prof-card__spec-remove"
                  aria-label={`Remove ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              className="prof-card__spec-input"
              list={tagListId}
              placeholder={tags.length ? "Add…" : "e.g. pen_display, vr, motion_capture"}
              value={tagDraft}
              onChange={e => setTagDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  commitTag()
                }
              }}
              onBlur={commitTag}
            />
            <datalist id={tagListId}>
              {props.knownEquipmentTags.map(t => (
                <option key={t} value={prettyEquipmentTag(t)} />
              ))}
            </datalist>
          </div>
          <p className="class__hint">
            Free-form tags describing what this room has. Courses with matching
            <code> required_equipment</code> can schedule here;
            <code> preferred_equipment</code> matches give a soft bonus.
          </p>
        </details>

        <section className="class__section">
          <label className="class__label">Notes</label>
          <textarea
            className="class__textarea"
            rows={2}
            value={r.notes ?? ""}
            placeholder="Hardware specifics, restrictions, etc."
            onChange={e =>
              props.onUpdate(r.id, { notes: e.target.value || undefined })
            }
          />
        </section>

        <section className="class__section room-card__danger">
          <button
            type="button"
            className="room-card__delete"
            onClick={handleDelete}
          >
            Delete this room
          </button>
          <p className="class__hint">
            Removes from your dept's list. Commit to disk to make the change
            stick; other devices won't see the delete until they restore
            from a fresh backup.
          </p>
        </section>
      </div>
    </aside>
  )
}

