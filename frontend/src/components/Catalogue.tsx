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

/** Catalogue drags carry catalog_id (payload = course to add on drop).
 *  Distinct MIME from the `application/x-offering` used by Roster + Schedule
 *  so drop targets can tell add-from-catalogue from move-existing. */
const DND_MIME_COURSE = "application/x-course"

export interface CatalogueProps {
  catalog: Record<string, Course>
  offerings: Offering[]
  selectedOfferingId: string | null
  onSelect: (offering_id: string | null) => void
  /** Returns the resulting offering_id (new or existing) so the click path
   *  can chain a select on it without waiting for a re-render. */
  onAdd: (catalog_id: string) => string | null
  onRemove: (offering_id: string) => void
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

  /** catalog_ids that currently have at least one offering. Drives the
   *  "offered" chrome on each row. Siblings (PR 2+) collapse to the set. */
  const offeredIds = useMemo(
    () => new Set(props.offerings.map(o => o.catalog_id)),
    [props.offerings],
  )

  /** catalog_id of whichever offering is currently selected, or null. Used to
   *  decide the row highlight. Today's 1:1 relationship means highlighting
   *  the catalog_id row is unambiguous; post-split, multiple rows could share
   *  a catalog_id but only one sibling is ever selected. */
  const selectedCatalogId = useMemo(() => {
    if (!props.selectedOfferingId) return null
    const found = props.offerings.find(
      o => o.offering_id === props.selectedOfferingId,
    )
    return found?.catalog_id ?? null
  }, [props.offerings, props.selectedOfferingId])

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
          const isSelected = selectedCatalogId === course.id
          const handleActivate = () => {
            const existing = props.offerings.find(o => o.catalog_id === course.id)
            if (existing) {
              props.onSelect(existing.offering_id)
              return
            }
            const newId = props.onAdd(course.id)
            if (newId) props.onSelect(newId)
          }
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
              onClick={handleActivate}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  handleActivate()
                }
              }}
              onDragStart={e => {
                e.dataTransfer.setData(DND_MIME_COURSE, course.id)
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
                    const existing = props.offerings.find(
                      o => o.catalog_id === course.id,
                    )
                    if (existing) props.onRemove(existing.offering_id)
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
