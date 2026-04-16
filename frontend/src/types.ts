/**
 * Shared state shape for the GAME Scheduler workspace.
 *
 * Single source of truth. Held by App.tsx. Passed to the three panels
 * (Catalogue, KitStation, TheBoard) as props. Changes flow back up via the
 * SchedulerActions callbacks.
 *
 * NO PANEL STORES ITS OWN COPY OF THIS DATA. If you find yourself doing that,
 * lift it. (AI 201 Project 2 architectural rule.)
 *
 * Field names mirror the JSON on disk in data/*.json. If a field is optional
 * in the JSON, it's optional here.
 */

// ─── Primitives ───────────────────────────────────────────────────

export type DayGroup = 1 | 2 // 1 = Monday/Wednesday, 2 = Tuesday/Thursday
export type TimeSlot = "8:00AM" | "11:00AM" | "2:00PM" | "5:00PM"
export type Priority =
  | "must_have"
  | "should_have"
  | "could_have"
  | "nice_to_have"
export type Department =
  | "game"
  | "motion_media"
  | "ai"
  | "ixds"
  | "iact"
  | "digi"
  | "adbr"
export type SolveMode = "affinity_first" | "time_pref_first" | "balanced"
export type SolveStatus = "idle" | "running" | "done" | "error"
export type TimePref = "morning" | "afternoon" | "afternoon_evening"

// ─── Reference data (immutable once loaded) ───────────────────────

export interface Course {
  id: string // catalog_id, e.g. "GAME_256"
  name: string
  department: Department
  credits: number
  description?: string
  required_room_type: string
  enrollment_cap: number
  specialization_tags: string[]
  is_graduate: boolean
  preferred_professors: string[]
  teaching_order?: number
  prerequisites?: string[]
  source?: string
  usual_quarters?: string[]
}

export interface Professor {
  id: string
  name: string
  home_department: Department
  teaching_departments: Department[]
  chairs: Department[]
  is_chair: boolean
  max_classes: number
  can_overload: boolean
  has_masters: boolean
  masters_type?: string
  masters_in_progress: boolean
  time_preference: TimePref
  available_quarters: string[]
  specializations: string[]
  notes?: string
}

export interface Room {
  id: string
  name: string
  room_type: string
  station_count: number
  station_type: string
  display_count: number
  capacity: number
  notes?: string
}

// ─── Mutable working state ────────────────────────────────────────

export interface Slot {
  day_group: DayGroup
  time_slot: TimeSlot
}

export interface Assignment {
  prof_id: string
  room_id: string
  slot: Slot
}

/**
 * The 5-state lifecycle of an offering:
 *   1. Catalogue         — in the catalog, not yet offered (no Offering row)
 *   2. Offering (unkit)  — added to offerings, prof/room = AUTO, no slot
 *   3. Kitted            — prof and/or room assigned, no slot yet
 *   4. Placed (unlocked) — pinned to a slot; solver may move it
 *   5. Locked            — pinned AND locked; solver cannot move it
 *
 * `pinned` and `locked` are both Slot | null. Both set means "locked to X".
 * Only `pinned` set means "suggested X, solver may override".
 */
export interface Offering {
  catalog_id: string
  priority: Priority
  sections: number
  override_enrollment_cap: number | null
  override_room_type: string | null
  override_preferred_professors: string[] | null
  notes: string | null

  // Kit Station writes these
  assigned_prof_id: string | null // null = AUTO
  assigned_room_id: string | null // null = AUTO

  // Board writes these
  pinned: Slot | null // soft — solver may move
  locked: Slot | null // hard — solver must keep here

  // Solver writes this
  assignment: Assignment | null
}

// ─── The single state object ──────────────────────────────────────

export interface SchedulerState {
  // Selection
  selectedOfferingId: string | null

  // Working data
  offerings: Offering[]

  // Reference lookups
  catalog: Record<string, Course>
  professors: Record<string, Professor>
  rooms: Record<string, Room>

  // Solve state
  solveStatus: SolveStatus
  solveMode: SolveMode

  // Context
  quarter: string
  year: number
}

// ─── Actions (events-up) ──────────────────────────────────────────

export interface SchedulerActions {
  selectOffering: (id: string | null) => void
  addOffering: (catalog_id: string) => void
  removeOffering: (catalog_id: string) => void
  updateOffering: (catalog_id: string, changes: Partial<Offering>) => void
  pinToSlot: (catalog_id: string, slot: Slot | null) => void
  toggleLock: (catalog_id: string) => void
  setSolveMode: (mode: SolveMode) => void
  requestSolve: () => void
  requestExport: () => void
}
