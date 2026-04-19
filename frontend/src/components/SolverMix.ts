/**
 * Mix type + persistence helpers for the SolverTuning component.
 *
 * Lives in a separate file from SolverTuning.tsx so React Refresh keeps
 * working — the lint rule `react-refresh/only-export-components` requires
 * component files to export only components.
 */

export interface Mix {
  affinity: number
  time:     number
  overload: number
}

/** localStorage key. Path B: the saved object IS the mix, not a patch. */
export const TUNED_WEIGHTS_KEY = "tunedWeights"

// Mirror config.MODE_WEIGHTS, expressed as percent of 100.
// affinity_first  10/1/2   = 13   ->  77 / 8  / 15
// time_pref_first 1/10/2   = 13   ->  8  / 77 / 15
// balanced        10/4/3   = 17   ->  59 / 23 / 18
export const PRESETS: Record<string, Mix> = {
  affinity_first:  { affinity: 77, time: 8,  overload: 15 },
  time_pref_first: { affinity: 8,  time: 77, overload: 15 },
  balanced:        { affinity: 59, time: 23, overload: 18 },
}

export const PRESET_LABELS: Record<string, string> = {
  affinity_first:  "Affinity-First",
  time_pref_first: "Time-First",
  balanced:        "Balanced",
}

export const DEFAULT_TUNED_MIX: Mix = { ...PRESETS.balanced }

/** Load the saved mix from localStorage, or the Balanced default. */
export function loadTunedMix(): Mix {
  try {
    const raw = localStorage.getItem(TUNED_WEIGHTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Mix>
      if (
        typeof parsed.affinity === "number" &&
        typeof parsed.time     === "number" &&
        typeof parsed.overload === "number"
      ) {
        return { affinity: parsed.affinity, time: parsed.time, overload: parsed.overload }
      }
    }
  } catch { /* corrupted */ }
  return { ...DEFAULT_TUNED_MIX }
}

export function saveTunedMix(mix: Mix) {
  try { localStorage.setItem(TUNED_WEIGHTS_KEY, JSON.stringify(mix)) } catch { /* full */ }
}

/** Convert the percent-of-100 Mix into the integer weights the solver uses
 *  (shape of MODE_WEIGHTS entries). */
export function mixToSolverWeights(mix: Mix): { affinity: number; time_pref: number; overload: number } {
  return {
    affinity:  mix.affinity,
    time_pref: mix.time,
    overload:  mix.overload,
  }
}
