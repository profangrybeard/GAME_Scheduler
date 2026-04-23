import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  downloadBlob,
  parseDraftState,
  pingApi,
  postExportStream,
  postSolveStream,
  responseAssignmentToAssignment,
  type DraftState,
  type SolveEvent,
  type SolveModeResult,
  type SolveRequestBody,
  type ValidationError,
} from "./api"
import {
  type DraftSnapshot,
  loadDraftSnapshot,
  saveDraftSnapshot,
} from "./draftSnapshot"
import { BrandEyebrow } from "./components/BrandEyebrow"
import { CatalogueDrawer } from "./components/CatalogueDrawer"
import { ChangeLog, type ChangeLogEntry } from "./components/ChangeLog"
import { Class } from "./components/Class"
import { DataIssuesPanel } from "./components/DataIssuesPanel"
import { PortraitContext } from "./components/PortraitContext"
import { ProfessorContext } from "./components/ProfessorContext"
import { ProfessorCard } from "./components/ProfessorCard"
import { QuarterSchedule } from "./components/QuarterSchedule"
import { RoomCard } from "./components/RoomCard"
import { Roster } from "./components/Roster"
import { SolverTuning } from "./components/SolverTuning"
import { loadTunedMix, mixToSolverWeights, saveTunedMix, type Mix } from "./components/SolverMix"
import { TopbarMenu } from "./components/TopbarMenu"
import { loadInitialState } from "./data"
import { useTheme } from "./hooks/useTheme"
import { coalesceOfferingsForWire, expandOfferingsFromWire, mintOfferingId, profContractCeiling, profContractFloor } from "./types"
import type { Assignment, Offering, Professor, RosterCapacity, Room, SchedulerState, Slot, SolveMode, SolveModeProgress, SolveProgressState, WireOffering } from "./types"
import "./App.css"

/**
 * App — the state parent for the Reactive Sandbox.
 *
 * The right-side detail panel is contextual:
 *   - selectedProfId set  → ProfessorCard (player card)
 *   - selectedOfferingId set → Class (course rules)
 *   - neither → Class empty state
 *
 * Responsive layout driven by CSS media queries + a small amount of local UI
 * state for panel switching on portrait (activePanel) and the landscape
 * roster drawer (rosterDrawerOpen).
 */

const PORTRAIT_STORAGE_KEY = "portrait-overrides"
/** Full-list override for professors. The saved list IS the faculty deck —
 *  each chair's roster diverges permanently (different campuses, hires,
 *  departures), so merging onto an upstream baseline is the wrong mental
 *  model. See CLAUDE.md "Path B". */
const PROFESSORS_STORAGE_KEY = "professors"
/** Pre-Path-B overlay key. One-shot migrated on load then deleted. */
const PROF_EDITS_LEGACY_KEY = "professor-edits"
/** Full-list override for rooms. Same Path B pattern as professors. */
const ROOMS_STORAGE_KEY = "rooms"
/** Pre-Path-B overlay key. One-shot migrated on load then deleted. */
const ROOM_EDITS_LEGACY_KEY = "room-edits"


type ActivePanel = "roster" | "schedule" | "detail"

/** Display labels for the solver modes in the topbar context strip. Mirrors
 *  SolveProgress.MODE_LABELS so "Tune" reads consistently across the UI. */
const SOLVE_MODE_LABELS: Record<string, string> = {
  cover_first:     "Cover",
  time_pref_first: "Time Pref",
  balanced:        "Tune",
}

function loadPortraits(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PORTRAIT_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, string>
  } catch { /* corrupted */ }
  return {}
}

/** Return the saved full-list professors, or null if no saved list exists.
 *  If only the legacy `professor-edits` overlay is present, migrate by
 *  applying it to baseline, saving as the new format, and dropping the old
 *  key. */
