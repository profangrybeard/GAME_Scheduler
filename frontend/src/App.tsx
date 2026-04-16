import { useCallback, useState } from "react"
import { Catalogue } from "./components/Catalogue"
import { Class } from "./components/Class"
import { QuarterSchedule } from "./components/QuarterSchedule"
import { loadInitialState } from "./data"
import type { Offering, SchedulerState, Slot, SolveMode } from "./types"
import "./App.css"

/**
 * App — the state parent for the Reactive Sandbox.
 *
 * This file is the single source of truth. All three panels receive state
 * slices as props and dispatch changes back through callbacks. No panel
 * keeps its own copy of any field on SchedulerState.
 *
 * See docs/state-flow.md for the Mermaid diagram that formalizes the contract.
 *
 * Panel mapping (Option Y — the scheduler's natural flow):
 *   Browser     → Catalogue         (pick a course)
 *   Detail      → Class             (assign prof/room/priority — WRITES)
 *   Controller  → Quarter Schedule  (place it, generate, export)
 */

function App() {
  const [state, setState] = useState<SchedulerState>(() => loadInitialState())

  // ── Actions ────────────────────────────────────────────────────────

  const selectOffering = useCallback((id: string | null) => {
    setState(s => ({ ...s, selectedOfferingId: id }))
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

  const pinToSlot = useCallback((catalog_id: string, slot: Slot | null) => {
    setState(s => ({
      ...s,
      offerings: s.offerings.map(o =>
        o.catalog_id === catalog_id
          ? {
              ...o,
              pinned: slot,
              // Moving to a new slot clears any existing lock — lock only
              // pertains to the specific slot it was set on.
              locked:
                slot && o.locked && sameSlot(o.locked, slot) ? o.locked : null,
            }
          : o,
      ),
    }))
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

  // ── Render ─────────────────────────────────────────────────────────

  const offeringCount = state.offerings.length

  return (
    <div className="scheduler">
      <header className="scheduler__topbar">
        <h1 className="scheduler__title">GAME Scheduler</h1>
        <span className="scheduler__context">
          {state.quarter} {state.year} · {offeringCount} offerings ·{" "}
          {state.solveMode}
        </span>
      </header>
      <main className="scheduler__canvas">
        <Catalogue
          catalog={state.catalog}
          offerings={state.offerings}
          selectedOfferingId={state.selectedOfferingId}
          onSelect={selectOffering}
          onAdd={addOffering}
          onRemove={removeOffering}
        />
        <QuarterSchedule
          offerings={state.offerings}
          selectedOfferingId={state.selectedOfferingId}
          catalog={state.catalog}
          professors={state.professors}
          rooms={state.rooms}
          solveStatus={state.solveStatus}
          solveMode={state.solveMode}
          onSelect={selectOffering}
          onAdd={addOffering}
          onPinToSlot={pinToSlot}
          onSetSolveMode={setSolveMode}
          onSolve={requestSolve}
          onExport={requestExport}
        />
        <Class
          selectedOfferingId={state.selectedOfferingId}
          offerings={state.offerings}
          catalog={state.catalog}
          professors={state.professors}
          rooms={state.rooms}
          onUpdate={updateOffering}
          onToggleLock={toggleLock}
          onRemove={removeOffering}
        />
      </main>
    </div>
  )
}

function sameSlot(a: Slot, b: Slot): boolean {
  return a.day_group === b.day_group && a.time_slot === b.time_slot
}

export default App
