import { useMemo } from "react"
import type { Course, Department, Offering } from "../types"

/** Filter value shared between the Courses tab's "In Roster" and "Browse"
 *  sub-modes. `"all"` is the no-dept-selected state. Exported so Roster can
 *  hold the state and pass it into both sub-views. */
export type DeptFilter = Department | "all"

/** Dept chips rendered above both Courses sub-modes. Order is intentional:
 *  GAME first (host dept), then alpha-ish grouping. Exported so Roster owns
 *  rendering. */
export const DEPT_CHIPS: ReadonlyArray<{ key: DeptFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "game", label: "GAME" },
  { key: "motion_media", label: "MOME" },
  { key: "ai", label: "AI" },
  { key: "ixds", label: "IXDS" },
  { key: "iact", label: "IACT" },
  { key: "digi", label: "DIGI" },
  { key: "adbr", label: "ADBR" },
]

/** Match a course against a lowercase search query. Query matches if the
 *  course's ID or name contains the substring. Empty query matches all.
 *  Exported so the In Roster list can share filter semantics with Browse. */
export function courseMatchesQuery(course: Course, q: string): boolean {
  if (q === "") return true
  return (
    course.id.toLowerCase().includes(q) ||
    course.name.toLowerCase().includes(q)
  )
}

/**
 * Catalogue — the Browse sub-mode of the Roster panel's Courses tab.
 *
 * Responsibility: show every course in the catalog matching the search +
 * dept filters owned by Roster. Clicking a row adds the course to the
 * quarter's offerings (if not already there) and selects it. Dragging a row
 * onto a cell in the Quarter Schedule adds + pins in one move.
 *
 * Renders the list only — Roster renders the shared filter bar above so the
 * query/dept persist when switching to "In Roster".
 */

/** Catalogue drags carry catalog_id (payload = course to add on drop).
 *  Distinct MIME from the `application/x-offering` used by Roster + Schedule
 *  so drop targets can tell add-from-catalogue from move-existing. */
const DND_MIME_COURSE = "application/x-course"

export interface CatalogueProps {
  catalog: Record<string, Course>
  offerings: Offering[]
  selectedOfferingId: string | null
  /** Search + dept filters are lifted to Roster so they persist when the user
   *  switches to "In Roster" and back. Catalogue is a pure view over them. */
  query: string
  dept: DeptFilter
  onSelect: (offering_id: string | null) => void
  /** Returns the resulting offering_id (new or existing) so the click path
   *  can chain a select on it without waiting for a re-render. */
  onAdd: (catalog_id: string) => string | null
  onRemove: (offering_id: string) => void
}

export function Catalogue(props: CatalogueProps) {
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
    const q = props.query.trim().toLowerCase()
    return all
      .filter(c => props.dept === "all" || c.department === props.dept)
      .filter(c => courseMatchesQuery(c, q))
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [props.catalog, props.query, props.dept])

  return (
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
  )
}
