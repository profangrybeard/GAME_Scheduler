import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  downloadBlob,
  parseDraftState,
  pingApi,
  postCommit,
  postExportStream,
  postSolveStream,
  responseAssignmentToAssignment,
  type SolveEvent,
  type SolveModeResult,
  type SolveRequestBody,
} from "./api"
import { CatalogueDrawer } from "./components/CatalogueDrawer"
import { Class } from "./components/Class"
import { PortraitContext } from "./components/PortraitContext"
import { ProfessorContext } from "./components/ProfessorContext"
import { ProfessorCard } from "./components/ProfessorCard"
import { QuarterSchedule } from "./components/QuarterSchedule"
import { RoomCard } from "./components/RoomCard"
import { Roster } from "./components/Roster"
import { SolverTuning } from "./components/SolverTuning"
import { loadTunedMix, mixToSolverWeights, type Mix } from "./components/SolverMix"
import { VersionBadge } from "./components/VersionBadge"
import { loadInitialState } from "./data"
import { useTheme } from "./hooks/useTheme"
import { mintOfferingId, profContractCeiling, profContractFloor, SCHOOL_LABELS, SCHOOL_ORDER } from "./types"
import type { Assignment, Offering, Professor, RosterCapacity, Room, SchedulerState, Slot, SolveMode, SolveModeProgress, SolveProgressState } from "./types"
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
  affinity_first:  "Affinity",
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

  // ── Resume from Excel state ────────────────────────────────────
  const [reloadWarnings, setReloadWarnings] = useState<string[] | null>(null)
  const [reloadError, setReloadError] = useState<string | null>(null)
  const [reloadFilename, setReloadFilename] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── Responsive UI state ──────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<ActivePanel>("schedule")
  const [rosterDrawerOpen, setRosterDrawerOpen] = useState(false)
  const [placingId, setPlacingId] = useState<string | null>(null)

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

  /** Add an offering for `catalog_id`. Until PR 2 splits sections, at most
   *  one offering per catalog_id — a second call for the same catalog_id
   *  selects the existing row instead of creating a duplicate.
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
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.offering_id === offering_id
          ? { ...o, pinned: slot, assignment: null }
          : o,
      ),
    }))
    setPlacingId(null)
  }, [])

  /** Apply a mode's assignments to the offerings list. Assignments not present
   *  in the mode clear `offering.assignment` — the user sees only the current
   *  mode's schedule, not a stale one. */
  const applyModeAssignments = useCallback(
    (mode: SolveModeResult | undefined) => {
      if (!mode) return
      const byCatalog: Record<string, Assignment> = {}
      for (const a of mode.assignments) {
        byCatalog[a.catalog_id] = responseAssignmentToAssignment(a)
      }
      setState(s => ({
        ...s,
        offerings: s.offerings.map(o => ({
          ...o,
          assignment: byCatalog[o.catalog_id] ?? null,
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
    },
    [applyModeAssignments],
  )

  const emptyCalendar = useCallback(() => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o => ({ ...o, assignment: null })),
      solveStatus: "idle",
    }))
    modeResultsRef.current = null
    setSolveProgress(null)
    setSolveError(null)
  }, [])

  /** Build the solve request. Accepts an optional tuned-weights override so
   *  the "Try it on current schedule" button can solve with a freshly-set mix
   *  in the same tick (useState batches; reading tunedMix here would see the
   *  prior value). */
  const buildSolveRequest = useCallback((overrideMix?: Mix): SolveRequestBody => ({
    quarter:      state.quarter,
    year:         state.year,
    solveMode:    state.solveMode,
    offerings:    state.offerings,
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

    setSolveError(null)
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
  }, [requestSolve])

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

  const loadExample = useCallback(async () => {
    try {
      // Vite serves `public/*` from the root, so this works for dev, preview,
      // and GitHub Pages (same-origin fetch, no /api involved).
      const base = import.meta.env.BASE_URL || "/"
      const res = await fetch(`${base}example-schedule.xlsx`)
      if (!res.ok) throw new Error(`example file missing (${res.status})`)
      const blob = await res.blob()
      const file = new File([blob], "example-schedule.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      await handleReloadFile(file)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setReloadError(msg)
    }
  // handleReloadFile is declared below; it only depends on stable callbacks,
  // so exhaustive-deps flags the order but won't actually re-bind.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleReloadFile = useCallback(async (file: File) => {
    setReloadError(null)
    setReloadWarnings(null)
    setReloadFilename(null)
    try {
      const { state: draft, warnings } = await parseDraftState(file)

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

      // Build per-catalog assignment map for the active mode (so the calendar
      // populates immediately without a second reducer pass).
      const activeMode = cachedModes[draft.solver_mode]
      const byCatalog: Record<string, Assignment> = {}
      if (activeMode) {
        for (const a of activeMode.assignments) {
          byCatalog[a.catalog_id] = responseAssignmentToAssignment(a)
        }
      }

      // offering_id is runtime-only — regenerate on every reload. See data.ts.
      const seen: Record<string, number> = {}
      setState(s => ({
        ...s,
        selectedOfferingId: null,
        quarter:    draft.quarter,
        year:       draft.year,
        solveMode:  draft.solver_mode,
        solveStatus: "idle",
        offerings: draft.offerings.map(o => {
          const n = (seen[o.catalog_id] ?? 0) + 1
          seen[o.catalog_id] = n
          return {
            offering_id:                   `${o.catalog_id}#${n}`,
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
            assignment:                    byCatalog[o.catalog_id] ?? null,
          }
        }),
      }))

      setReloadWarnings(warnings)
      setReloadFilename(file.name)
      setSolveProgress(null)
      setSolveError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (import.meta.env.DEV) console.error("[reload] error:", msg)
      setReloadError(msg)
    }
  }, [])

  const dismissReloadBanner = useCallback(() => {
    setReloadWarnings(null)
    setReloadError(null)
    setReloadFilename(null)
  }, [])

  // ── Placement mode (tap-to-place alternative to DnD) ────────────

  const startPlacing = useCallback((id: string) => {
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

  // ── Overlay persistence (Backup / Restore / Commit) ──────────────
  //
  // The workspace stores edits in three localStorage overlays (prof, room,
  // portraits). These three actions let the user move that overlay around:
  //   Backup  — download the overlay as a portable JSON file (works
  //             everywhere; survives PC swaps, Drive round-trips, etc.)
  //   Restore — replace the current overlay from a backup file
  //   Commit  — write the overlay into the canonical data/*.json files
  //             on disk (local stack only; hosted filesystem is ephemeral)
  //
  // Commit is the "pre-ship" action for the dev/author; Backup/Restore is
  // the portability path every chair eventually needs when they change PCs.

  const importInputRef = useRef<HTMLInputElement>(null)

  const exportOverlay = useCallback(() => {
    // schema_version 3: both `professors` and `rooms` are full lists
    // (Path B), not patch overlays. Restore also accepts v1 (legacy
    // profEdits + roomEdits) and v2 (profEdits + rooms list) for back-compat
    // with backups exported by older builds.
    const snapshot = {
      schema_version: 3,
      kind: "scheduler-overlay",
      exported_at: new Date().toISOString(),
      professors: Object.values(state.professors),
      rooms: Object.values(state.rooms),
      portraits,
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    })
    const date = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `scheduler-overlay-${date}.json`)
  }, [state.professors, state.rooms, portraits])

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset so picking the same file twice still fires onChange
      e.target.value = ""
      if (!file) return

      let snapshot: {
        schema_version?: number
        kind?: string
        professors?: Professor[]
        profEdits?: Record<string, Partial<Professor>> // legacy v1/v2
        rooms?: Room[]
        roomEdits?: Record<string, Partial<Room>> // legacy v1
        portraits?: Record<string, string>
      }
      try {
        snapshot = JSON.parse(await file.text())
      } catch (err) {
        alert(`Could not read file: ${err instanceof Error ? err.message : err}`)
        return
      }
      const v = snapshot.schema_version
      if (snapshot.kind !== "scheduler-overlay" ||
          (v !== 1 && v !== 2 && v !== 3)) {
        alert("Not a valid Scheduler overlay file.")
        return
      }

      const baseline = loadInitialState()
      const nextPortraits = snapshot.portraits ?? {}

      // Resolve the professors list. v3 carries it explicitly; v1/v2 carry
      // overlay patches, which we apply to baseline for migration.
      let nextProfs: Professor[]
      if (v === 3 && snapshot.professors) {
        nextProfs = snapshot.professors
      } else {
        const edits = snapshot.profEdits ?? {}
        nextProfs = Object.values(applyEdits(baseline.professors, edits))
      }

      // Resolve the rooms list. v2/v3 carry it explicitly; v1 carries overlay
      // patches, which we apply to the current baseline just like the legacy
      // loader would have. Either way, after restore the state.rooms IS the
      // source of truth going forward.
      let nextRooms: Room[]
      if ((v === 2 || v === 3) && snapshot.rooms) {
        nextRooms = snapshot.rooms
      } else {
        const edits = snapshot.roomEdits ?? {}
        nextRooms = Object.values(applyEdits(baseline.rooms, edits))
      }

      const counts =
        `${nextProfs.length} professors · ` +
        `${nextRooms.length} rooms · ` +
        `${Object.keys(nextPortraits).length} portraits`
      if (!window.confirm(
        `Restore overlay?\nThis replaces your current edits with:\n  ${counts}`
      )) return

      saveProfessors(nextProfs)
      saveRooms(nextRooms)
      try {
        localStorage.setItem(PORTRAIT_STORAGE_KEY, JSON.stringify(nextPortraits))
      } catch { /* full */ }

      setPortraits(nextPortraits)

      // Write both full lists straight into state. Offerings, solve state,
      // selections, etc. stay put — overlay restore is scoped to ref data.
      const profsMap = Object.fromEntries(nextProfs.map(p => [p.id, p]))
      const roomsMap = Object.fromEntries(nextRooms.map(r => [r.id, r]))
      setState(s => ({
        ...s,
        professors: profsMap,
        rooms: roomsMap,
      }))
    },
    [],
  )

  const commitToSource = useCallback(async () => {
    const profsList = Object.values(state.professors)
    const nProfs = profsList.length
    const roomsList = Object.values(state.rooms)
    const nRooms = roomsList.length
    const nPortraits = Object.keys(portraits).length
    // Both professors and rooms are written as full lists, so an empty deck
    // IS a meaningful commit (= clear all). Only bail when literally every
    // bucket is empty, which we treat as a no-op user misclick.
    if (nProfs + nRooms + nPortraits === 0) {
      alert("No edits to commit.")
      return
    }
    if (!window.confirm(
      `Write edits to source files on disk?\n\n` +
      `  • data/professors.json  (${nProfs} professors, full replace)\n` +
      `  • data/rooms.json  (${nRooms} rooms, full replace)\n` +
      `  • data/portraits/  (${nPortraits} portraits)\n\n` +
      `Canonical files will be modified. Commit them to git afterward.`
    )) return

    try {
      const result = await postCommit({
        professors: profsList,
        rooms: roomsList,
        portraits,
      })
      const head =
        `Committed: ${result.professorsUpdated} profs · ` +
        `${result.roomsUpdated} rooms · ` +
        `${result.portraitsWritten} portraits.`
      const tail = result.warnings.length > 0
        ? `\n\nWarnings:\n${result.warnings.map(w => "• " + w).join("\n")}`
        : ""
      alert(head + tail)
    } catch (err) {
      alert(`Commit failed: ${err instanceof Error ? err.message : err}`)
    }
  }, [state.professors, state.rooms, portraits])

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

  const loadedSchools = useMemo(() => {
    const depts = new Set<string>()
    for (const course of Object.values(state.catalog)) {
      depts.add(course.department)
    }
    return SCHOOL_ORDER.filter(d => depts.has(d)).map(d => SCHOOL_LABELS[d])
  }, [state.catalog])

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
      onSolve={() => { void requestSolve() }}
      onEmptyCalendar={emptyCalendar}
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
        <aside className="resume-rail" aria-label="Resume from an exported schedule">
          <button
            type="button"
            className="resume-rail__btn"
            onClick={triggerReloadPicker}
            title="Pick a previously exported schedule to resume editing"
          >
            <span className="resume-rail__mark" aria-hidden="true">🐝</span>
            <span className="resume-rail__label">Resume from Excel</span>
          </button>
          {/* Hidden native file input — reset .value so picking the same
              file twice still fires onChange (browsers de-dupe by default). */}
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
          <button
            type="button"
            className="resume-rail__example"
            onClick={loadExample}
            title="Load the bundled example-schedule.xlsx"
          >
            <span className="resume-rail__example-label">Try the example</span>
          </button>
        </aside>
        <div className="scheduler__body">
        {placingOffering && placingCourse && (
          <div className="placement-banner placement-banner--visible">
            <span>
              Tap a cell to place <strong>{placingCourse.id}</strong>, or tap the
              unpin strip to remove.
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
        {(reloadError || reloadWarnings) && (
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
                <strong>Couldn't load that file: {reloadError}</strong>
              ) : (
                <>
                  <strong>
                    Loaded draft{reloadFilename ? ` from ${reloadFilename}` : ""}
                  </strong>
                  {reloadWarnings && reloadWarnings.length > 0 && (
                    <ul className="reload-banner__warnings">
                      {reloadWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
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
            <h1 className="scheduler__title">
              SCAD Course Planner for Faculty
              {loadedSchools.length > 0 && (
                <span className="scheduler__schools">
                  {loadedSchools.join(" · ")}
                </span>
              )}
            </h1>
          </div>
          <span className="scheduler__context">
            {state.quarter} {state.year} · {rosterCapacity.loaded} classes ·{" "}
            {SOLVE_MODE_LABELS[state.solveMode] ?? state.solveMode}
          </span>
          <div className="scheduler__topbar-right">
            <div className="topbar-persist" role="group" aria-label="Overlay storage">
              <button
                type="button"
                className="topbar-btn topbar-btn--ghost"
                onClick={exportOverlay}
                title="Download current edits as a portable JSON backup"
              >
                Backup
              </button>
              <button
                type="button"
                className="topbar-btn topbar-btn--ghost"
                onClick={() => importInputRef.current?.click()}
                title="Replace current edits from a backup JSON"
              >
                Restore
              </button>
              <button
                type="button"
                className="topbar-btn topbar-btn--ghost"
                onClick={commitToSource}
                disabled={apiAvailable !== true}
                title={
                  apiAvailable === true
                    ? "Write edits to data/*.json on disk"
                    : "Requires the local launcher"
                }
              >
                Commit
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="topbar-persist__input"
                onChange={handleImportFile}
              />
            </div>
            <button
              type="button"
              className="topbar-btn topbar-btn--export"
              onClick={requestExport}
              disabled={!(apiAvailable === true && state.solveStatus === "done")}
              title={
                apiAvailable !== true
                  ? "Solver requires the local launcher"
                  : state.solveStatus === "done"
                    ? "Download schedule as Excel"
                    : "Generate a schedule first"
              }
            >
              Export
            </button>
            <VersionBadge />
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
     </ProfessorContext.Provider>
    </PortraitContext.Provider>
  )
}

export default App
