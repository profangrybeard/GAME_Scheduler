import type { Course, Department } from "../types"

/**
 * Shared filter primitives for the Courses tab — the Roster panel owns the
 * state and passes it into both "In Roster" and "Browse" sub-modes so search
 * and dept-pill selections persist across the toggle.
 *
 * Kept in its own module (not Catalogue.tsx) so fast-refresh can treat the
 * component file as components-only — mixing non-component exports trips the
 * `react-refresh/only-export-components` lint rule.
 */

/** Filter value for the shared dept chips. `"all"` is the unselected state. */
export type DeptFilter = Department | "all"

/** Dept chips rendered above both Courses sub-modes. Order is intentional:
 *  "All" first, then GAME (host dept), then the other schools. */
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
 *  course's ID or name contains the substring. Empty query matches all. */
export function courseMatchesQuery(course: Course, q: string): boolean {
  if (q === "") return true
  return (
    course.id.toLowerCase().includes(q) ||
    course.name.toLowerCase().includes(q)
  )
}
