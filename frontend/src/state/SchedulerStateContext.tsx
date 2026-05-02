/**
 * Single source of truth for SchedulerState across the desktop App tree
 * and the mobile MobileApp tree. Wraps both at main.tsx so they read from
 * and write to the same useState pair. UI-local state (which panel is
 * active, drag state, modal toggles) stays inside each tree — only the
 * domain data (offerings, professors, rooms, catalog, quarter, solveStatus)
 * is shared.
 *
 * This context replaces the inline `useState<SchedulerState>` that used
 * to live at App.tsx:187. The initializer is identical — see
 * `loadInitialSchedulerState` in ./persistence.
 */

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import type { SchedulerState } from "../types"
import { loadInitialSchedulerState } from "./persistence"

type Value = readonly [SchedulerState, Dispatch<SetStateAction<SchedulerState>>]

const SchedulerStateContext = createContext<Value | null>(null)

export function SchedulerStateProvider({ children }: { children: ReactNode }) {
  const tuple = useState<SchedulerState>(loadInitialSchedulerState)
  return (
    <SchedulerStateContext.Provider value={tuple}>
      {children}
    </SchedulerStateContext.Provider>
  )
}

export function useSchedulerState(): Value {
  const ctx = useContext(SchedulerStateContext)
  if (!ctx) {
    throw new Error(
      "useSchedulerState must be used within SchedulerStateProvider",
    )
  }
  return ctx
}
