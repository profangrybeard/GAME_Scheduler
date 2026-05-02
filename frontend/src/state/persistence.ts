/**
 * localStorage persistence for SchedulerState.
 *
 * Lifted out of App.tsx during the Path C mobile rebuild so the
 * SchedulerStateProvider can run the same load chain whether the
 * mobile or desktop tree is rendering. Behaviour is byte-identical
 * to the original App.tsx implementation; only the home moved.
 *
 * Portrait persistence stays in App.tsx — it's a separate concern
 * from SchedulerState and only the desktop tree currently consumes
 * it. If the mobile tree ever needs it we'll lift that too.
 */

import { loadInitialState } from "../data"
import {
  migrateCatalogEquipment,
  migrateRoomsEquipment,
  type SchedulerState,
} from "../types"
import type { Course, Professor, Room } from "../types"

/** Full-list override for professors. The saved list IS the faculty deck —
 *  each chair's roster diverges permanently (different campuses, hires,
 *  departures), so merging onto an upstream baseline is the wrong mental
 *  model. See CLAUDE.md "Path B". */
export const PROFESSORS_STORAGE_KEY = "professors"
/** Pre-Path-B overlay key. One-shot migrated on load then deleted. */
export const PROF_EDITS_LEGACY_KEY = "professor-edits"
/** Full-list override for rooms. Same Path B pattern as professors. */
export const ROOMS_STORAGE_KEY = "rooms"
/** Pre-Path-B overlay key. One-shot migrated on load then deleted. */
export const ROOM_EDITS_LEGACY_KEY = "room-edits"
/** Sparse overlay for Course edits (equipment tags, etc). Unlike rooms and
 *  professors where the full list is per-chair, the course catalog is shared
 *  baseline data; chairs only nudge a handful of entries. Stored as
 *  `{ [course_id]: Partial<Course> }` and applied to the in-memory catalog
 *  at load time. */
export const CATALOG_EDITS_KEY = "catalog-edits"

export function applyEdits<T>(
  base: Record<string, T>,
  edits: Record<string, Partial<T>>,
): Record<string, T> {
  const result = { ...base }
  for (const [id, patch] of Object.entries(edits)) {
    if (result[id]) result[id] = { ...result[id], ...patch }
  }
  return result
}

/** Return the saved full-list professors, or null if no saved list exists.
 *  If only the legacy `professor-edits` overlay is present, migrate by
 *  applying it to baseline, saving as the new format, and dropping the old
 *  key. */
export function loadProfessors(baseline: Record<string, Professor>): Professor[] | null {
  try {
    const raw = localStorage.getItem(PROFESSORS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Professor[]
    const legacy = localStorage.getItem(PROF_EDITS_LEGACY_KEY)
    if (legacy) {
      const edits = JSON.parse(legacy) as Record<string, Partial<Professor>>
      const merged = applyEdits(baseline, edits)
      const list = Object.values(merged)
      localStorage.setItem(PROFESSORS_STORAGE_KEY, JSON.stringify(list))
      localStorage.removeItem(PROF_EDITS_LEGACY_KEY)
      return list
    }
  } catch { /* corrupted */ }
  return null
}

export function saveProfessors(profs: Professor[]) {
  try { localStorage.setItem(PROFESSORS_STORAGE_KEY, JSON.stringify(profs)) } catch { /* full */ }
}

/** Return the saved full-list rooms, or null if no saved list exists.
 *  If only the legacy `room-edits` overlay is present, migrate by applying
 *  it to baseline, saving as the new format, and dropping the old key.
 *  Also runs the legacy room_type / station_type → equipment_tags
 *  cutover so a pre-cutover saved list loads cleanly. */
export function loadRooms(baseline: Record<string, Room>): Room[] | null {
  try {
    const raw = localStorage.getItem(ROOMS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
      const byId = Object.fromEntries(parsed.map(r => [r.id as string, r]))
      return Object.values(migrateRoomsEquipment(byId, baseline))
    }
    const legacy = localStorage.getItem(ROOM_EDITS_LEGACY_KEY)
    if (legacy) {
      const edits = JSON.parse(legacy) as Record<string, Partial<Room>>
      const merged = applyEdits(baseline, edits)
      const list = Object.values(merged)
      localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(list))
      localStorage.removeItem(ROOM_EDITS_LEGACY_KEY)
      return list
    }
  } catch { /* corrupted */ }
  return null
}

export function saveRooms(rooms: Room[]) {
  try { localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms)) } catch { /* full */ }
}

export function loadCatalogEdits(): Record<string, Partial<Course>> {
  try {
    const raw = localStorage.getItem(CATALOG_EDITS_KEY)
    if (raw) return JSON.parse(raw) as Record<string, Partial<Course>>
  } catch { /* corrupted */ }
  return {}
}

export function saveCatalogEdits(edits: Record<string, Partial<Course>>) {
  try { localStorage.setItem(CATALOG_EDITS_KEY, JSON.stringify(edits)) } catch { /* full */ }
}

/** Build the initial SchedulerState by loading the baseline (data/) and
 *  layering on the per-chair localStorage overrides for professors, rooms,
 *  and catalog edits. Single source of truth for both the App tree and the
 *  MobileApp tree, called once by SchedulerStateProvider's useState
 *  initializer. */
export function loadInitialSchedulerState(): SchedulerState {
  const base = loadInitialState()
  const savedProfs = loadProfessors(base.professors)
  const professors = savedProfs
    ? Object.fromEntries(savedProfs.map(p => [p.id, p]))
    : base.professors
  const savedRooms = loadRooms(base.rooms)
  const rooms = savedRooms
    ? Object.fromEntries(savedRooms.map(r => [r.id, r]))
    : base.rooms
  const catalogEdits = loadCatalogEdits()
  const catalog = migrateCatalogEquipment(applyEdits(base.catalog, catalogEdits))
  return {
    ...base,
    catalog,
    professors,
    rooms,
  }
}
