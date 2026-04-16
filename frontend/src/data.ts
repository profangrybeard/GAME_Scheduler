/**
 * Initial data loader + static reference maps.
 *
 * - Imports the four canonical JSON files from the repo's `data/` directory
 *   (one level up from `frontend/`). Vite's dev server needs
 *   `server.fs.allow` to reach there — see vite.config.ts.
 * - Enumerates professor portraits from `data/portraits/<prof_id>.{png|jpg|jpeg|webp}`
 *   at build/dev time via Vite's `import.meta.glob`. Missing portraits fall
 *   back to colored initials via `PROF_COLORS`.
 *
 * Everything is normalized into the SchedulerState shape up front so the rest
 * of the app never has to think about missing fields or `undefined`.
 */

import coursesJson from "../../data/course_catalog.json"
import professorsJson from "../../data/professors.json"
import roomsJson from "../../data/rooms.json"
import offeringsJson from "../../data/quarterly_offerings.default.json"

import type {
  Course,
  Offering,
  Professor,
  Room,
  SchedulerState,
  Slot,
} from "./types"

// ─── Reference data ──────────────────────────────────────────────────

const rawCourses = coursesJson as unknown as Course[]
const rawProfessors = professorsJson as unknown as Professor[]
const rawRooms = roomsJson as unknown as Room[]
const rawOfferingsDoc = offeringsJson as unknown as {
  quarter: string
  year: number
  offerings: Array<
    Omit<Offering, "assigned_prof_id" | "assigned_room_id" | "pinned" | "assignment"> & {
      pinned?: Slot | null
      locked?: Slot | null
    }
  >
}

// ─── Professor portraits (eagerly imported via Vite glob) ───────────
//
// `import.meta.glob` is resolved at build time. Empty folder → empty map →
// every prof falls back to initials. Drop a file in data/portraits/ named
// <prof_id>.<ext> and it appears on next dev reload.

const portraitModules = import.meta.glob<{ default: string }>(
  "../../data/portraits/*.{png,jpg,jpeg,webp}",
  { eager: true },
)

export const PORTRAIT_BY_PROF_ID: Record<string, string> = {}
for (const [path, mod] of Object.entries(portraitModules)) {
  const match = path.match(/([^/\\]+)\.(png|jpg|jpeg|webp)$/i)
  if (match) PORTRAIT_BY_PROF_ID[match[1]] = mod.default
}

/**
 * Distinct color per professor for the initials-fallback avatar.
 * Mirrors PROF_COLORS in app.py so the Streamlit shell and React workspace
 * look consistent. Unknown prof → neutral grey.
 */
export const PROF_COLORS: Record<string, string> = {
  prof_allen: "#3B82F6",    // blue
  prof_lindsey: "#A78BFA",  // purple
  prof_dodson: "#14B8A6",   // teal
  prof_avenali: "#F59E0B",  // amber
  prof_spencer: "#10B981",  // green
  prof_maloney: "#EF4444",  // red
  prof_imperato: "#F97316", // orange
}

export function profInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ─── Initial state builder ──────────────────────────────────────────

export function loadInitialState(): SchedulerState {
  const catalog: Record<string, Course> = {}
  for (const c of rawCourses) catalog[c.id] = c

  const professors: Record<string, Professor> = {}
  for (const p of rawProfessors) professors[p.id] = p

  const rooms: Record<string, Room> = {}
  for (const r of rawRooms) rooms[r.id] = r

  const offerings: Offering[] = rawOfferingsDoc.offerings.map(raw => ({
    catalog_id: raw.catalog_id,
    priority: raw.priority,
    sections: raw.sections,
    override_enrollment_cap: raw.override_enrollment_cap ?? null,
    override_room_type: raw.override_room_type ?? null,
    override_preferred_professors: raw.override_preferred_professors ?? null,
    notes: raw.notes ?? null,
    assigned_prof_id: null,
    assigned_room_id: null,
    pinned: raw.pinned ?? null,
    locked: raw.locked ?? null,
    assignment: null,
  }))

  return {
    selectedOfferingId: offerings[0]?.catalog_id ?? null,
    offerings,
    catalog,
    professors,
    rooms,
    solveStatus: "idle",
    solveMode: "balanced",
    quarter: rawOfferingsDoc.quarter,
    year: rawOfferingsDoc.year,
  }
}
