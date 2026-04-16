import { useCallback, useEffect, useState } from "react"
import { CatalogueDrawer } from "./components/CatalogueDrawer"
import { Class } from "./components/Class"
import { PortraitContext } from "./components/PortraitContext"
import { ProfessorCard } from "./components/ProfessorCard"
import { QuarterSchedule } from "./components/QuarterSchedule"
import { Roster } from "./components/Roster"
import { loadInitialState } from "./data"
import { useTheme } from "./hooks/useTheme"
import type { Offering, Professor, SchedulerState, Slot, SolveMode } from "./types"
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

function applyProfEdits(
  base: Record<string, Professor>,
  edits: Record<string, Partial<Professor>>,
): Record<string, Professor> {
  const result = { ...base }
  for (const [id, patch] of Object.entries(edits)) {
    if (result[id]) result[id] = { ...result[id], ...patch }
  }
  return result
}

function App() {
  const [state, setState] = useState<SchedulerState>(() => {
    const base = loadInitialState()
    const edits = loadProfEdits()
    return { ...base, professors: applyProfEdits(base.professors, edits) }
  })
  const [, setProfEdits] = useState<Record<string, Partial<Professor>>>(loadProfEdits)
  const { theme, resolved, cycle: cycleTheme } = useTheme()
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [selectedProfId, setSelectedProfId] = useState<string | null>(null)
  const [portraits, setPortraits] = useState<Record<string, string>>(loadPortraits)

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
    if (id) setActivePanel("detail")
  }, [])

  const selectProfessor = useCallback((id: string | null) => {
    setSelectedProfId(id)
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
        locked: null,
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

  const pinToSlot = useCallback((catalog_id: string, slot: Slot | null) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.catalog_id === catalog_id
          ? {
              ...o,
              pinned: slot,
              locked:
                slot && o.locked && sameSlot(o.locked, slot) ? o.locked : null,
            }
          : o,
      ),
    }))
    setPlacingId(null)
  }, [])

  const toggleLock = useCallback((catalog_id: string) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o => {
        if (o.catalog_id !== catalog_id) return o
        if (o.locked) return { ...o, locked: null }
        const target = o.pinned ?? o.assignment?.slot ?? null
        return target ? { ...o, locked: target } : o
      }),
    }))
  }, [])

  const setSolveMode = useCallback((mode: SolveMode) => {
    setState(s => ({ ...s, solveMode: mode }))
  }, [])

  const requestSolve = useCallback(() => {
    setState(s => ({ ...s, solveStatus: "running" }))
    setTimeout(() => {
      setState(s => ({ ...s, solveStatus: "done" }))
    }, 400)
  }, [])

  const requestExport = useCallback(() => {
    console.info("[stub] requestExport — wire to backend")
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

  // ── Render ─────────────────────────────────────────────────────────

  const offeringCount = state.offerings.length
  const selectedProf = selectedProfId ? state.professors[selectedProfId] : null
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
      selectedOfferingId={state.selectedOfferingId}
      placingId={placingId}
      onSelect={selectOffering}
      onSelectProfessor={selectProfessor}
      onRemove={removeOffering}
      onOpenCatalogue={openCatalogue}
      onStartPlacing={startPlacing}
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
      onSelect={selectOffering}
      onSelectProfessor={selectProfessor}
      onAdd={addOffering}
      onPinToSlot={pinToSlot}
      onSetSolveMode={setSolveMode}
      onSolve={requestSolve}
      onExport={requestExport}
      onStartPlacing={startPlacing}
    />
  )

  const detailPanel = selectedProf ? (
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
      onToggleLock={toggleLock}
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

function sameSlot(a: Slot, b: Slot): boolean {
  return a.day_group === b.day_group && a.time_slot === b.time_slot
}

export default App