function loadProfessors(baseline: Record<string, Professor>): Professor[] | null {
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

function saveProfessors(profs: Professor[]) {
  try { localStorage.setItem(PROFESSORS_STORAGE_KEY, JSON.stringify(profs)) } catch { /* full */ }
}

/** Return the saved full-list rooms, or null if no saved list exists.
 *  If only the legacy `room-edits` overlay is present, migrate by applying
 *  it to baseline, saving as the new format, and dropping the old key. */
function loadRooms(baseline: Record<string, Room>): Room[] | null {
  try {
    const raw = localStorage.getItem(ROOMS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Room[]
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

function saveRooms(rooms: Room[]) {
  try { localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms)) } catch { /* full */ }
}

function applyEdits<T>(
  base: Record<string, T>,
  edits: Record<string, Partial<T>>,
): Record<string, T> {
  const result = { ...base }
  for (const [id, patch] of Object.entries(edits)) {
    if (result[id]) result[id] = { ...result[id], ...patch }
  }
  return result
}

// "Apr 21, 2026 · 3:14 PM" — the freshness signal rendered in the resume
// rail. Split into date + time calls because toLocaleString's combined form
// uses a comma separator we don't want.
function formatLoadedTimestamp(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  return `${date} · ${time}`
}

function App() {
  const [state, setState] = useState<SchedulerState>(() => {
    const base = loadInitialState()
    const savedProfs = loadProfessors(base.professors)
    const professors = savedProfs
      ? Object.fromEntries(savedProfs.map(p => [p.id, p]))
      : base.professors
    const savedRooms = loadRooms(base.rooms)
    const rooms = savedRooms
      ? Object.fromEntries(savedRooms.map(r => [r.id, r]))
      : base.rooms
    return {
      ...base,
      professors,
      rooms,
    }
  })
  const { theme, resolved, cycle: cycleTheme } = useTheme()
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [selectedProfId, setSelectedProfId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [portraits, setPortraits] = useState<Record<string, string>>(loadPortraits)

  // ── Solver / API state ─────────────────────────────────────────
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null)
  const [solveError, setSolveError] = useState<string | null>(null)
  // Weight-tuning modal + the tuned mix that replaces MODE_WEIGHTS["balanced"]
  // in the solver request. The mix lives in localStorage (Path B); App.tsx
  // mirrors it in state so the SolveRequestBody re-renders on changes.
  const [tuningOpen, setTuningOpen] = useState(false)
  const [tunedMix, setTunedMix] = useState<Mix>(() => loadTunedMix())
  // Cache of all three solve modes from the last /api/solve/stream, so
  // flipping the solveMode chip re-applies without re-running the solver.
  const modeResultsRef = useRef<Record<string, SolveModeResult> | null>(null)

  // Live per-mode progress during a streaming solve. Starts null between
  // solves. Populated by postSolveStream via the onEvent callback.
  const [solveProgress, setSolveProgress] = useState<SolveProgressState | null>(null)
  const solveAbortRef = useRef<AbortController | null>(null)

  // Two-stage Empty Calendar. Stage 1 = drop solver assignments, keep user
  // pins; if any pins survive, we arm. Stage 2 = also drop pins. Any new
  // solve disarms so the button starts fresh.
  const [clearArmed, setClearArmed] = useState(false)

  // ── Resume from Excel state ────────────────────────────────────
  // Structured validation errors from /api/state/parse. Each entry carries
  // sheet / row / column / reason / severity — the Data Issues panel
  // (phase 3) lists them clickable; today the reload banner renders reasons.
  const [reloadErrors, setReloadErrors] = useState<ValidationError[] | null>(null)
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [reloadFilename, setReloadFilename] = useState<string | null>(null)
  const [exportChaseKey, setExportChaseKey] = useState(0)
  // Phase 1.3 fallback: when a structural parse fails, check localStorage
  // for a last-known-good snapshot of this filename and offer one-click
  // restore in the error banner. Null = no snapshot available / banner
  // shouldn't offer recovery.
  const [reloadSnapshot, setReloadSnapshot] = useState<DraftSnapshot | null>(null)
  // Tracks whether the current hydrated state came from a snapshot restore
  // (true) vs a fresh parse (false). Drives the success-banner copy so we
  // don't claim "Loaded draft from X.xlsx" when the user actually restored
  // from last-saved snapshot because X.xlsx was broken.
  const [reloadFromSnapshot, setReloadFromSnapshot] = useState(false)
  // Workbook's last-modified epoch ms, read from the File object at load
  // time. Shown next to the topbar Resume button so the user can tell at a
  // glance how fresh the file they're editing actually is.
  const [reloadMtime, setReloadMtime] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── Responsive UI state ──────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<ActivePanel>("schedule")
  const [rosterDrawerOpen, setRosterDrawerOpen] = useState(false)
  const [placingId, setPlacingId] = useState<string | null>(null)

  // ── Change log (tiny bottom-left chip) ──────────────────────────
  // In-memory only; resets on refresh. Capped to the last 20 entries so
  // the list scan stays O(1)-small even in a long editing session.
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([])
  const logIdRef = useRef(0)
  const logChange = useCallback((type: string, text: string) => {
    logIdRef.current += 1
    const entry: ChangeLogEntry = { id: logIdRef.current, ts: Date.now(), type, text }
    setChangeLog(log => [entry, ...log].slice(0, 20))
  }, [])
  const clearChangeLog = useCallback(() => setChangeLog([]), [])

  const openCatalogue = useCallback(() => setCatalogueOpen(true), [])
  const closeCatalogue = useCallback(() => setCatalogueOpen(false), [])
  const openRosterDrawer = useCallback(() => setRosterDrawerOpen(true), [])
  const closeRosterDrawer = useCallback(() => setRosterDrawerOpen(false), [])

  // ── Actions ────────────────────────────────────────────────────────

  const selectOffering = useCallback((id: string | null) => {
    setState(s => ({ ...s, selectedOfferingId: id }))
    setSelectedProfId(null)
    setSelectedRoomId(null)
    if (id) setActivePanel("detail")
  }, [])

  const selectProfessor = useCallback((id: string | null) => {
    setSelectedProfId(id)
    setSelectedRoomId(null)
    if (id) {
      setState(s => ({ ...s, selectedOfferingId: null }))
      setActivePanel("detail")
    }
  }, [])

  const selectRoom = useCallback((id: string | null) => {
    setSelectedRoomId(id)
    setSelectedProfId(null)
    if (id) {
      setState(s => ({ ...s, selectedOfferingId: null }))
      setActivePanel("detail")
    }
  }, [])

  /** Set the active quarter label. The current catalog/offerings stay put —
   *  switching quarters is a label change the user is making in-place, not a
   *  data swap. The field still flows into exports + resume round-trips, so a
   *  re-saved XLSX carries the chosen quarter forward. */
  const setQuarter = useCallback((quarter: string) => {
    setState(s => (s.quarter === quarter ? s : { ...s, quarter }))
  }, [])

  /** Add an offering for `catalog_id` or select the first existing sibling.
   *  Used by the Catalogue drawer and the calendar's DnD-from-catalogue flow;
   *  both want "one click = one row in the Roster", not "one click = new
   *  sibling every time". Use `addSectionOffering` instead to explicitly grow
   *  the sibling count (the Roster's per-card + button).
   *
   *  Returns the resulting offering_id (new or existing) so the DnD flow can
   *  chain `pinToSlot(newId, slot)` without waiting for a re-render. */
  const addOffering = useCallback((catalog_id: string): string | null => {
    let resultId: string | null = null
    setState(s => {
      if (!s.catalog[catalog_id]) return s
      const existing = s.offerings.find(o => o.catalog_id === catalog_id)
      if (existing) {
        resultId = existing.offering_id
        return { ...s, selectedOfferingId: existing.offering_id }
      }
      const newId = mintOfferingId(catalog_id, s.offerings)
      resultId = newId
      const fresh: Offering = {
        offering_id: newId,
        catalog_id,
        priority: "should_have",
        sections: 1,
        override_enrollment_cap: null,
        override_room_type: null,
        override_preferred_professors: null,
        notes: null,
        assigned_prof_id: null,
        assigned_room_id: null,
        pinned: null,
        assignment: null,
      }
      return {
        ...s,
        offerings: [...s.offerings, fresh],
        selectedOfferingId: newId,
      }
    })
    setSelectedProfId(null)
    return resultId
  }, [])

  const removeOffering = useCallback((offering_id: string) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.filter(o => o.offering_id !== offering_id),
      selectedOfferingId:
        s.selectedOfferingId === offering_id ? null : s.selectedOfferingId,
    }))
  }, [])

  /** Add another sibling (section) for `catalog_id`. Unlike `addOffering`
   *  (which de-dupes to one offering per catalog), this always mints a fresh
   *  offering_id so the Roster's + button grows the roster card-by-card. The
   *  new sibling copies priority/override fields from the existing first
   *  sibling — adding a second section shouldn't reset the chair's settings. */
  const addSectionOffering = useCallback((catalog_id: string) => {
    setState(s => {
      if (!s.catalog[catalog_id]) return s
      const template = s.offerings.find(o => o.catalog_id === catalog_id)
      const fresh: Offering = {
        offering_id: mintOfferingId(catalog_id, s.offerings),
        catalog_id,
        priority: template?.priority ?? "should_have",
        sections: 1,
        override_enrollment_cap: template?.override_enrollment_cap ?? null,
        override_room_type: template?.override_room_type ?? null,
        override_preferred_professors:
          template?.override_preferred_professors ?? null,
        notes: template?.notes ?? null,
        assigned_prof_id: null,
        assigned_room_id: null,
        pinned: null,
        assignment: null,
      }
      return { ...s, offerings: [...s.offerings, fresh] }
    })
  }, [])

  const updateOffering = useCallback(
    (offering_id: string, changes: Partial<Offering>) => {
      setState(s => ({
        ...s,
        offerings: s.offerings.map(o =>
          o.offering_id === offering_id ? { ...o, ...changes } : o,
        ),
      }))
    },
    [],
  )

  const updateProfessor = useCallback(
    (prof_id: string, changes: Partial<Professor>) => {
      setState(s => {
        const next = {
          ...s.professors,
          [prof_id]: { ...s.professors[prof_id], ...changes },
        }
        saveProfessors(Object.values(next))
        return { ...s, professors: next }
      })
    },
    [],
  )

  const addProfessor = useCallback(() => {
    // Timestamp-suffix id avoids collision across rapid clicks without
    // threading a counter through setState's updater (which must stay pure).
    const newId = `prof_${Date.now().toString(36)}`
    const fresh: Professor = {
      id: newId,
      name: "New Professor",
      home_department: "game",
      teaching_departments: ["game"],
      chairs: [],
      is_chair: false,
      max_classes: 3,
      can_overload: false,
      has_masters: false,
      masters_in_progress: false,
      time_preference: "morning",
      available_quarters: ["fall", "winter", "spring"],
      specializations: [],
    }
    setState(s => {
      const next = { ...s.professors, [newId]: fresh }
      saveProfessors(Object.values(next))
      return { ...s, professors: next, selectedOfferingId: null }
    })
    setSelectedRoomId(null)
    setSelectedProfId(newId)
    setActivePanel("detail")
  }, [])

  const removeProfessor = useCallback((prof_id: string) => {
    setState(s => {
      const next = { ...s.professors }
      delete next[prof_id]
      saveProfessors(Object.values(next))
      return { ...s, professors: next }
    })
    setSelectedProfId(prev => (prev === prof_id ? null : prev))
  }, [])

  const clearProfessors = useCallback(() => {
    setState(s => {
      saveProfessors([])
      return { ...s, professors: {} }
    })
    setSelectedProfId(null)
  }, [])

  const updateRoom = useCallback(
    (room_id: string, changes: Partial<Room>) => {
      setState(s => {
        const next = {
          ...s.rooms,
          [room_id]: { ...s.rooms[room_id], ...changes },
        }
        saveRooms(Object.values(next))
        return { ...s, rooms: next }
      })
    },
    [],
  )

  const addRoom = useCallback(() => {
    // Timestamp-suffix id avoids collision across rapid clicks without
    // threading a counter through setState's updater (which must stay pure).
    const newId = `room_${Date.now().toString(36)}`
    const fresh: Room = {
      id: newId,
      name: "New Room",
      building: "",
      room_type: "pc_lab",
      station_count: 20,
      station_type: "pc",
      display_count: 1,
      capacity: 20,
    }
    setState(s => {
      const next = { ...s.rooms, [newId]: fresh }
      saveRooms(Object.values(next))
      return { ...s, rooms: next, selectedOfferingId: null }
    })
    setSelectedProfId(null)
    setSelectedRoomId(newId)
    setActivePanel("detail")
  }, [])

  const removeRoom = useCallback((room_id: string) => {
    setState(s => {
      const next = { ...s.rooms }
      delete next[room_id]
      saveRooms(Object.values(next))
      return { ...s, rooms: next }
    })
    setSelectedRoomId(prev => (prev === room_id ? null : prev))
  }, [])

  const clearRooms = useCallback(() => {
    setState(s => {
      saveRooms([])
      return { ...s, rooms: {} }
    })
    setSelectedRoomId(null)
  }, [])

  // User DnD always overrides solver output. Clearing `assignment` alongside
  // `pinned` is what actually makes the card move (or leave) visually — the
  // calendar's effectiveSlot is `assignment ?? pinned`, so a stale assignment
  // would silently win and the drop would look like it did nothing.
  const pinToSlot = useCallback((offering_id: string, slot: Slot | null) => {
    const cid = state.offerings.find(o => o.offering_id === offering_id)?.catalog_id
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.offering_id === offering_id
          ? { ...o, pinned: slot, assignment: null }
          : o,
      ),
    }))
    if (cid) {
      if (slot) {
        const day = slot.day_group === 1 ? "MW" : slot.day_group === 2 ? "TTh" : "F"
        logChange("pin", `${cid} → ${day} ${slot.time_slot}`)
      } else {
        logChange("unpin", cid)
      }
    }
    setPlacingId(null)
  }, [state.offerings, logChange])

  /** Apply a mode's assignments to the offerings list. Assignments not present
   *  in the mode clear `offering.assignment` — the user sees only the current
   *  mode's schedule, not a stale one.
   *
   *  Multi-section: the backend emits one assignment per (catalog_id,
   *  section_idx); sibling offering_ids follow the `${catalog_id}#${k}`
   *  convention with k = section_idx + 1. Keying the map by offering_id
   *  routes each assignment to its matching sibling. */
  const applyModeAssignments = useCallback(
    (mode: SolveModeResult | undefined) => {
      if (!mode) return
      const byOfferingId: Record<string, Assignment> = {}
      for (const a of mode.assignments) {
        const oid = `${a.catalog_id}#${(a.section_idx ?? 0) + 1}`
        byOfferingId[oid] = responseAssignmentToAssignment(a)
      }
      setState(s => ({
        ...s,
        offerings: s.offerings.map(o => ({
          ...o,
          assignment: byOfferingId[o.offering_id] ?? null,
        })),
      }))
    },
    [],
  )

  const setSolveMode = useCallback(
    (mode: SolveMode) => {
      setState(s => ({ ...s, solveMode: mode }))
      // Re-apply from the cached solve result so flipping modes doesn't require
      // a new round-trip. If we haven't solved yet, there's nothing to apply.
      const cached = modeResultsRef.current?.[mode]
      if (cached) applyModeAssignments(cached)
      logChange("mode", SOLVE_MODE_LABELS[mode] ?? mode)
    },
    [applyModeAssignments, logChange],
  )

  const emptyCalendar = useCallback(() => {
    setState(s => {
      // Stage 2: armed click clears pins too and disarms.
      // Stage 1: clear assignments only; arm iff any pin survives.
      const clearPins = clearArmed
      const nextOfferings = s.offerings.map(o => ({
        ...o,
        assignment: null,
        pinned: clearPins ? null : o.pinned,
      }))
      const anyPinned = nextOfferings.some(o => o.pinned !== null)
      setClearArmed(!clearPins && anyPinned)
      return { ...s, offerings: nextOfferings, solveStatus: "idle" }
    })
    modeResultsRef.current = null
    setSolveProgress(null)
    setSolveError(null)
  }, [clearArmed])

  /** Build the solve request. Accepts an optional tuned-weights override so
   *  the "Try it on current schedule" button can solve with a freshly-set mix
   *  in the same tick (useState batches; reading tunedMix here would see the
   *  prior value).
   *
   *  Offerings are coalesced back to the single-row-per-catalog_id wire shape
   *  (sibling #1's fields + `sections: N`) so the backend sees the same schema
   *  it always has. See types.ts::coalesceOfferingsForWire for the contract.
   *  The type cast is safe: `WireOffering` is `Offering` minus two runtime
   *  fields the backend's Pydantic `OfferingModel` already ignores. */
  const buildSolveRequest = useCallback((overrideMix?: Mix): SolveRequestBody => ({
    quarter:      state.quarter,
    year:         state.year,
    solveMode:    state.solveMode,
    offerings:    coalesceOfferingsForWire(state.offerings) as unknown as Offering[],
    professors:   Object.values(state.professors),
    rooms:        Object.values(state.rooms),
    tunedWeights: mixToSolverWeights(overrideMix ?? tunedMix),
  }), [state.quarter, state.year, state.solveMode, state.offerings, state.professors, state.rooms, tunedMix])

  /** Reduce one SSE event into the SolveProgressState. Pure, so we can run
   *  it inside setSolveProgress's callback without stale-closure bugs. */
  const applyProgressEvent = useCallback(
    (prev: SolveProgressState | null, event: SolveEvent): SolveProgressState => {
      const base: SolveProgressState = prev ?? {
        startedAt:    performance.now(),
        endedAt:      null,
        totalModes:   null,
        modes:        {},
        errorMessage: null,
      }

      const patchMode = (
        key: string,
        patch: Partial<SolveModeProgress>,
      ): SolveProgressState => {
        const existing: SolveModeProgress = base.modes[key] ?? {
          mode:             key,
          state:            "waiting",
          index:            null,
          solutionsFound:   0,
          bestObjective:    null,
          bestBound:        null,
          nPlaced:          null,
          nTotal:           null,
          elapsedMs:        null,
          status:           null,
          unscheduledCount: null,
        }
        return { ...base, modes: { ...base.modes, [key]: { ...existing, ...patch } } }
      }

      switch (event.type) {
        case "solve_started":
          return { ...base, startedAt: performance.now() }

        case "mode_started":
          return patchMode(event.mode, {
            state: "running",
            index: event.index,
          })

        case "solution_found":
          return patchMode(event.mode, {
            solutionsFound: event.solution_index,
            bestObjective:  event.objective,
            bestBound:      event.best_bound,
            nPlaced:        event.n_placed,
            nTotal:         event.n_total,
            elapsedMs:      event.elapsed_ms,
          })

        case "mode_complete":
          return patchMode(event.mode, {
            state:            "done",
            status:           event.status,
            bestObjective:    event.objective,
            nPlaced:          event.n_placed,
            nTotal:           event.n_total,
            elapsedMs:        event.elapsed_ms,
            unscheduledCount: event.unscheduled_count,
          })

        case "solve_complete":
          // For Generate (no phase set), solve_complete IS the end —
          // freeze the elapsed timer. For Export (phase set in flight),
          // there's still xlsx writing to come; let export_complete freeze
          // it, otherwise the elapsed counter stops mid-flow.
          if (base.phase) return base
          return { ...base, endedAt: performance.now() }

        case "xlsx_writing":
          // Solve done, XLSX serialization in flight. Title flips to
          // "Writing Excel…" via the phase field; mode cards stay visible.
          return { ...base, phase: "writing" }

        case "export_complete":
          // Terminal for the export flow. Freeze elapsed now.
          return { ...base, endedAt: performance.now(), phase: "exported" }

        case "error":
          return { ...base, endedAt: performance.now(), errorMessage: event.message }
      }
      return base
    },
    [],
  )

  /** Trigger a streaming solve. `overrideMix` lets a caller (e.g. the Tune
   *  modal's "Try it" button) plug in a freshly-set mix without waiting for
   *  the next render — useState batches, so reading tunedMix from closure
   *  here would see the prior value. `displayMode` selects which mode's
   *  result the calendar flips to on completion. */
  const requestSolve = useCallback(async (overrideMix?: Mix, displayMode?: SolveMode) => {
    // Cancel any in-flight solve if the user re-presses. Don't await — the
    // stream reader will throw AbortError which we swallow below.
    solveAbortRef.current?.abort()
    const controller = new AbortController()
    solveAbortRef.current = controller

    // If tap-to-place armed a card (touch only), stand down before running.
    // The grid's `.schedule-grid--placing` overlay would otherwise dim the
    // freshly-solved cards, making it look like Generate produced nothing.
    setPlacingId(null)
    setSolveError(null)
    setClearArmed(false)
    setState(s => ({ ...s, solveStatus: "running" }))
    setSolveProgress({
      startedAt:    performance.now(),
      endedAt:      null,
      totalModes:   null,
      modes:        {},
      errorMessage: null,
    })

    try {
      const res = await postSolveStream(
        buildSolveRequest(overrideMix),
        (event) => {
          setSolveProgress(prev => {
            const next = applyProgressEvent(prev, event)
            // Lift `totalModes` onto state when mode_started first reports it.
            if (event.type === "mode_started" && next.totalModes === null) {
              return { ...next, totalModes: event.total }
            }
            return next
          })
        },
        controller.signal,
      )
      const byMode: Record<string, SolveModeResult> = {}
      for (const m of res.modes) byMode[m.mode] = m
      modeResultsRef.current = byMode
      const targetMode = displayMode ?? state.solveMode
      applyModeAssignments(byMode[targetMode] ?? res.modes[0])
      setState(s => ({
        ...s,
        solveStatus: "done",
        solveMode:   displayMode ?? s.solveMode,
      }))
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return
      const msg = e instanceof Error ? e.message : String(e)
      if (import.meta.env.DEV) console.error("[solve] error:", msg)
      setSolveError(msg)
      setState(s => ({ ...s, solveStatus: "error" }))
      setSolveProgress(prev =>
        prev ? { ...prev, endedAt: performance.now(), errorMessage: msg } : prev,
      )
    }
  }, [buildSolveRequest, applyModeAssignments, applyProgressEvent, state.solveMode])

  /** Hook the tuning modal's "Try it on current schedule" button to a fresh
   *  solve. Persists the new mix, flips the calendar to the balanced (Tune)
   *  result, and kicks off the solve in the same tick. */
  const handleApplyTunedMix = useCallback((nextMix: Mix) => {
    setTunedMix(nextMix)
    void requestSolve(nextMix, "balanced")
    logChange(
      "tune",
      `cov ${nextMix.coverage} · time ${nextMix.time} · overload ${nextMix.overload}`,
    )
  }, [requestSolve, logChange])

  const requestExport = useCallback(async () => {
    // Cancel any in-flight stream if the user re-presses Export.
    solveAbortRef.current?.abort()
    const controller = new AbortController()
    solveAbortRef.current = controller

    setSolveError(null)
    // Same SolveProgress UI Generate uses — phase field swaps the title to
    // "Writing Excel…" once the xlsx_writing event fires.
    setSolveProgress({
      startedAt:    performance.now(),
      endedAt:      null,
      totalModes:   null,
      modes:        {},
      errorMessage: null,
      phase:        "solving",
    })

    try {
      const { blob, filename } = await postExportStream(
        buildSolveRequest(),
        event => setSolveProgress(prev => applyProgressEvent(prev, event)),
        controller.signal,
      )
      downloadBlob(blob, filename)
    } catch (e) {
      // AbortError fires if the user clicked Export again before this one
      // finished — no need to surface it as a real failure.
      if ((e as Error)?.name === "AbortError") return
      const msg = e instanceof Error ? e.message : String(e)
      if (import.meta.env.DEV) console.error("[export] error:", msg)
      setSolveError(msg)
      setSolveProgress(prev => prev ? { ...prev, endedAt: performance.now(), errorMessage: msg } : null)
    }
  }, [buildSolveRequest, applyProgressEvent])

  // ── Resume from Excel ─────────────────────────────────────────────

  const triggerReloadPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  /** Apply a parsed draft state to all the UI's mutable surfaces: offerings,
   *  professors/rooms decks, tuned weights, cached mode results, and the
   *  synthesized "done" progress strip. Pure side-effects — no return value,
   *  no banner copy. Reused by both the parse-success path (handleReloadFile)
   *  and the snapshot-restore path (restoreFromSnapshot). */
  const hydrateFromDraft = useCallback((draft: DraftState): void => {
    // Cache all modes from the embedded results so flipping the solveMode
    // chip post-reload re-applies without a fresh solve. Each mode's
    // schedule entries already carry catalog_id/prof_id/room_id/day_group/
    // time_slot, which is exactly what responseAssignmentToAssignment reads.
    const cachedModes: Record<string, SolveModeResult> = {}
    if (draft.solver_results) {
      for (const m of draft.solver_results.modes) {
        cachedModes[m.mode] = m
      }
      modeResultsRef.current = cachedModes
    } else {
      modeResultsRef.current = null
    }

    // Synthesize a "done" SolveProgressState from the cached modes so the
    // solve-progress strip renders on resume — otherwise the three cached
    // results have no UI surface (can't flip modes, can't re-tune). Missing
    // metrics (elapsedMs, solutionsFound) weren't persisted with the draft;
    // the progress component shows "—" for those gracefully.
    const modeOrder = ["cover_first", "balanced", "time_pref_first"] as const
    const synthesizedProgress: SolveProgressState | null = draft.solver_results
      ? {
          startedAt:    null,
          endedAt:      null,
          totalModes:   draft.solver_results.modes.length,
          modes: Object.fromEntries(
            draft.solver_results.modes.map((m): [string, SolveModeProgress] => {
              const idx = modeOrder.indexOf(m.mode as typeof modeOrder[number])
              // Older exports (example-schedule.xlsx, pre-v1 drafts) only
              // persist mode + assignments; default the rest so the strip
              // still renders instead of crashing on missing fields.
              const placed = m.assignments?.length ?? 0
              const unsched = m.unscheduled?.length ?? 0
              return [m.mode, {
                mode:             m.mode,
                state:            "done",
                index:            idx >= 0 ? idx + 1 : null,
                solutionsFound:   0,
                bestObjective:    m.objective ?? null,
                bestBound:        null,
                nPlaced:          placed,
                nTotal:           placed + unsched,
                elapsedMs:        null,
                status:           m.status ?? null,
                unscheduledCount: unsched,
              }]
            }),
          ),
          errorMessage: null,
        }
      : null

    // Build per-offering assignment map for the active mode (so the
    // calendar populates immediately without a second reducer pass).
    // Sibling offering_ids follow `${catalog_id}#${section_idx + 1}`.
    const activeMode = cachedModes[draft.solver_mode]
    const byOfferingId: Record<string, Assignment> = {}
    if (activeMode) {
      for (const a of activeMode.assignments ?? []) {
        const oid = `${a.catalog_id}#${(a.section_idx ?? 0) + 1}`
        byOfferingId[oid] = responseAssignmentToAssignment(a)
      }
    }

    // Wire → runtime: a wire entry with sections=N expands into N siblings
    // with sections=1 each. offering_id is runtime-only (see data.ts).
    const wireOfferings: WireOffering[] = draft.offerings.map(o => ({
      catalog_id:                    o.catalog_id,
      priority:                      o.priority,
      sections:                      o.sections ?? 1,
      override_enrollment_cap:       o.override_enrollment_cap ?? null,
      override_room_type:            o.override_room_type ?? null,
      override_preferred_professors: o.override_preferred_professors ?? null,
      notes:                         o.notes ?? null,
      assigned_prof_id:              o.assigned_prof_id ?? null,
      assigned_room_id:              o.assigned_room_id ?? null,
      pinned:                        o.pinned ?? null,
    }))
    const expanded = expandOfferingsFromWire(wireOfferings).map(o => ({
      ...o,
      assignment: byOfferingId[o.offering_id] ?? null,
    }))
    // Professors/rooms from the xlsx replace the current deck (Path B —
    // the exporting workspace's deck IS the truth). Also persist to
    // localStorage so the edits survive a refresh, just like in-session
    // edits do.
    const nextProfessors = draft.professors
      ? Object.fromEntries(draft.professors.map(p => [p.id, p]))
      : null
    const nextRooms = draft.rooms
      ? Object.fromEntries(draft.rooms.map(r => [r.id, r]))
      : null

    setState(s => ({
      ...s,
      selectedOfferingId: null,
      quarter:    draft.quarter,
      year:       draft.year,
      solveMode:  draft.solver_mode,
      // With cached modes, the schedule is semantically already solved —
      // mark "done" so Export stays enabled and the progress strip doesn't
      // claim a fresh solve is needed.
      solveStatus: synthesizedProgress ? "done" : "idle",
      offerings: expanded,
      professors: nextProfessors ?? s.professors,
      rooms:      nextRooms      ?? s.rooms,
    }))
    if (draft.professors) saveProfessors(draft.professors)
    if (draft.rooms)      saveRooms(draft.rooms)

    // Tuned weights: the xlsx carries solver-shape (time_pref); remap to
    // the Mix's `time` field and persist via the same helper the Tune
    // modal uses so both sources write to the same localStorage key.
    if (draft.tunedWeights) {
      const mix: Mix = {
        coverage: draft.tunedWeights.coverage,
        time:     draft.tunedWeights.time_pref,
        overload: draft.tunedWeights.overload,
      }
      setTunedMix(mix)
      saveTunedMix(mix)
    }

    setSolveProgress(synthesizedProgress)
    setSolveError(null)
  }, [])

  const handleReloadFile = useCallback(async (file: File) => {
    setReloadError(null)
    setReloadErrors(null)
    setReloadFilename(null)
    setReloadMtime(null)
    setReloadSnapshot(null)
    setReloadFromSnapshot(false)
    try {
      const { state: draft, errors } = await parseDraftState(file)
      hydrateFromDraft(draft)
      setReloadErrors(errors)
      setReloadFilename(file.name)
      setReloadMtime(file.lastModified || null)
      logChange("resume", file.name)
      // Stash a last-known-good snapshot for this filename so a future
      // reload with a corrupted `_data_*` can recover via the banner's
      // "Use last-saved snapshot" button.
      saveDraftSnapshot(file.name, draft)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (import.meta.env.DEV) console.error("[reload] error:", msg)
      setReloadError(msg)
      setReloadFilename(file.name)
      // Offer snapshot restore if we have one for this filename — this is
      // the phase 1.3 "fall back to last-known-good" behaviour. The user
      // decides; we don't auto-restore silently (would mask the fact that
      // their actual file is broken).
      const snap = loadDraftSnapshot(file.name)
      if (snap) setReloadSnapshot(snap)
    }
  }, [hydrateFromDraft])

  const restoreFromSnapshot = useCallback(() => {
    if (!reloadSnapshot || !reloadFilename) return
    hydrateFromDraft(reloadSnapshot.state)
    setReloadError(null)
    setReloadErrors([])
    // Use the snapshot's savedAt as the "loaded at" time in the sidebar —
    // that's when this data was actually fresh, which is the honest signal.
    setReloadMtime(reloadSnapshot.savedAt)
    setReloadSnapshot(null)
    setReloadFromSnapshot(true)
    logChange("resume_snapshot", reloadFilename)
  }, [reloadSnapshot, reloadFilename, hydrateFromDraft])

  const dismissReloadBanner = useCallback(() => {
    setReloadErrors(null)
    setReloadError(null)
    setReloadFilename(null)
    setReloadMtime(null)
    setReloadSnapshot(null)
    setReloadFromSnapshot(false)
  }, [])

  // ── Placement mode (tap-to-place alternative to DnD) ────────────

  /** Tap-to-place exists for touch devices that can't HTML5-drag. On hover-
   *  capable devices (desktop/laptop) we short-circuit so "click a class to
   *  inspect it" doesn't also arm placement — that double-duty meant the
   *  next click anywhere was silently re-pinning the selected card. See
   *  CLAUDE.md "Rule 4: Tap-to-Place Coexists with DnD". */
  const startPlacing = useCallback((id: string) => {
    if (typeof window !== "undefined" &&
        window.matchMedia("(hover: hover)").matches) {
      return
    }
    setPlacingId(prev => (prev === id ? null : id))
  }, [])

  const cancelPlacing = useCallback(() => setPlacingId(null), [])

  // ── Portrait management ───────────────────────────────────────────

  const handlePortraitChange = useCallback(
    (prof_id: string, dataUrl: string | null) => {
      setPortraits(prev => {
        const next = { ...prev }
        if (dataUrl) {
          next[prof_id] = dataUrl
        } else {
          delete next[prof_id]
        }
        try { localStorage.setItem(PORTRAIT_STORAGE_KEY, JSON.stringify(next)) } catch { /* full */ }
        return next
      })
    },
    [],
  )

  // Close the roster drawer when resizing up to desktop
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const handler = () => { if (mq.matches) setRosterDrawerOpen(false) }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Probe the solver backend on mount. Short timeout so the GH Pages preview
  // doesn't feel laggy when nothing is listening.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    pingApi(controller.signal).then(ok => {
      setApiAvailable(ok)
    }).catch(() => setApiAvailable(false))
    return () => { clearTimeout(timer); controller.abort() }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────

  const rosterCapacity = useMemo<RosterCapacity>(() => {
    let floorTotal = 0
    let ceilingTotal = 0
    for (const p of Object.values(state.professors)) {
      floorTotal += profContractFloor(p)
      ceilingTotal += profContractCeiling(p)
    }
    // Count sections, not offering rows — matches the solver's unit
    // (one offering with sections=2 is two placements to schedule).
    let loaded = 0
    for (const o of state.offerings) loaded += o.sections
    return { floorTotal, ceilingTotal, loaded }
  }, [state.professors, state.offerings])
  const selectedProf = selectedProfId ? state.professors[selectedProfId] : null
  const selectedRoom = selectedRoomId ? state.rooms[selectedRoomId] : null
  const placingOffering = placingId
    ? state.offerings.find(o => o.offering_id === placingId)
    : null
  const placingCourse = placingOffering
    ? state.catalog[placingOffering.catalog_id]
    : null

  const rosterPanel = (
    <Roster
      offerings={state.offerings}
      catalog={state.catalog}
      professors={state.professors}
      rooms={state.rooms}
      capacity={rosterCapacity}
      selectedOfferingId={state.selectedOfferingId}
      selectedProfId={selectedProfId}
      selectedRoomId={selectedRoomId}
      placingId={placingId}
      onSelect={selectOffering}
      onSelectProfessor={selectProfessor}
      onSelectRoom={selectRoom}
      onRemove={removeOffering}
      onAddSectionOffering={addSectionOffering}
      onOpenCatalogue={openCatalogue}
      onStartPlacing={startPlacing}
      onUnpinToRoster={id => pinToSlot(id, null)}
      onAddProfessor={addProfessor}
      onClearProfessors={clearProfessors}
      onAddRoom={addRoom}
      onClearRooms={clearRooms}
    />
  )

  const schedulePanel = (
    <QuarterSchedule
      offerings={state.offerings}
      selectedOfferingId={state.selectedOfferingId}
      catalog={state.catalog}
      professors={state.professors}
      rooms={state.rooms}
      quarter={state.quarter}
      solveStatus={state.solveStatus}
      solveMode={state.solveMode}
      placingId={placingId}
      apiAvailable={apiAvailable}
      solveError={solveError}
      solveProgress={solveProgress}
      onSelect={selectOffering}
      onSelectProfessor={selectProfessor}
      onAdd={addOffering}
      onPinToSlot={pinToSlot}
      onSetSolveMode={setSolveMode}
      onSetQuarter={setQuarter}
      onSolve={() => { void requestSolve() }}
      onEmptyCalendar={emptyCalendar}
      clearArmed={clearArmed}
      onStartPlacing={startPlacing}
      onDismissError={() => setSolveError(null)}
      onDismissProgress={() => setSolveProgress(null)}
      onOpenTuning={() => setTuningOpen(true)}
    />
  )

  const detailPanel = selectedRoom ? (
    <RoomCard
      room={selectedRoom}
      onUpdate={updateRoom}
      onDelete={removeRoom}
      onClose={() => setSelectedRoomId(null)}
    />
  ) : selectedProf ? (
    <ProfessorCard
      professor={selectedProf}
      onUpdate={updateProfessor}
      onDelete={removeProfessor}
      onPortraitChange={handlePortraitChange}
      portraitUrl={portraits[selectedProf.id] ?? null}
      onClose={() => setSelectedProfId(null)}
    />
  ) : (
    <Class
      selectedOfferingId={state.selectedOfferingId}
      offerings={state.offerings}
      catalog={state.catalog}
      professors={state.professors}
      rooms={state.rooms}
      onUpdate={updateOffering}
      onRemove={removeOffering}
      onSelectProfessor={selectProfessor}
    />
  )

  return (
    <PortraitContext.Provider value={portraits}>
     <ProfessorContext.Provider value={state.professors}>
      <div className="scheduler">
        <div className="scheduler__body">
        {placingOffering && placingCourse && (
          <div className="placement-banner placement-banner--visible">
            <span>
              Tap a cell to place <strong>{placingCourse.id}</strong>.
            </span>
            <button
              type="button"
              className="placement-banner__cancel"
              onClick={cancelPlacing}
            >
              Cancel
            </button>
          </div>
        )}
        {(reloadError || reloadErrors) && (
          <div
            className={
              "reload-banner" +
              (reloadError ? " reload-banner--error" : " reload-banner--success")
            }
            role="status"
            aria-live="polite"
          >
            <div className="reload-banner__body">
              {reloadError ? (
                <>
                  <strong>Couldn't load that file: {reloadError}</strong>
                  {reloadSnapshot && (
                    <div className="reload-banner__snapshot">
                      <span>
                        A last-saved snapshot from{" "}
                        {formatLoadedTimestamp(reloadSnapshot.savedAt)} is available.
                      </span>
                      <button
                        type="button"
                        className="reload-banner__snapshot-btn"
                        onClick={restoreFromSnapshot}
                      >
                        Use last-saved snapshot
                      </button>
                    </div>
                  )}
                </>
              ) : reloadFromSnapshot ? (
                <strong>
                  Restored from last-saved snapshot
                  {reloadMtime !== null
                    ? ` (${formatLoadedTimestamp(reloadMtime)})`
                    : ""}
                </strong>
              ) : (
                <>
                  <strong>
                    Loaded draft{reloadFilename ? ` from ${reloadFilename}` : ""}
                  </strong>
                  {reloadErrors && reloadErrors.length > 0 && (
                    <span className="reload-banner__issues">
                      {" — "}
                      {reloadErrors.length} data issue{reloadErrors.length === 1 ? "" : "s"}
                      {" (see "}
                      <span className="reload-banner__issues-pointer">!</span>
                      {" in the topbar)"}
                    </span>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              className="reload-banner__dismiss"
              onClick={dismissReloadBanner}
              aria-label="Dismiss reload notice"
            >
              ×
            </button>
          </div>
        )}
        <header className="scheduler__topbar">
          <div className="scheduler__topbar-left">
            <button
              type="button"
              className="topbar-hamburger"
              onClick={openRosterDrawer}
              aria-label="Open roster"
            >
              ☰
            </button>
            <div className="scheduler__title-group">
              <BrandEyebrow />
              <h1 className="scheduler__title">Course Planner</h1>
            </div>
            <div className="topbar-resume">
              <button
                type="button"
                className="topbar-btn topbar-btn--resume"
                onClick={triggerReloadPicker}
                title="Pick a previously exported schedule to resume editing"
              >
                Resume from Excel
              </button>
              {reloadMtime !== null && (
                <span
                  className="topbar-resume__loaded"
                  title={`File last modified ${new Date(reloadMtime).toLocaleString()}`}
                >
                  {reloadFilename ? `${reloadFilename} · ` : ""}
                  Loaded {formatLoadedTimestamp(reloadMtime)}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleReloadFile(f)
                  e.target.value = ""
                }}
              />
            </div>
          </div>
          <div className="scheduler__topbar-right">
            <button
              type="button"
              className={
                "topbar-btn topbar-btn--export" +
                (exportChaseKey > 0 ? " topbar-btn--export--chasing" : "")
              }
              onClick={() => {
                setExportChaseKey(k => k + 1)
                requestExport()
              }}
              disabled={!(apiAvailable === true && state.solveStatus === "done")}
              title={
                apiAvailable !== true
                  ? "Solver requires the local launcher"
                  : state.solveStatus === "done"
                    ? "Download Excel with all three modes + solver state (resume-able)"
                    : "Assemble a schedule first"
              }
            >
              {exportChaseKey > 0 && (
                <span
                  key={exportChaseKey}
                  className="btn-chaser"
                  aria-hidden="true"
                  onAnimationEnd={() => setExportChaseKey(0)}
                />
              )}
              Export
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={cycleTheme}
              title={`Theme: ${theme} (${resolved})`}
              aria-label={`Switch theme, currently ${theme}`}
            >
              {resolved === "dark" ? "\u263E" : "\u2600"}
              {theme === "system" && <span className="theme-toggle__auto">A</span>}
            </button>
            <DataIssuesPanel errors={reloadErrors} />
            <TopbarMenu />
          </div>
        </header>
        <main className="scheduler__canvas" data-active={activePanel}>
          {rosterPanel}
          {schedulePanel}
          {detailPanel}
        </main>

        {/* Bottom tabs — visible only on portrait via CSS */}
        <nav className="bottom-tabs" aria-label="Panels">
          <button
            type="button"
            className={
              "bottom-tab" + (activePanel === "roster" ? " bottom-tab--active" : "")
            }
            onClick={() => setActivePanel("roster")}
          >
            <span className="bottom-tab__icon">☰</span>
            Roster
          </button>
          <button
            type="button"
            className={
              "bottom-tab" + (activePanel === "schedule" ? " bottom-tab--active" : "")
            }
            onClick={() => setActivePanel("schedule")}
          >
            <span className="bottom-tab__icon">▦</span>
            Schedule
          </button>
          <button
            type="button"
            className={
              "bottom-tab" + (activePanel === "detail" ? " bottom-tab--active" : "")
            }
            onClick={() => setActivePanel("detail")}
          >
            <span className="bottom-tab__icon">ⓘ</span>
            Detail
          </button>
        </nav>
        </div>

        {/* Landscape roster drawer — CSS toggles visibility on 768-1023px */}
        <div
          className={
            "roster-drawer__scrim" +
            (rosterDrawerOpen ? " roster-drawer__scrim--visible" : "")
          }
          onClick={closeRosterDrawer}
          aria-hidden="true"
        />
        <div
          className={
            "roster-drawer" + (rosterDrawerOpen ? " roster-drawer--open" : "")
          }
        >
          {rosterPanel}
        </div>

        <CatalogueDrawer
          open={catalogueOpen}
          onClose={closeCatalogue}
          catalog={state.catalog}
          offerings={state.offerings}
          selectedOfferingId={state.selectedOfferingId}
          onSelect={selectOffering}
          onAdd={addOffering}
          onRemove={removeOffering}
        />
      </div>
      <SolverTuning
        open={tuningOpen}
        onClose={() => setTuningOpen(false)}
        onApply={handleApplyTunedMix}
      />
      <ChangeLog entries={changeLog} onClear={clearChangeLog} />
     </ProfessorContext.Provider>
    </PortraitContext.Provider>
  )
}

export default App
