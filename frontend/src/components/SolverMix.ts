/**
 * Mix type + persistence helpers for the SolverTuning component.
 *
 * Lives in a separate file from SolverTuning.tsx so React Refresh keeps
 * working — the lint rule `react-refresh/only-export-components` requires
 * component files to export only components.
 */

export interface Mix {
  coverage: number
  time:     number
  overload: number
}

/** localStorage key. Path B: the saved object IS the mix, not a patch. */
export const TUNED_WEIGHTS_KEY = "tunedWeights"

// Mirror config.MODE_WEIGHTS, expressed as percent of 100.
// cover_first      10/1/1   = 12   ->  83 / 8  / 8
// time_pref_first  3/10/2   = 15   ->  20 / 67 / 13
// balanced         5/5/3    = 13   ->  38 / 38 / 23
export const PRESETS: Record<string, Mix> = {
  cover_first:     { coverage: 83, time: 8,  overload: 8  },
  time_pref_first: { coverage: 20, time: 67, overload: 13 },
  balanced:        { coverage: 38, time: 38, overload: 23 },
}

export const PRESET_LABELS: Record<string, string> = {
  cover_first:     "Cover-First",
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
        typeof parsed.coverage === "number" &&
        typeof parsed.time     === "number" &&
        typeof parsed.overload === "number"
      ) {
        return { coverage: parsed.coverage, time: parsed.time, overload: parsed.overload }
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
export function mixToSolverWeights(mix: Mix): { coverage: number; time_pref: number; overload: number } {
  return {
    coverage:  mix.coverage,
    time_pref: mix.time,
    overload:  mix.overload,
  }
}
