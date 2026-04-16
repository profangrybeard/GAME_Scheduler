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

export async function postSolve(body: SolveRequestBody): Promise<SolveResponse> {
  const res = await fetch("/api/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`solve failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as SolveResponse
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
