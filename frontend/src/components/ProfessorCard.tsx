import { useRef } from "react"
import type { Professor, TimePref } from "../types"
import { ProfAvatar } from "./ProfAvatar"

/**
 * The PROFESSOR player card — rendered in the detail panel when a professor
 * avatar is clicked anywhere (Roster, Class lockup, schedule grid).
 *
 * Focused on editable scheduling fields only: time preference, max classes,
 * quarter availability, notes, and portrait. Read-only context (name, dept,
 * chair) is in the hero. Everything else lives in the source JSON.
 */

const TIME_PREF_OPTIONS: ReadonlyArray<{ key: TimePref; label: string }> = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "afternoon_evening", label: "Aft / Eve" },
]

const QUARTERS = ["fall", "winter", "spring", "summer"] as const

export interface ProfessorCardProps {
  professor: Professor
  onUpdate: (prof_id: string, changes: Partial<Professor>) => void
  onPortraitChange: (prof_id: string, dataUrl: string | null) => void
  portraitUrl: string | null
  onClose: () => void
}

export function ProfessorCard(props: ProfessorCardProps) {
  const { professor: p } = props
  const fileRef = useRef<HTMLInputElement>(null)

  const handlePortraitPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        props.onPortraitChange(p.id, reader.result)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  return (
    <aside className="panel panel--prof-card" aria-label="Professor">
      <header className="panel__header">
        <h2 className="panel__title">Professor</h2>
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
        <section className="prof-card__hero">
          <ProfAvatar profId={p.id} name={p.name} size={64} className="prof-card__avatar" />
          <div className="prof-card__identity">
            <h3 className="prof-card__name">{p.name}</h3>
            <span className="prof-card__role">
              {p.is_chair ? "Chair · " : ""}
              {p.home_department.toUpperCase()}
            </span>
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Time Preference</label>
          <div className="class__segmented">
            {TIME_PREF_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={
                  "class__seg" +
                  (p.time_preference === opt.key ? " class__seg--active" : "")
                }
                onClick={() => props.onUpdate(p.id, { time_preference: opt.key })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Max Classes</label>
          <div className="class__stepper">
            <button
              type="button"
              disabled={p.max_classes <= 1}
              onClick={() =>
                props.onUpdate(p.id, { max_classes: Math.max(1, p.max_classes - 1) })
              }
            >
              −
            </button>
            <span className="class__stepper-value">{p.max_classes}</span>
            <button
              type="button"
              disabled={p.max_classes >= 8}
              onClick={() =>
                props.onUpdate(p.id, { max_classes: Math.min(8, p.max_classes + 1) })
              }
            >
              +
            </button>
          </div>
          {p.can_overload && (
            <p className="class__hint">Can overload beyond max</p>
          )}
        </section>

        <section className="class__section">
          <label className="class__label">Available Quarters</label>
          <div className="prof-card__quarters">
            {QUARTERS.map(q => {
              const active = p.available_quarters.includes(q)
              return (
                <button
                  key={q}
                  type="button"
                  className={"chip" + (active ? " chip--active" : "")}
                  onClick={() => {
                    const next = active
                      ? p.available_quarters.filter(x => x !== q)
                      : [...p.available_quarters, q]
                    props.onUpdate(p.id, { available_quarters: next })
                  }}
                >
                  {q.charAt(0).toUpperCase() + q.slice(1)}
                </button>
              )
            })}
          </div>
        </section>

        <section className="class__section">
          <label className="class__label">Notes</label>
          <textarea
            className="class__textarea"
            rows={2}
            value={p.notes ?? ""}
            placeholder="Professor notes, preferences, etc."
            onChange={e =>
              props.onUpdate(p.id, { notes: e.target.value || undefined })
            }
          />
        </section>

        <section className="class__section">
          <label className="class__label">Portrait</label>
          <div className="prof-card__portrait-actions">
            <button
              type="button"
              className="prof-card__upload-btn"
              onClick={() => fileRef.current?.click()}
            >
              {props.portraitUrl ? "Change image" : "Upload image"}
            </button>
            {props.portraitUrl && (
              <button
                type="button"
                className="prof-card__remove-portrait"
                onClick={() => props.onPortraitChange(p.id, null)}
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="prof-card__file-input"
            onChange={handlePortraitPick}
          />
        </section>
      </div>
    </aside>
  )
}
