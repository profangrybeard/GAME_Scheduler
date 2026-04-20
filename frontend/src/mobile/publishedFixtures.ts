/**
 * Mocked "published schedules" for the mobile read-only viewer.
 *
 * Real system (not yet built): the desktop workspace will POST a snapshot
 * to `/api/schedules/publish`; mobile will `GET /api/schedules` and render
 * whatever comes back. Until that backend exists we just hand-fabricate a
 * handful of snapshots here so the UI has something to show.
 *
 * Shape stays close to the eventual server contract:
 *   { id, quarter, year, version, publishedAt, author, snapshot }
 * where `snapshot` is the same `draft_state` object PR #52 made round-trip
 * safe through Excel (offerings with .assignment populated, plus the prof
 * and room decks).
 */
import { loadInitialState } from "../data"
import type { Assignment, Offering, Professor, Room, Course, Slot } from "../types"

export type Quarter = "Fall" | "Winter" | "Spring" | "Summer"

export interface PublishedSchedule {
  /** Stable id. `${quarter}-${year}-v${version}`. */
  id: string
  quarter: Quarter
  /** Starting calendar year of the academic year. Fall 2025 / Winter 2026
   *  both belong to academic year 2025. */
  year: number
  version: number
  /** ISO-8601 timestamp. */
  publishedAt: string
  author: string
  snapshot: ScheduleSnapshot
}

export interface ScheduleSnapshot {
  offerings: Offering[]
  professors: Record<string, Professor>
  rooms: Record<string, Room>
  catalog: Record<string, Course>
}

export const QUARTERS: ReadonlyArray<Quarter> = ["Fall", "Winter", "Spring", "Summer"]

/** 25/26 academic-year mapping so the index can label each card correctly. */
export const QUARTER_YEAR: Record<Quarter, number> = {
  Fall:   2025,
  Winter: 2026,
  Spring: 2026,
  Summer: 2026,
}

/** Build a snapshot by taking the bundled defaults and hand-assigning slots
 *  to the first N offerings. Not a real solve — just enough to populate the
 *  grid cells so the read-only view has something to render. The `seed`
 *  argument nudges the assignment pattern so different versions look
 *  slightly different. */
function buildMockSnapshot(seed: number): ScheduleSnapshot {
  const base = loadInitialState()
  const profIds = Object.keys(base.professors)
  const roomIds = Object.keys(base.rooms)
  // 3 day groups × 4 time slots = 12 cells. Deal cards round-robin across
  // them with a seed-dependent offset so v1 and v2 differ visibly.
  const cells: Slot[] = []
  for (let dg = 1 as 1 | 2 | 3; dg <= 3; dg = (dg + 1) as 1 | 2 | 3) {
    for (const ts of ["8:00AM", "11:00AM", "2:00PM", "5:00PM"] as const) {
      cells.push({ day_group: dg, time_slot: ts })
    }
  }
  const assigned: Offering[] = base.offerings.map((o, i) => {
    if (i >= cells.length) return o
    const cell = cells[(i + seed) % cells.length]
    const prof = profIds[(i + seed) % profIds.length]
    const room = roomIds[(i + seed * 2) % roomIds.length]
    const assignment: Assignment = { prof_id: prof, room_id: room, slot: cell }
    return { ...o, assignment }
  })
  return {
    offerings:  assigned,
    professors: base.professors,
    rooms:      base.rooms,
    catalog:    base.catalog,
  }
}

export const PUBLISHED_SCHEDULES: ReadonlyArray<PublishedSchedule> = [
  {
    id:          "Fall-2025-v2",
    quarter:     "Fall",
    year:        2025,
    version:     2,
    publishedAt: "2026-04-18T14:22:00Z",
    author:      "Eric Allen",
    snapshot:    buildMockSnapshot(3),
  },
  {
    id:          "Fall-2025-v1",
    quarter:     "Fall",
    year:        2025,
    version:     1,
    publishedAt: "2026-04-10T09:05:00Z",
    author:      "Eric Allen",
    snapshot:    buildMockSnapshot(1),
  },
  {
    id:          "Winter-2026-v1",
    quarter:     "Winter",
    year:        2026,
    version:     1,
    publishedAt: "2026-04-15T16:40:00Z",
    author:      "Eric Allen",
    snapshot:    buildMockSnapshot(5),
  },
  // Spring 2026 and Summer 2026 intentionally omitted — the index shows
  // them as empty-state cards ("No schedule published yet").
]

/** Group published schedules by quarter, newest version first within each.
 *  Quarters with no publications appear with an empty array so the index
 *  can render their empty-state cards. */
export function groupByQuarter(
  list: ReadonlyArray<PublishedSchedule> = PUBLISHED_SCHEDULES,
): Array<{ quarter: Quarter; year: number; versions: PublishedSchedule[] }> {
  return QUARTERS.map(q => {
    const versions = list
      .filter(s => s.quarter === q)
      .slice()
      .sort((a, b) => b.version - a.version)
    return { quarter: q, year: QUARTER_YEAR[q], versions }
  })
}

export function findPublishedById(id: string): PublishedSchedule | null {
  return PUBLISHED_SCHEDULES.find(s => s.id === id) ?? null
}
