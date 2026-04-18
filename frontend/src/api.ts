/**
 * HTTP client for the local FastAPI solver backend (api/server.py).
 *
 * In dev, Vite proxies /api/* to http://127.0.0.1:8765. In the GH Pages
 * preview build, /api/* doesn't exist — fetches fail fast and the caller
 * surfaces the error to disable Generate/Export.
 *
 * Keep this file tiny and dependency-free so a failed fetch never crashes
 * the workspace.
 */

import type { Assignment, Offering, Professor, Room, SolveMode } from "./types"

export interface SolveModeResult {
  mode: SolveMode | string
  status: string
  objective: number | null
  assignments: Array<{
    catalog_id: string
    section_idx: number
    prof_id: string
    room_id: string
    day_group: number
    time_slot: string
    affinity_level?: number
    time_pref?: string
  }>
  unscheduled: Array<{ catalog_id: string; priority?: string }>
}

export interface SolveResponse {
  quarter: string
  year: number
  modes: SolveModeResult[]
}

export interface SolveRequestBody {
  quarter: string
  year: number
  solveMode: SolveMode
  offerings: Offering[]
  professorOverrides: Record<string, Partial<Professor>>
  roomOverrides: Record<string, Partial<Room>>
}

/** Return a compact Assignment matching React's type shape. */
export function responseAssignmentToAssignment(
  a: SolveModeResult["assignments"][number],
): Assignment {
  return {
    prof_id: a.prof_id,
    room_id: a.room_id,
    slot: {
      day_group: a.day_group === 1 || a.day_group === 2 ? a.day_group : 1,
      time_slot: a.time_slot as Assignment["slot"]["time_slot"],
    },
  }
}

/** Ping the backend. Used for the "API available?" indicator. */
export async function pingApi(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { signal })
    if (!res.ok) return false
    const data = await res.json()
    return !!data.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Streaming solve (SSE)
// ---------------------------------------------------------------------------

/** One event from the solver's progress stream. Discriminated on `type`. */
export type SolveEvent =
  | {
      type: "solve_started"
      quarter: string
      year: number
      n_offerings: number
    }
  | {
      type: "mode_started"
      mode: SolveMode | string
      index: number
      total: number
    }
  | {
      type: "solution_found"
      mode: SolveMode | string
      objective: number
      best_bound: number
      n_placed: number
      n_total: number
      elapsed_ms: number
      solution_index: number
    }
  | {
      type: "mode_complete"
      mode: SolveMode | string
      status: string
      objective: number | null
      n_placed: number
      n_total: number
      elapsed_ms: number
      unscheduled_count: number
    }
  | ({ type: "solve_complete" } & SolveResponse)
  | {
      type: "error"
      message: string
      kind: "invalid_input" | "solver_error"
    }

/**
 * Stream a solve from /api/solve/stream, invoking `onEvent` for every frame
 * as it arrives. Returns the final SolveResponse on `solve_complete` or
 * throws on `error` / transport failure.
 *
 * We consume the SSE framing ourselves because EventSource doesn't support
 * POST bodies and the solver request is too large for a query string.
 * The parser is tolerant of mid-chunk splits — SSE frames are separated by
 * a blank line, so we buffer until we see `\n\n`.
 */
export async function postSolveStream(
  body: SolveRequestBody,
  onEvent: (event: SolveEvent) => void,
  signal?: AbortSignal,
): Promise<SolveResponse> {
  const res = await fetch("/api/solve/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept":       "text/event-stream",
    },
    body:   JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`solve stream failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  if (!res.body) {
    throw new Error("solve stream failed: response had no body")
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let finalResult: SolveResponse | null = null
  let errorEvent: { message: string; kind: string } | null = null

  const parseFrame = (frame: string): SolveEvent | null => {
    if (!frame || frame.startsWith(":")) return null // heartbeat / comment
    let dataStr: string | null = null
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim()
      }
    }
    if (dataStr === null) return null
    try {
      return JSON.parse(dataStr) as SolveEvent
    } catch {
      return null
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are delimited by a blank line. Anything after the last
      // \n\n stays in the buffer until the next chunk completes it.
      let sepIdx: number
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        const event = parseFrame(frame)
        if (!event) continue
        onEvent(event)
        if (event.type === "solve_complete") {
          finalResult = {
            quarter: event.quarter,
            year:    event.year,
            modes:   event.modes,
          }
        } else if (event.type === "error") {
          errorEvent = { message: event.message, kind: event.kind }
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }

  if (errorEvent) {
    const err = new Error(errorEvent.message) as Error & { kind?: string }
    err.kind = errorEvent.kind
    throw err
  }
  if (!finalResult) {
    throw new Error("solve stream ended without solve_complete")
  }
  return finalResult
}

export async function postExport(
  body: SolveRequestBody,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`export failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  const cd = res.headers.get("Content-Disposition") ?? ""
  const m = cd.match(/filename="?([^"]+)"?/i)
  const filename = m?.[1] ?? `schedule_${body.quarter}_${body.year}.xlsx`
  const blob = await res.blob()
  return { blob, filename }
}

// ---------------------------------------------------------------------------
// Resume from Excel — POST /api/state/parse
// ---------------------------------------------------------------------------

/**
 * Embedded draft state shape returned by /api/state/parse. Mirrors what the
 * backend writes into the hidden _state sheet of an exported XLSX. Offerings
 * arrive in React shape so SchedulerState can hydrate without an inverse
 * adapter; solver_results carries the last-shown calendar so reload doesn't
 * land on an empty grid.
 */
export interface DraftState {
  schema_version: number
  source: string
  quarter: string
  year: number
  solver_mode: SolveMode
  offerings: Offering[]
  solver_results?: SolveResponse
  professor_overrides?: Record<string, Partial<Professor>>
  room_overrides?: Record<string, Partial<Room>>
  exported_at?: string
}

export interface ParseDraftResponse {
  state: DraftState
  warnings: string[]
}

/**
 * Upload a Scheduler-exported XLSX to /api/state/parse. Returns the embedded
 * draft state and any reference-drift warnings (offerings/locks dropped because
 * their catalog_id / prof_id / room_id wasn't recognized locally).
 *
 * Throws Error with the server's `detail` string on 400/422 — the backend
 * already produces user-facing copy, so the caller can render `error.message`
 * directly without translation.
 */
export async function parseDraftState(file: File): Promise<ParseDraftResponse> {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch("/api/state/parse", { method: "POST", body: form })
  if (!res.ok) {
    let detail = `request failed (${res.status})`
    try {
      const body = await res.json() as { detail?: unknown }
      if (typeof body.detail === "string") detail = body.detail
    } catch { /* response wasn't JSON */ }
    throw new Error(detail)
  }
  return await res.json() as ParseDraftResponse
}


/** Trigger a browser download for the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Delay revoke so the browser gets a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
