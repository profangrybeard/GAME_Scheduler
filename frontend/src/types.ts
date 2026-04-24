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

export type DayGroup = 1 | 2 | 3 // 1 = Monday/Wednesday, 2 = Tuesday/Thursday, 3 = Friday
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

/** Canonical display order of departments across the UI (topbar label,
 *  chair chips, etc). Change once, propagate everywhere. */
export const SCHOOL_ORDER: ReadonlyArray<Department> = [
  "game", "motion_media", "ai", "ixds", "iact", "digi", "adbr",
]

/** Quarter labels used in the topbar select and the schedule header.
 *  Lives here (not in QuarterSchedule.tsx) so the file can export only its
 *  component — react-refresh/only-export-components otherwise errors. */
export const QUARTER_OPTIONS: ReadonlyArray<string> = ["Fall", "Winter", "Spring", "Summer"]

/** Short labels for each department — used in topbar context + chair chips. */
export const SCHOOL_LABELS: Record<Department, string> = {
  game: "GAME",
  motion_media: "MOME",
  ai: "AI",
  ixds: "IXDS",
  iact: "IACT",
  digi: "DIGI",
  adbr: "ADBR",
}
export type SolveMode = "cover_first" | "time_pref_first" | "balanced"
export type SolveStatus = "idle" | "running" | "done" | "error"

/** Live progress for one mode during streaming solve. Populated from SSE
 *  events; `null` fields mean "not yet reported". */
export interface SolveModeProgress {
  mode: string
  state: "waiting" | "running" | "done"
  index: number | null      // 1-based ordering of modes in this solve
  solutionsFound: number
  bestObjective: number | null
  bestBound: number | null
  nPlaced: number | null
  nTotal: number | null
  elapsedMs: number | null  // total mode elapsed when done
  status: string | null     // 'optimal' / 'feasible' / 'infeasible' / ...
  unscheduledCount: number | null
}

/** Aggregate progress state for an in-flight or recently-completed solve.
 *  Held in App.tsx; passed down to the progress panel.
 *
 *  `phase` distinguishes Generate-only flows from streaming Export flows.
 *  Generate stays in "solving" the whole time. Export passes through:
 *  "solving" → "writing" (on `xlsx_writing` event) → "exported" (on
 *  `export_complete`). Optional so existing solve flows don't have to set it. */
export interface SolveProgressState {
  startedAt: number | null  // performance.now() when the stream opened
  endedAt: number | null    // performance.now() when solve_complete/error fired
  totalModes: number | null
  modes: Record<string, SolveModeProgress>
  errorMessage: string | null
  phase?: "solving" | "writing" | "exported"
}
export type TimePref = "morning" | "afternoon" | "afternoon_evening"

// ─── Reference data (immutable once loaded) ───────────────────────

