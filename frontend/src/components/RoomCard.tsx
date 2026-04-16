import type { Room } from "../types"

/**
 * The ROOM card — rendered in the detail panel when a room row is clicked
 * in the Roster's Rooms tab.
 *
 * Focused on editable per-quarter fields: availability toggle, display count,
 * capacity, notes. Read-only context (room_type, station_count, station_type)
 * is in the hero.
 *
 * Mirrors ProfessorCard patterns — same panel chrome, same back button, same
 * section primitives.
 */

const ROOM_TYPE_LABELS: Record<string, string> = {
  pc_lab: "PC Lab",
  mac_lab: "Mac Lab",
  game_lab: "Game Lab",
  design_lab: "Design Lab",
  lecture: "Lecture",
  classroom: "Classroom",
}

function prettyRoomType(type: string): string {
  return ROOM_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

export interface RoomCardProps {
  room: Room
  onUpdate: (room_id: string, changes: Partial<Room>) => void
  onClose: () => void
}

export function RoomCard(props: RoomCardProps) {
  const { room: r } = props
  const isAvailable = r.available !== false

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
            <h3 className="prof-card__name">{r.name}</h3>
            <span className="prof-card__role">
              {prettyRoomType(r.room_type).toUpperCase()} · {r.station_count}×{r.station_type.toUpperCase()}
            </span>
          </div>
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
      </div>
    </aside>
  )
}
