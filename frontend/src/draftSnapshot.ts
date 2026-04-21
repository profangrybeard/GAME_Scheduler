/**
 * Client-side "last known good" snapshot of a parsed draft state, keyed by
 * workbook filename. The plan (phase 1.3) calls for a JSON snapshot written
 * on every successful load; if a later reload of the same file fails
 * structurally (corrupted `_data_*`, missing meta sheet, etc.), the reload
 * banner offers a one-click restore instead of leaving the user stranded.
 *
 * Why localStorage and not a server file: the hosted deployment on Fly runs
 * on ephemeral containers — anything the server writes to disk dies on next
 * restart. localStorage is per-browser but works on every surface, including
 * the gated hosted build.
 *
 * Size budget: ~5 MB per origin across all localStorage keys. A normal draft
 * (no solver_results) is small; solver_results for 500+ assignments can push
 * it. If the full state doesn't fit, we drop solver_results and retry — the
 * calendar will re-populate from a fresh solve, but prof/room/offering edits
 * are what the user can't rebuild manually, so those are the priority.
 */
import type { DraftState } from "./api"

const KEY_PREFIX = "scheduler_snapshot:"

export interface DraftSnapshot {
  /** Epoch ms when the snapshot was captured. */
  savedAt: number
  /** Parsed draft state as returned by `/api/state/parse`. */
  state: DraftState
}

/** Save a snapshot of `state` for later recovery. Best-effort: if
 *  localStorage is full, drop solver_results and retry; if still full,
 *  silently give up (the primary load path isn't affected). */
export function saveDraftSnapshot(filename: string, state: DraftState): void {
  const key = KEY_PREFIX + filename
  const write = (s: DraftState): boolean => {
    const payload: DraftSnapshot = { savedAt: Date.now(), state: s }
    try {
      localStorage.setItem(key, JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }
  if (write(state)) return
  // Fallback: drop the biggest field (solver_results) and try again. The
  // calendar will be empty on restore but the user's edits survive — which
  // is what they actually can't rebuild by re-solving.
  const { solver_results: _drop, ...lean } = state
  write(lean as DraftState)
}

/** Fetch the snapshot for `filename`, or null if none exists / is corrupt. */
export function loadDraftSnapshot(filename: string): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + filename)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    if (typeof parsed.savedAt !== "number" || typeof parsed.state !== "object") return null
    return parsed as DraftSnapshot
  } catch {
    return null
  }
}

/** Delete the snapshot for `filename`. Call when the snapshot shouldn't be
 *  offered again (e.g., user dismissed the banner, or a fresh load replaced
 *  it successfully — the save overwrites, so delete isn't strictly needed
 *  there, but useful for tests and explicit clears). */
export function deleteDraftSnapshot(filename: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + filename)
  } catch {
    /* ignore — quota/private-mode errors aren't actionable here */
  }
}