export interface Course {
  id: string // catalog_id, e.g. "GAME_256"
  name: string
  department: Department
  credits: number
  description?: string
  enrollment_cap: number
  specialization_tags: string[]
  is_graduate: boolean
  preferred_professors: string[]
  teaching_order?: number
  prerequisites?: string[]
  source?: string
  usual_quarters?: string[]
  /** Equipment tags a room MUST have for this course to run there. Hard
   *  constraint in the solver: room.equipment_tags ⊇ course.required_equipment.
   *  Missing/empty means "no equipment requirement". */
  required_equipment?: string[]
  /** Equipment tags the course PREFERS but doesn't require. Soft bonus in
   *  the solver — rooms missing preferred tags take a small penalty per
   *  missing tag. Missing/empty means "no preference". */
  preferred_equipment?: string[]
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
  /** Free-text building name. SCAD runs campuses in Savannah, Atlanta, and
   *  Lacoste; buildings are department-specific, so this stays unstructured. */
  building: string
  station_count: number
  display_count: number
  capacity: number
  notes?: string
  /** Per-quarter availability. `undefined` means available (default).
   *  Set to `false` when a room is offline for the quarter. */
  available?: boolean
  /** Free-form equipment tags. Vocabulary is chair-authored: anything the
   *  chair wants to match against Course.required_equipment /
   *  preferred_equipment. Chips auto-suggest from tags already in use in
   *  the document — no canonical list. Missing/empty means the room has
   *  none of the chair's tagged capabilities (still eligible for courses
   *  with no required_equipment). */
  equipment_tags?: string[]
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
 * The 4-state lifecycle of an offering:
 *   1. Catalogue         — in the catalog, not yet offered (no Offering row)
 *   2. Offering (unkit)  — added to offerings, prof/room = AUTO, no slot
 *   3. Kitted            — prof and/or room assigned, no slot yet
 *   4. Placed            — pinned to a slot (drag always allowed)
 *
 * When the solver wires up, a placed offering is a hint; we'll layer any
 * hard-constraint mechanism on top then (see Record of Resistance).
 */
export interface Offering {
  /** Stable runtime identity for this offering row. Required everywhere
   *  selection, DnD, and mutations happen. Persistence (JSON/Excel) is still
   *  keyed by `catalog_id`; `offering_id` is regenerated at load. Format:
   *  `${catalog_id}#${n}` where `n` starts at 1 per catalog_id. */
  offering_id: string
  catalog_id: string
  priority: Priority
  sections: number
  override_enrollment_cap: number | null
  override_preferred_professors: string[] | null
  notes: string | null

  // Kit Station writes these
  assigned_prof_id: string | null // null = AUTO
  assigned_room_id: string | null // null = AUTO

