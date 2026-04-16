import { useCallback, useEffect, useRef, useState } from "react"
import {
  downloadBlob,
  pingApi,
  postExport,
  postSolve,
  responseAssignmentToAssignment,
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
import type { Assignment, Offering, Professor, Room, SchedulerState, Slot, SolveMode } from "./types"
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
  // Cache of all three solve modes from the last /api/solve, so flipping the
  // solveMode chip re-applies without re-running the solver.
  const modeResultsRef = useRef<Record<string, SolveModeResult> | null>(null)

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

  const pinToSlot = useCallback((catalog_id: string, slot: Slot | null) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.catalog_id === catalog_id ? { ...o, pinned: slot } : o,
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

  const requestSolve = useCallback(async () => {
    setSolveError(null)
    setState(s => ({ ...s, solveStatus: "running" }))
    try {
      const res = await postSolve(buildSolveRequest())
      const byMode: Record<string, SolveModeResult> = {}
      for (const m of res.modes) byMode[m.mode] = m
      modeResultsRef.current = byMode
      applyModeAssignments(byMode[state.solveMode] ?? res.modes[0])
      setState(s => ({ ...s, solveStatus: "done" }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[solve] error:", msg)
      setSolveError(msg)
      setState(s => ({ ...s, solveStatus: "error" }))
    }
  }, [buildSolveRequest, applyModeAssignments, state.solveMode])

  const requestExport = useCallback(async () => {
    setSolveError(null)
    try {
      const { blob, filename } = await postExport(buildSolveRequest())
      downloadBlob(blob, filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[export] error:", msg)
      setSolveError(msg)
    }
  }, [buildSolveRequest])

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
      onSelect={selectOffering}
      onSelectProfessor={selectProfessor}
      onAdd={addOffering}
      onPinToSlot={pinToSlot}
      onSetSolveMode={setSolveMode}
      onSolve={requestSolve}
      onExport={requestExport}
      onStartPlacing={startPlacing}
      onDismissError={() => setSolveError(null)}
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
        <header className="scheduler__topbar">
          <button
            type="button"
            className="topbar-hamburger"
            onClick={openRosterDrawer}
            aria-label="Open roster"
          >
            ☰
          </button>
          <h1 className="scheduler__title">GAME Scheduler</h1>
          <span className="scheduler__context">
            {state.quarter} {state.year} · {offeringCount} offerings ·{" "}
            {state.solveMode}
          </span>
          <div className="scheduler__topbar-right">
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
