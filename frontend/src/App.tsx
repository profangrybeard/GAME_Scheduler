import { useCallback, useEffect, useRef, useState } from "react"
import {
  downloadBlob,
  parseDraftState,
  pingApi,
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
import { ProfessorCard } from "./components/ProfessorCard"
import { QuarterSchedule } from "./components/QuarterSchedule"
import { RoomCard } from "./components/RoomCard"
import { Roster } from "./components/Roster"
import { VersionBadge } from "./components/VersionBadge"
import { loadInitialState } from "./data"
import { useTheme } from "./hooks/useTheme"
import type { Assignment, Offering, Professor, Room, SchedulerState, Slot, SolveMode, SolveModeProgress, SolveProgressState } from "./types"
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
const PROF_EDITS_STORAGE_KEY = "professor-edits"
const ROOM_EDITS_STORAGE_KEY = "room-edits"

type ActivePanel = "roster" | "schedule" | "detail"

function loadPortraits(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PORTRAIT_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, string>
  } catch { /* corrupted */ }
  return {}
}

function loadProfEdits(): Record<string, Partial<Professor>> {
  try {
    const raw = localStorage.getItem(PROF_EDITS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, Partial<Professor>>
  } catch { /* corrupted */ }
  return {}
}

function saveProfEdits(edits: Record<string, Partial<Professor>>) {
  try { localStorage.setItem(PROF_EDITS_STORAGE_KEY, JSON.stringify(edits)) } catch { /* full */ }
}

function loadRoomEdits(): Record<string, Partial<Room>> {
  try {
    const raw = localStorage.getItem(ROOM_EDITS_STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, Partial<Room>>
  } catch { /* corrupted */ }
  return {}
}

function saveRoomEdits(edits: Record<string, Partial<Room>>) {
  try { localStorage.setItem(ROOM_EDITS_STORAGE_KEY, JSON.stringify(edits)) } catch { /* full */ }
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
    const profEdits = loadProfEdits()
    const roomEdits = loadRoomEdits()
    return {
      ...base,
      professors: applyEdits(base.professors, profEdits),
      rooms: applyEdits(base.rooms, roomEdits),
    }
  })
  const [profEdits, setProfEdits] = useState<Record<string, Partial<Professor>>>(loadProfEdits)
  const [roomEdits, setRoomEdits] = useState<Record<string, Partial<Room>>>(loadRoomEdits)
  const { theme, resolved, cycle: cycleTheme } = useTheme()
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [selectedProfId, setSelectedProfId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [portraits, setPortraits] = useState<Record<string, string>>(loadPortraits)

  // ── Solver / API state ─────────────────────────────────────────
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null)
  const [solveError, setSolveError] = useState<string | null>(null)
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

  const addOffering = useCallback((catalog_id: string) => {
    setState(s => {
      if (s.offerings.some(o => o.catalog_id === catalog_id)) return s
      const course = s.catalog[catalog_id]
      if (!course) return s
      const fresh: Offering = {
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
        selectedOfferingId: catalog_id,
      }
    })
    setSelectedProfId(null)
  }, [])

  const removeOffering = useCallback((catalog_id: string) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.filter(o => o.catalog_id !== catalog_id),
      selectedOfferingId:
        s.selectedOfferingId === catalog_id ? null : s.selectedOfferingId,
    }))
  }, [])

  const updateOffering = useCallback(
    (catalog_id: string, changes: Partial<Offering>) => {
      setState(s => ({
        ...s,
        offerings: s.offerings.map(o =>
          o.catalog_id === catalog_id ? { ...o, ...changes } : o,
        ),
      }))
    },
    [],
  )

  const updateProfessor = useCallback(
    (prof_id: string, changes: Partial<Professor>) => {
      setState(s => ({
        ...s,
        professors: {
          ...s.professors,
          [prof_id]: { ...s.professors[prof_id], ...changes },
        },
      }))
      setProfEdits(prev => {
        const next = { ...prev, [prof_id]: { ...prev[prof_id], ...changes } }
        saveProfEdits(next)
        return next
      })
    },
    [],
  )

  const updateRoom = useCallback(
    (room_id: string, changes: Partial<Room>) => {
      setState(s => ({
        ...s,
        rooms: {
          ...s.rooms,
          [room_id]: { ...s.rooms[room_id], ...changes },
        },
      }))
      setRoomEdits(prev => {
        const next = { ...prev, [room_id]: { ...prev[room_id], ...changes } }
        saveRoomEdits(next)
        return next
      })
    },
    [],
  )

  // User DnD always overrides solver output. Clearing `assignment` alongside
  // `pinned` is what actually makes the card move (or leave) visually — the
  // calendar's effectiveSlot is `assignment ?? pinned`, so a stale assignment
  // would silently win and the drop would look like it did nothing.
  const pinToSlot = useCallback((catalog_id: string, slot: Slot | null) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.catalog_id === catalog_id
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

  const buildSolveRequest = useCallback((): SolveRequestBody => ({
    quarter:            state.quarter,
    year:               state.year,
    solveMode:          state.solveMode,
    offerings:          state.offerings,
    professorOverrides: profEdits,
    roomOverrides:      roomEdits,
  }), [state.quarter, state.year, state.solveMode, state.offerings, profEdits, roomEdits])

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

  const requestSolve = useCallback(async () => {
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
        buildSolveRequest(),
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
      applyModeAssignments(byMode[state.solveMode] ?? res.modes[0])
      setState(s => ({ ...s, solveStatus: "done" }))
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

      setState(s => ({
        ...s,
        selectedOfferingId: null,
        quarter:    draft.quarter,
        year:       draft.year,
        solveMode:  draft.solver_mode,
        solveStatus: "idle",
        offerings: draft.offerings.map(o => ({
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
        })),
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

  const offeringCount = state.offerings.length
  const selectedProf = selectedProfId ? state.professors[selectedProfId] : null
  const selectedRoom = selectedRoomId ? state.rooms[selectedRoomId] : null
  const placingOffering = placingId
    ? state.offerings.find(o => o.catalog_id === placingId)
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
      onSolve={requestSolve}
      onExport={requestExport}
      onStartPlacing={startPlacing}
      onDismissError={() => setSolveError(null)}
      onDismissProgress={() => setSolveProgress(null)}
    />
  )

  const detailPanel = selectedRoom ? (
    <RoomCard
      room={selectedRoom}
      onUpdate={updateRoom}
      onClose={() => setSelectedRoomId(null)}
    />
  ) : selectedProf ? (
    <ProfessorCard
      professor={selectedProf}
      onUpdate={updateProfessor}
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
      <div className="scheduler">
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
          <button
            type="button"
            className="topbar-hamburger"
            onClick={openRosterDrawer}
            aria-label="Open roster"
          >
            ☰
          </button>
          <h1 className="scheduler__title">
            <span className="scheduler__bee" aria-hidden="true">🐝</span>
            {" "}GAME Scheduler
          </h1>
          <span className="scheduler__context">
            {state.quarter} {state.year} · {offeringCount} offerings ·{" "}
            {state.solveMode}
          </span>
          <div className="scheduler__topbar-right">
            <span
              className="topbar-tech"
              title="Constraint solver (Google OR-Tools CP-SAT). Runs locally — no cloud AI, no data leaves your machine."
            >
              OR-Tools · offline
            </span>
            <button
              type="button"
              className="topbar-btn"
              onClick={triggerReloadPicker}
              title="Resume from a previously exported Excel file"
            >
              Resume from Excel
            </button>
            {/* Hidden native file input. Reset .value so picking the same
                file twice still triggers onChange (browsers de-dupe by default). */}
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
    </PortraitContext.Provider>
  )
}

export default App