  // Board writes this
  pinned: Slot | null

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

// ─── Offering identity helpers ────────────────────────────────────

/** Mint a fresh offering_id unique among `existing`. Format: `${cid}#${n}`
 *  with n starting at 1 and incrementing past any sibling already present.
 *  Used on load, add, and post-solve state rebuilds. */
export function mintOfferingId(
  catalog_id: string,
  existing: ReadonlyArray<{ offering_id: string }>,
): string {
  const prefix = catalog_id + "#"
  let max = 0
  for (const o of existing) {
    if (!o.offering_id.startsWith(prefix)) continue
    const n = parseInt(o.offering_id.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${catalog_id}#${max + 1}`
}

/** Shape of an offering as it travels on the wire — initial JSON from
 *  `data/quarterly_offerings.json`, the `_state` sheet of a reloaded XLSX,
 *  and the POST body to `/api/solve/stream`. Same as `Offering` minus the
 *  runtime-only `offering_id` (minted at expand time) and `assignment`
 *  (hydrated separately from solver results).
 *
 *  Flat format (one row per section): each row has `sections: 1` and its own
 *  `pinned` slot. Legacy `sections: N` rows are still accepted on load —
 *  `expandOfferingsFromWire` expands them in-place. */
export type WireOffering = Omit<Offering, "offering_id" | "assignment">

/** Parse a `${cid}#${n}` offering_id into its 1-based sibling ordinal.
 *  Non-matching ids fall back to 0 (sorts before any real sibling). */
export function offeringIdOrdinal(id: string): number {
  const hash = id.lastIndexOf("#")
  if (hash < 0) return 0
  const n = parseInt(id.slice(hash + 1), 10)
  return Number.isFinite(n) ? n : 0
}

/** Expand a wire-shape offerings list into runtime `Offering` rows. For the
 *  flat wire format (one row per section), each row becomes one Offering with
 *  a minted `offering_id`. The legacy coalesced format (`sections: N` per
 *  catalog_id) is expanded on the fly so old fixtures still load — each
 *  sibling after #1 starts unpinned since the legacy format only carries one
 *  pin per catalog_id. */
export function expandOfferingsFromWire(
  wire: ReadonlyArray<WireOffering>,
): Offering[] {
  const out: Offering[] = []
  const nextOrdinal: Map<string, number> = new Map()
  for (const w of wire) {
    const n = Math.max(1, w.sections | 0)
    for (let k = 0; k < n; k++) {
      const ordinal = (nextOrdinal.get(w.catalog_id) ?? 0) + 1
      nextOrdinal.set(w.catalog_id, ordinal)
      out.push({
        offering_id: `${w.catalog_id}#${ordinal}`,
        catalog_id: w.catalog_id,
        priority: w.priority,
        sections: 1,
        override_enrollment_cap: w.override_enrollment_cap,
        override_preferred_professors: w.override_preferred_professors,
        notes: w.notes,
        assigned_prof_id: w.assigned_prof_id,
        assigned_room_id: w.assigned_room_id,
        pinned: k === 0 ? w.pinned : null,
        assignment: null,
      })
    }
  }
  return out
}

/** Serialize runtime offerings back to the flat wire format — one row per
 *  sibling, each carrying its own `pinned` slot. Drops the runtime-only
 *  `offering_id` and `assignment` fields. Output order matches input order
 *  so a round-trip preserves the user-visible sibling sequence. */
export function coalesceOfferingsForWire(
  offerings: ReadonlyArray<Offering>,
): WireOffering[] {
  return offerings.map(o => ({
    catalog_id: o.catalog_id,
    priority: o.priority,
    sections: 1,
    override_enrollment_cap: o.override_enrollment_cap,
    override_preferred_professors: o.override_preferred_professors,
    notes: o.notes,
    assigned_prof_id: o.assigned_prof_id,
    assigned_room_id: o.assigned_room_id,
    pinned: o.pinned,
  }))
}

// ─── Offering classification (shared by Roster + Class) ──────────

export type OfferingState =
  | "offering" // in offerings, prof+room AUTO, no slot
  | "kitted"   // prof and/or room assigned, no slot
  | "placed"   // pinned/assigned to a slot

export function classifyOffering(o: Offering): OfferingState {
  if (o.pinned || o.assignment) return "placed"
  if (o.assigned_prof_id || o.assigned_room_id) return "kitted"
  return "offering"
}

// ─── Priority table (shared by Class segmented control + Roster sort) ──

/** Single source of truth for priority keys, UI labels, tooltip copy, and
 *  sort order. Add a new priority? Add one row here. */
export const PRIORITIES: ReadonlyArray<{
  key: Priority
  label: string
  tooltip: string
}> = [
  {
    key: "must_have",
    label: "Must",
    tooltip: "Hard requirement. The solver fails if this can't be placed.",
  },
  {
    key: "should_have",
    label: "Should",
    tooltip: "Strong preference. Dropped only as a last resort.",
  },
  {
    key: "could_have",
    label: "Could",
    tooltip: "Include if there's room. First to drop when the quarter is tight.",
  },
  {
    key: "nice_to_have",
    label: "Nice",
    tooltip: "Pure wishlist. Drop freely — good for speculative additions.",
  },
]

/** Sort index derived from `PRIORITIES` order. Must_have = 0 (top). */
export const PRIORITY_INDEX: Record<Priority, number> = Object.fromEntries(
  PRIORITIES.map((p, i) => [p.key, i]),
) as Record<Priority, number>

// ─── Professor display helpers ────────────────────────────────────

/** Canonical "Chair · GAME" / "GAME" role line. Routes department through
 *  SCHOOL_LABELS so "motion_media" renders as "MOME", not "MOTION_MEDIA". */
export function profRoleText(p: Professor): string {
  const dept = SCHOOL_LABELS[p.home_department]
  return p.is_chair ? `Chair · ${dept}` : dept
}

// ─── Contract capacity ────────────────────────────────────────────

/** Contract floor — how many classes this professor is expected to teach
 *  before the chair considers an overload. Chairs get 2 (admin load eats
 *  the other 2), everyone else gets the standard 4-class contract. */
export function profContractFloor(p: Professor): number {
  return p.is_chair ? 2 : 4
}

/** Contract ceiling — floor + 1 if the prof can overload, else floor.
 *  One overload slot max per prof by current SCAD faculty contract. */
export function profContractCeiling(p: Professor): number {
  return profContractFloor(p) + (p.can_overload ? 1 : 0)
}

/** Department-wide capacity summary used by the topbar chip and the
 *  Profs-tab nag. `loaded` is the total offering count — pre-assigning an
 *  offering to a specific prof doesn't change the dept-level math, only
 *  the per-prof meter. */
export interface RosterCapacity {
  /** Sum of contract floors across profs available for the active quarter. */
  floorTotal: number
  /** Sum of contract ceilings (floor + overload slot where allowed). */
  ceilingTotal: number
  /** Total offerings loaded for the quarter. */
  loaded: number
}

export type CapacityState = "under" | "contract" | "overload" | "maxed"

/** Map {loaded, floorTotal, ceilingTotal} to one of four semantic states:
 *  - under:    loaded < floor              (keep adding classes)
 *  - contract: loaded === floor            (hit the floor, overloads still open)
 *  - overload: floor < loaded < ceiling    (spending overload slots)
 *  - maxed:    loaded >= ceiling           (at cap) */
export function capacityState(cap: RosterCapacity): CapacityState {
  if (cap.loaded >= cap.ceilingTotal) return "maxed"
  if (cap.loaded > cap.floorTotal) return "overload"
  if (cap.loaded === cap.floorTotal) return "contract"
  return "under"
}

/** Count sections placed on a specific prof's contract. Covers both the
 *  manual Kit-Station assignment (`assigned_prof_id`) and the solver's own
 *  output (`assignment.prof_id`) so the Roster's Profs tab meter reflects
 *  a generated schedule, not just pre-placements. An offering with
 *  sections=2 fills two slots on whichever prof ends up holding it. */
export function profLoadedCount(
  profId: string,
  offerings: ReadonlyArray<{
    assigned_prof_id: string | null
    assignment: Assignment | null
    sections: number
  }>,
): number {
  let n = 0
  for (const o of offerings) {
    const effective = o.assignment?.prof_id ?? o.assigned_prof_id
    if (effective === profId) n += o.sections
  }
  return n
}

/** Tooltip copy for the ammo-counter chip — mirrors the Profs-tab nag so
 *  hover and glance tell the same story. */
export function capacityChipTitle(
  cap: RosterCapacity,
  state: CapacityState,
): string {
  const gap = cap.floorTotal - cap.loaded
  const overloadSlots = cap.ceilingTotal - cap.floorTotal
  switch (state) {
    case "under":
      return `${gap} slot${gap === 1 ? "" : "s"} under contract — keep loading.`
    case "contract":
      return `Contract met. ${overloadSlots} overload slot${overloadSlots === 1 ? "" : "s"} open for MUSTs.`
    case "overload": {
      const used = cap.loaded - cap.floorTotal
      const left = cap.ceilingTotal - cap.loaded
      return `${used} overload used, ${left} left.`
    }
    case "maxed":
      return "At cap — nice work."
  }
}

// ─── Equipment tag helpers ────────────────────────────────────────

/** Normalize a free-typed tag to the storage form: trimmed, lowercased,
 *  whitespace collapsed to underscores. Empty after normalization → "". */
export function normalizeEquipmentTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_")
}

/** Human-readable display form: underscores back to spaces. */
export function prettyEquipmentTag(tag: string): string {
  return tag.replace(/_/g, " ")
}

/** Collect every equipment tag already in use in the current document —
 *  unioned across all rooms + catalog. Used to drive the in-doc autocomplete
 *  on the equipment chip editors so chairs avoid typo-drift within a doc
 *  without a canonical vocabulary file. Sorted alphabetically. */
export function collectEquipmentTags(
  catalog: Record<string, Course>,
  rooms: Record<string, Room>,
): string[] {
  const seen = new Set<string>()
  for (const c of Object.values(catalog)) {
    for (const t of c.required_equipment ?? []) seen.add(t)
    for (const t of c.preferred_equipment ?? []) seen.add(t)
  }
  for (const r of Object.values(rooms)) {
    for (const t of r.equipment_tags ?? []) seen.add(t)
  }
  return Array.from(seen).sort()
}

// ─── localStorage migration: legacy room_type → equipment_tags ────
//
// Prior to the equipment-tag cutover, rooms were typed via `room_type`
// (e.g. "pc_lab") + `station_type` ("pc"/"mac"), and courses declared a
// `required_room_type`. A user's Path-B rooms override saved in
// localStorage may still carry those legacy fields. These helpers read
// those shapes on load, project them into equipment_tags, and strip the
// legacy keys so the app only ever sees the unified shape.

/** Subset of legacy-room fields we may still encounter in a saved override. */
type LegacyRoomShape = Partial<Room> & {
  room_type?: string
  station_type?: string
}

/** Subset of legacy-course fields we may still encounter in a saved override. */
type LegacyCourseShape = Partial<Course> & {
  required_room_type?: string
}

/** Project a legacy room's room_type / station_type / station_count into
 *  equipment_tags, preserving the matching semantics of the retired
 *  ROOM_COMPATIBILITY table. Large game labs seed a `lecture_flex` tag so
 *  lecture-flex courses still match them; ≥10-station rooms seed a `lab`
 *  tag so any-lab courses still match. */
function seedLegacyRoomTags(r: LegacyRoomShape): string[] {
  const tags = new Set<string>()
  if (r.station_type) tags.add(r.station_type)
  if (r.room_type) tags.add(r.room_type)
  if (r.room_type === "large_game_lab") tags.add("lecture_flex")
  if ((r.station_count ?? 0) >= 10) tags.add("lab")
  return Array.from(tags).sort()
}

/** Project a legacy course's required_room_type into required_equipment.
 *  Pairs with seedLegacyRoomTags so the subset check (room tags ⊇ course
 *  required) behaves the same on pre-migration saved data. */
function seedLegacyCourseEquipment(c: LegacyCourseShape): string[] {
  const rt = c.required_room_type
  if (!rt) return []
  if (rt === "any_lab") return ["lab"]
  if (rt === "standard") return []
  return [rt]
}

/** One-shot localStorage migration for a rooms map. Strips legacy
 *  `room_type` / `station_type` fields and seeds `equipment_tags` from them
 *  when absent. Idempotent — already-migrated rooms pass through. */
export function migrateRoomsEquipment(
  rooms: Record<string, LegacyRoomShape>,
): Record<string, Room> {
  const out: Record<string, Room> = {}
  for (const [id, raw] of Object.entries(rooms)) {
    const rest: Record<string, unknown> = { ...raw }
    delete rest.room_type
    delete rest.station_type
    const tags = raw.equipment_tags ?? seedLegacyRoomTags(raw)
    out[id] = { ...(rest as Room), equipment_tags: tags }
  }
  return out
}

/** One-shot localStorage migration for a catalog map. Strips the legacy
 *  `required_room_type` field and seeds `required_equipment` from it when
 *  absent. Idempotent. */
export function migrateCatalogEquipment(
  catalog: Record<string, LegacyCourseShape>,
): Record<string, Course> {
  const out: Record<string, Course> = {}
  for (const [id, raw] of Object.entries(catalog)) {
    const rest: Record<string, unknown> = { ...raw }
    delete rest.required_room_type
    const req = raw.required_equipment ?? seedLegacyCourseEquipment(raw)
    out[id] = { ...(rest as Course), required_equipment: req }
  }
  return out
}

// ─── Actions (events-up) ──────────────────────────────────────────

export interface SchedulerActions {
  /** All ID params below are offering_ids except `addOffering`, which takes a
   *  catalog_id (the thing the user dragged from the catalogue) and returns
   *  the newly-created offering_id so callers can chain pin/select. */
  selectOffering: (offering_id: string | null) => void
  addOffering: (catalog_id: string) => string | null
  removeOffering: (offering_id: string) => void
  updateOffering: (offering_id: string, changes: Partial<Offering>) => void
  pinToSlot: (offering_id: string, slot: Slot | null) => void
  setSolveMode: (mode: SolveMode) => void
  requestSolve: () => void
  requestExport: () => void
}
