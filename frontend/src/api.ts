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
  /** Full professors list — replaces server baseline entirely (Path B). */
  professors: Professor[]
  /** Full rooms list — replaces server baseline entirely (Path B). */
  rooms: Room[]
  /** User-tuned weights for the "balanced" mode. When present, the server
   *  uses these in place of MODE_WEIGHTS["balanced"]. Field names mirror the
   *  Python config keys so the body passes through verbatim. */
  tunedWeights?: { coverage: number; time_pref: number; overload: number }
}

/** Return a compact Assignment matching React's type shape. */
export function responseAssignmentToAssignment(
  a: SolveModeResult["assignments"][number],
): Assignment {
  return {
    prof_id: a.prof_id,
    room_id: a.room_id,
    slot: {
      day_group:
        a.day_group === 1 || a.day_group === 2 || a.day_group === 3
          ? a.day_group
          : 1,
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
  // Extra terminal events emitted by /api/export/stream (in addition to all
  // of the above). Reusing the same union keeps the App.tsx reducer single-
  // discriminator instead of two near-identical event handlers.
  | { type: "xlsx_writing" }
  | {
      type: "export_complete"
      filename: string
      size_bytes: number
      xlsx_base64: string
    }
  | {
      type: "error"
      message: string
      kind: "invalid_input" | "solver_error" | "export_error"
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

// ---------------------------------------------------------------------------
// Streaming export — same event vocabulary as postSolveStream + the two
// extra terminal events. Lets App.tsx reuse SolveProgress panel for both
// Generate and Export, so users see one consistent progress UI.
// ---------------------------------------------------------------------------

const _XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** Decode base64 to Uint8Array. ~2x faster than the atob+charCodeAt loop on
 *  the schedule file sizes we deal with (~10-50KB). */
function _base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Stream an export from /api/export/stream, invoking `onEvent` for every
 * frame. Returns the decoded XLSX `{ blob, filename }` on `export_complete`,
 * or throws on `error` / transport failure.
 *
 * Mirrors postSolveStream's SSE-frame parsing so the same event pump works
 * for both. The buffer-tolerant frame split (`\n\n`) handles mid-chunk reads.
 */
export async function postExportStream(
  body: SolveRequestBody,
  onEvent: (event: SolveEvent) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/export/stream", {
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
    throw new Error(`export stream failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  if (!res.body) {
    throw new Error("export stream failed: response had no body")
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let final: { blob: Blob; filename: string } | null = null
  let errorEvent: { message: string; kind: string } | null = null

  const parseFrame = (frame: string): SolveEvent | null => {
    if (!frame || frame.startsWith(":")) return null // heartbeat / comment
    let dataStr: string | null = null
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) dataStr = line.slice(5).trim()
    }
    if (dataStr === null) return null
    try { return JSON.parse(dataStr) as SolveEvent }
    catch { return null }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sepIdx: number
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIdx)
        buffer = buffer.slice(sepIdx + 2)
        const event = parseFrame(frame)
        if (!event) continue
        onEvent(event)
        if (event.type === "export_complete") {
          const bytes = _base64ToBytes(event.xlsx_base64)
          // BlobPart can be ArrayBuffer or ArrayBufferView; pass the
          // typed-array's underlying buffer to satisfy strict TS configs.
          final = {
            blob: new Blob([bytes.buffer as ArrayBuffer], { type: _XLSX_MIME }),
            filename: event.filename,
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
  if (!final) {
    throw new Error("export stream ended without export_complete")
  }
  return final
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
  /** Path B: full profs deck from the exporting workspace. Older exports
   *  may carry `professor_overrides` instead. */
  professors?: Professor[]
  professor_overrides?: Record<string, Partial<Professor>>
  /** Path B: full rooms deck from the exporting workspace. Older exports
   *  may carry `room_overrides` instead. */
  rooms?: Room[]
  room_overrides?: Record<string, Partial<Room>>
  /** Tuned weights (percent-of-100 from the Tune gear). Written by the
   *  server in solver-shape (time_pref, not the Mix's `time`); callers
   *  translating to Mix must remap `time_pref` → `time`. */
  tunedWeights?: { coverage: number; time_pref: number; overload: number } | null
  exported_at?: string
}

/** One structured validation error from the reader/drift-validator.
 *  Each dropped record produces one entry so the Data Issues panel can list
 *  them clickable (phase 3). Matches the backend shape emitted by
 *  `validate_against_local_data` in `export/excel_reader.py`. */
export interface ValidationError {
  /** Technical sheet name, e.g. `_data_offerings`. */
  sheet: string
  /** 1-based row in that sheet (row 1 is the header). */
  row: number
  /** Header field name the error refers to, e.g. `catalog_id`. */
  column: string
  /** Human-readable detail — safe to render directly in UI copy. */
  reason: string
  /** `error` = record excluded; `warning` = kept but flagged; `info` = notice. */
  severity: "error" | "warning" | "info"
}

export interface ParseDraftResponse {
  state: DraftState
  errors: ValidationError[]
}

/**
 * Upload a Scheduler-exported XLSX to /api/state/parse. Returns the embedded
 * draft state and any validation errors — structured entries for offerings/
 * locks dropped because their catalog_id / prof_id / room_id wasn't recognized
 * locally.
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
