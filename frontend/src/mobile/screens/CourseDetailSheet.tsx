/**
 * Bottom-sheet detail editor for a placed offering. Lets the chair
 * change the prof and room assignments and remove the placement
 * entirely. Edits are live — each select change applies immediately;
 * no Save button.
 *
 * Native <select> for the prof and room pickers per the "prefer native
 * controls" memory: iOS Safari shows its picker wheel, Android Chrome
 * its dropdown. Both feel native and handle long lists better than a
 * custom combobox would on a 375px viewport.
 *
 * "AUTO" (let the solver choose) is the empty-string option in each
 * select; we map that back to null on the offering's
 * assigned_prof_id / assigned_room_id.
 */
import type {
  Course,
  Offering,
  Professor,
  Room,
  Slot,
  TimeSlot,
} from "../../types"

const TIME_SLOT_LABEL: Record<TimeSlot, string> = {
  "8:00AM":  "8 AM",
  "11:00AM": "11 AM",
  "2:00PM":  "2 PM",
  "5:00PM":  "5 PM",
}

const DAY_LABEL: Record<number, string> = { 1: "MW", 2: "TTh", 3: "F" }

interface Props {
  offering: Offering
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  onSetProf: (offering_id: string, prof_id: string | null) => void
  onSetRoom: (offering_id: string, room_id: string | null) => void
  onRemove: (offering_id: string) => void
  onDismiss: () => void
}

function effectiveSlot(o: Offering): Slot | null {
  return o.pinned ?? o.assignment?.slot ?? null
}

export function CourseDetailSheet(props: Props) {
  const { offering, catalog, professors, rooms } = props
  const slot = effectiveSlot(offering)
  const slotLabel = slot
    ? `${DAY_LABEL[slot.day_group]} · ${TIME_SLOT_LABEL[slot.time_slot]}`
    : "Unplaced"

  const courseName = catalog[offering.catalog_id]?.name
  const profOptions = Object.values(professors).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const roomOptions = Object.values(rooms).sort((a, b) =>
    a.id.localeCompare(b.id),
  )

  const profValue = offering.assigned_prof_id ?? ""
  const roomValue = offering.assigned_room_id ?? ""

  return (
    <>
      <div
        className="m-sheet__scrim"
        onClick={props.onDismiss}
        aria-hidden="true"
      />
      <aside
        className="m-sheet"
        role="dialog"
        aria-label={`${offering.catalog_id} detail`}
      >
        <header className="m-sheet__header">
          <div>
            <div className="m-sheet__eyebrow">{slotLabel}</div>
            <h2 className="m-sheet__title">{offering.catalog_id}</h2>
            {courseName && (
              <div className="m-sheet__subtitle">{courseName}</div>
            )}
          </div>
          <button
            type="button"
            className="m-sheet__close"
            onClick={props.onDismiss}
            aria-label="Close detail sheet"
          >
            ×
          </button>
        </header>

        <div className="m-sheet__body">
          <label className="m-field">
            <span className="m-field__label">Professor</span>
            <select
              className="m-field__select"
              value={profValue}
              onChange={e =>
                props.onSetProf(
                  offering.offering_id,
                  e.target.value === "" ? null : e.target.value,
                )
              }
            >
              <option value="">AUTO — let the solver choose</option>
              {profOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="m-field">
            <span className="m-field__label">Room</span>
            <select
              className="m-field__select"
              value={roomValue}
              onChange={e =>
                props.onSetRoom(
                  offering.offering_id,
                  e.target.value === "" ? null : e.target.value,
                )
              }
            >
              <option value="">AUTO — let the solver choose</option>
              {roomOptions.map(r => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="m-sheet__danger"
            onClick={() => props.onRemove(offering.offering_id)}
          >
            Remove from {slotLabel}
          </button>
        </div>
      </aside>
    </>
  )
}
