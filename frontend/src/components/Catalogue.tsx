import { useMemo, useState } from "react"
import type { Course, Department, Offering } from "../types"

/**
 * The BROWSER panel — Catalogue.
 *
 * Responsibility: show every course in the catalog. Filter by department,
 * search by ID/name. Clicking a row adds the course to the quarter's
 * offerings (if not already there) and selects it. Dragging a row onto a
 * cell in the Quarter Schedule adds + pins in one move.
 *
 * Reads  (props):  catalog, offerings, selectedOfferingId
 * Writes (events): onSelect, onAdd, onRemove
 *
 * Holds local UI state only (search text, active dept filter). The single
 * source of truth (SchedulerState) stays in App.tsx.
 */

const DND_MIME = "application/x-offering"

export interface CatalogueProps {
  catalog: Record<string, Course>
  offerings: Offering[]
  selectedOfferingId: string | null
  onSelect: (id: string | null) => void
  onAdd: (catalog_id: string) => void
  onRemove: (catalog_id: string) => void
}

const DEPT_CHIPS: ReadonlyArray<{ key: Department | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "game", label: "GAME" },
  { key: "motion_media", label: "MOME" },
  { key: "ai", label: "AI" },
  { key: "ixds", label: "IXDS" },
  { key: "iact", label: "IACT" },
  { key: "digi", label: "DIGI" },
  { key: "adbr", label: "ADBR" },
]

export function Catalogue(props: CatalogueProps) {
  const [query, setQuery] = useState("")
  const [dept, setDept] = useState<Department | "all">("all")

  const offeredIds = useMemo(
    () => new Set(props.offerings.map(o => o.catalog_id)),
    [props.offerings],
  )

  const rows = useMemo(() => {
    const all = Object.values(props.catalog)
    const q = query.trim().toLowerCase()
    return all
      .filter(c => dept === "all" || c.department === dept)
      .filter(c =>
        q === "" ||
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [props.catalog, query, dept])

  return (
    <aside className="panel panel--catalogue" aria-label="Catalogue">
      <header className="panel__header">
        <h2 className="panel__title">Catalogue</h2>
        <span className="panel__count">{rows.length}</span>
      </header>

      <div className="catalogue__filters">
        <input
          className="catalogue__search"
          type="search"
          placeholder="Search ID or name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="catalogue__chips" role="tablist">
          {DEPT_CHIPS.map(chip => (
            <button
              key={chip.key}
              role="tab"
              aria-selected={dept === chip.key}
              className={
                "chip" + (dept === chip.key ? " chip--active" : "")
              }
              onClick={() => setDept(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__body catalogue__list">
        {rows.length === 0 && (
          <p className="placeholder placeholder--empty">No matches.</p>
        )}
        {rows.map(course => {
          const isOffered = offeredIds.has(course.id)
          const isSelected = props.selectedOfferingId === course.id
          return (
            <div
              key={course.id}
              role="button"
              tabIndex={0}
              draggable
              className={
                "catalogue-row" +
                (isOffered ? " catalogue-row--offered" : "") +
                (isSelected ? " catalogue-row--selected" : "")
              }
              onClick={() => {
                if (!isOffered) props.onAdd(course.id)
                props.onSelect(course.id)
              }}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  if (!isOffered) props.onAdd(course.id)
                  props.onSelect(course.id)
                }
              }}
              onDragStart={e => {
                e.dataTransfer.setData(DND_MIME, course.id)
                e.dataTransfer.setData("text/plain", course.id)
                e.dataTransfer.effectAllowed = "copyMove"
              }}
            >
              <span className="catalogue-row__id">{course.id}</span>
              <span className="catalogue-row__name">{course.name}</span>
              <span
                className={"catalogue-row__dept dept dept--" + course.department}
              >
                {course.department}
              </span>
              {isOffered && (
                <span
                  className="catalogue-row__remove"
                  role="button"
                  aria-label={`Remove ${course.id} from offerings`}
                  onClick={e => {
                    e.stopPropagation()
                    props.onRemove(course.id)
                  }}
                >
                  ×
                </span>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
