"""FastAPI bridge between the React workspace and the OR-Tools solver.

Runs locally via uvicorn on port 8765 (invoked from launch_workspace.sh /
run_workspace.bat). The Vite dev server proxies /api/* to here so dev and
prod share the same path.

In the Fly.io production container, this same process also serves the
prebuilt React static bundle (frontend/dist/) at `/` — one port, one service,
same-origin (no CORS needed in prod).

Endpoints
---------
POST /api/solve/stream  — Run the 3-mode CP-SAT solve and stream progress as
                          Server-Sent Events. Each improving CP-SAT solution
                          emits a `solution_found` event; final `solve_complete`
                          carries the full result payload. No blocking variant
                          exists — the streaming endpoint IS the solve path.
POST /api/export        — Write an Excel workbook from a prior solve's results.
                          The file embeds veryHidden _data_* sheets so it can
                          be re-uploaded later via /api/state/parse.
POST /api/export/stream — Same as /api/export but streams progress via SSE.
                          Reuses the React workspace's SolveProgress panel
                          (same event vocabulary as /api/solve/stream) plus
                          two new events: `xlsx_writing` and `export_complete`
                          (carries the .xlsx as base64 — client decodes and
                          triggers a browser download).
POST /api/state/parse   — Read a previously exported XLSX, return the embedded
                          draft state (offerings + locks + mode + last solver
                          output) for the React workspace to hydrate from.
GET  /api/health        — Liveness check (React uses this to show availability).
GET  /                  — React index.html (production only).
GET  /{anything}        — SPA fallback to index.html, or 404 if /api/*.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api.adapter import (
    apply_professor_overrides,
    apply_room_overrides,
    react_offerings_to_doc,
    react_pinned_to_solver,
    solver_result_to_react_mode,
)
from export.excel_writer import DATA_SCHEMA_VERSION


def _embedded_solver_results(results: dict | None) -> dict | None:
    """Reshape solver_results for embedding in the _data_solver_results sheet.

    Two responsibilities folded into one:
      1. Strip the per-mode `data` field — CP-SAT decision vars + tuple-keyed
         indexes aren't JSON-encodable.
      2. Convert each mode to React shape (schedule → assignments) so the
         frontend's reload reducer can consume it without a separate adapter.
         The streaming /api/solve/stream endpoint applies the same conversion;
         keeping the embedded format identical means React reads one shape
         everywhere.

    The visible-sheet writer (excel_writer.write_excel) still receives the
    full, untransformed results via its first arg — only this embedded copy
    is reshaped.
    """
    if not results:
        return results
    return {
        **results,
        "modes": [solver_result_to_react_mode(m) for m in results.get("modes", [])],
    }

BASE = Path(__file__).resolve().parent.parent

app = FastAPI(title="GAME Scheduler API", version="0.1.0")

# The Vite dev server (5174) and the GH Pages static build both talk to us
# across origins. In production, proxy handles same-origin, but dev needs CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SlotModel(BaseModel):
    day_group: int
    time_slot: str


class AssignmentModel(BaseModel):
    prof_id: str
    room_id: str
    slot: SlotModel


class OfferingModel(BaseModel):
    catalog_id: str
    priority: str
    sections: int = 1
    override_enrollment_cap: int | None = None
    override_room_type: str | None = None
    override_preferred_professors: list[str] | None = None
    notes: str | None = None
    assigned_prof_id: str | None = None
    assigned_room_id: str | None = None
    pinned: SlotModel | None = None
    assignment: AssignmentModel | None = None


class TunedWeightsModel(BaseModel):
    """User-tuned weight vector for the 'balanced' (Tune) mode. Same shape as
    the entries in config.MODE_WEIGHTS, so the solver can swap it in directly.
    Carried as percent-of-100 from the gear UI; the solver uses these as raw
    coefficients (relative magnitude is what matters)."""
    affinity:  int
    time_pref: int
    overload:  int


class SolveRequest(BaseModel):
    quarter: str
    year: int
    solveMode: str = Field("balanced")
    offerings: list[OfferingModel]
    # Full professors + rooms decks, Path B (not patches). The frontend keeps
    # the whole lists in localStorage; solver uses them verbatim instead of
    # merging onto disk. Each chair's deck IS the truth.
    professors: list[dict] = Field(default_factory=list)
    rooms: list[dict] = Field(default_factory=list)
    # When provided, replaces MODE_WEIGHTS["balanced"] for this run only.
    # The other two modes (affinity_first, time_pref_first) stay canonical.
    tunedWeights: TunedWeightsModel | None = None


class ExportRequest(BaseModel):
    quarter: str
    year: int
    # Carried into the embedded _state so reload restores the user's mode pick.
    solveMode: str = Field("balanced")
    offerings: list[OfferingModel]
    professors: list[dict] = Field(default_factory=list)
    rooms: list[dict] = Field(default_factory=list)
    tunedWeights: TunedWeightsModel | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "game-scheduler-api"}


# ---------------------------------------------------------------------------
# SSE streaming solve
# ---------------------------------------------------------------------------

# Heartbeat cadence. Cloudflare closes idle proxied HTTP connections around
# 100s; a comment frame every 15s keeps the stream alive through CF Access
# and any reverse proxy we sit behind. Comments start with ':' and are
# ignored by EventSource / our fetch-stream consumer.
_SSE_HEARTBEAT_SECONDS = 15.0

# Sentinel that the solver-thread pushes onto the event queue when done.
# A distinct object reference so we don't collide with any legitimate event.
_STREAM_END = object()


def _sse_frame(event_type: str, payload: dict) -> str:
    """Format a single SSE frame. `event:` lets the client dispatch by type
    without parsing the JSON first; `data:` carries the payload."""
    return f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"


@app.post("/api/solve/stream")
async def solve_stream(req: SolveRequest) -> StreamingResponse:
    """Stream solver progress as Server-Sent Events.

    Event sequence:
        solve_started   once, before the first mode runs
        mode_started    once per mode (3x)
        solution_found  zero or more per mode — one per improving CP-SAT solution
        mode_complete   once per mode
        solve_complete  once, terminal, carries the full result payload
        error           once, terminal, on any unhandled solver exception

    Transport: POST so the large request body fits (EventSource is GET-only).
    Client consumes via fetch() + ReadableStream.
    """
    from solver.scheduler import run_schedule

    react_offerings = [o.model_dump() for o in req.offerings]

    # queue.Queue is thread-safe and unbounded: solver pushes from its
    # worker thread, async generator drains from the event loop.
    event_queue: queue.Queue = queue.Queue()

    def progress_cb(event: dict) -> None:
        event_queue.put(event)

    def run_solver_in_thread() -> None:
        """Body that runs inside asyncio's default thread pool executor.
        Produces either a `solve_complete` or `error` event, then the sentinel
        to signal the drainer to finish."""
        try:
            results = run_schedule(
                req.quarter,
                pinned=react_pinned_to_solver(react_offerings),
                offerings_override=react_offerings_to_doc(
                    react_offerings, req.quarter, req.year,
                ),
                professors=req.professors,
                rooms=req.rooms,
                tuned_weights=(req.tunedWeights.model_dump()
                               if req.tunedWeights else None),
                progress_callback=progress_cb,
            )
            event_queue.put({
                "type": "solve_complete",
                "quarter": results["quarter"],
                "year":    results["year"],
                "modes":   [solver_result_to_react_mode(m) for m in results["modes"]],
            })
        except ValueError as e:
            event_queue.put({"type": "error", "message": str(e), "kind": "invalid_input"})
        except Exception as e:  # noqa: BLE001 — solver crashes must not kill the app
            event_queue.put({"type": "error", "message": str(e), "kind": "solver_error"})
        finally:
            event_queue.put(_STREAM_END)

    # Sentinel-returning wrapper so the executor thread unblocks on its
    # own when no event arrives. Doing the timeout here rather than via
    # asyncio.wait_for avoids orphan queue.get() calls pinning executor
    # threads after a heartbeat tick.
    def _next_event_or_heartbeat():
        try:
            return event_queue.get(timeout=_SSE_HEARTBEAT_SECONDS)
        except queue.Empty:
            return None

    async def event_generator():
        loop = asyncio.get_running_loop()
        solver_task = loop.run_in_executor(None, run_solver_in_thread)

        # Open the stream with a handshake the client can latch onto.
        yield _sse_frame("solve_started", {
            "quarter": req.quarter,
            "year":    req.year,
            "n_offerings": len(react_offerings),
        })

        try:
            while True:
                event = await loop.run_in_executor(None, _next_event_or_heartbeat)

                if event is None:
                    yield ": heartbeat\n\n"
                    continue

                if event is _STREAM_END:
                    break

                event_type = event.get("type", "message")
                yield _sse_frame(event_type, event)
        finally:
            # Make sure the solver thread has actually returned before we
            # tear down the response — otherwise an exception inside it
            # can leak silently.
            try:
                await solver_task
            except Exception:  # noqa: BLE001 — already surfaced via 'error' event
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            # Disable proxy buffering so events flush immediately, not in
            # whatever chunk size the proxy prefers. Nginx honors this via
            # X-Accel-Buffering; CF/Fly both respect Cache-Control: no-cache
            # and Connection: keep-alive for streaming responses.
            "Cache-Control":     "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


@app.post("/api/export")
def export(req: ExportRequest) -> Response:
    """Run the solver and write an Excel workbook. Returns the .xlsx file as
    a streamed download. We re-run the solve server-side so the file reflects
    the exact state the user is exporting (avoids trust issues where the
    client sends stale / tampered solver output).

    Embeds the user's draft state in a hidden `_state` sheet so the file
    can be re-uploaded later via POST /api/state/parse to resume editing.
    """
    from solver.scheduler import run_schedule
    from export.excel_writer import write_excel

    react_offerings = [o.model_dump() for o in req.offerings]

    try:
        results = run_schedule(
            req.quarter,
            pinned=react_pinned_to_solver(react_offerings),
            offerings_override=react_offerings_to_doc(
                react_offerings, req.quarter, req.year,
            ),
            professors=req.professors,
            rooms=req.rooms,
            tuned_weights=(req.tunedWeights.model_dump()
                           if req.tunedWeights else None),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # Compose the roundtrip draft state. Offerings are kept in React shape
    # (rather than translated to the solver-doc shape) so reload can hydrate
    # SchedulerState directly without an inverse adapter. The `source` field
    # discriminates this from Streamlit-exported files (which embed Streamlit
    # offerings shape) — readers can branch on it if/when they need to.
    draft_state = {
        "schema_version":     DATA_SCHEMA_VERSION,
        "exported_at":        datetime.now().isoformat(timespec="seconds"),
        "source":             "react",
        "quarter":            req.quarter,
        "year":               req.year,
        "solver_mode":        req.solveMode,
        "offerings":          react_offerings,
        "professors":         req.professors,
        "rooms":              req.rooms,
        "tunedWeights":       (req.tunedWeights.model_dump()
                               if req.tunedWeights else None),
        "solver_results":     _embedded_solver_results(results),
    }

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        xlsx_path = write_excel(
            results, out_dir, draft_state=draft_state, backup_root=BASE,
        )
        content = xlsx_path.read_bytes()

    filename = f"schedule_{req.quarter}_{req.year}_{datetime.now():%Y%m%d}_all-modes.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# SSE streaming export — same shape as /api/solve/stream so React can reuse
# the SolveProgress panel for the Generate AND the Export user flow.
# ---------------------------------------------------------------------------

@app.post("/api/export/stream")
async def export_stream(req: ExportRequest) -> StreamingResponse:
    """Stream a re-solve + XLSX build as Server-Sent Events.

    Event sequence (extends /api/solve/stream with two new terminal events):
        solve_started   once, before the first mode runs
        mode_started    once per mode (3x)
        solution_found  zero or more per mode — one per improving CP-SAT solution
        mode_complete   once per mode
        solve_complete  once, carries the full result payload
        xlsx_writing    once, after solve_complete, while we serialize the workbook
        export_complete once, terminal — carries `filename` + `xlsx_base64`
                        (the .xlsx bytes; client decodes and triggers download)
        error           once, terminal, on any unhandled exception

    Heavy duplication of /api/solve/stream's plumbing is intentional —
    extracting a shared helper would couple two endpoints whose event
    vocabularies will likely diverge over time.
    """
    from solver.scheduler import run_schedule
    from export.excel_writer import write_excel
    import base64 as _b64

    react_offerings = [o.model_dump() for o in req.offerings]
    event_queue: queue.Queue = queue.Queue()

    def progress_cb(event: dict) -> None:
        event_queue.put(event)

    def run_solver_and_write_in_thread() -> None:
        try:
            results = run_schedule(
                req.quarter,
                pinned=react_pinned_to_solver(react_offerings),
                offerings_override=react_offerings_to_doc(
                    react_offerings, req.quarter, req.year,
                ),
                professors=req.professors,
                rooms=req.rooms,
                tuned_weights=(req.tunedWeights.model_dump()
                               if req.tunedWeights else None),
                progress_callback=progress_cb,
            )
            event_queue.put({
                "type":    "solve_complete",
                "quarter": results["quarter"],
                "year":    results["year"],
                "modes":   [solver_result_to_react_mode(m) for m in results["modes"]],
            })

            # Same draft_state composition as POST /api/export so reload of an
            # SSE-exported file produces an identical result.
            draft_state = {
                "schema_version":     DATA_SCHEMA_VERSION,
                "exported_at":        datetime.now().isoformat(timespec="seconds"),
                "source":             "react",
                "quarter":            req.quarter,
                "year":               req.year,
                "solver_mode":        req.solveMode,
                "offerings":          react_offerings,
                "professors":         req.professors,
                "rooms":              req.rooms,
                "tunedWeights":       (req.tunedWeights.model_dump()
                                       if req.tunedWeights else None),
                "solver_results":     _embedded_solver_results(results),
            }

            event_queue.put({"type": "xlsx_writing"})

            with tempfile.TemporaryDirectory() as tmp:
                xlsx_path = write_excel(
                    results, Path(tmp), draft_state=draft_state, backup_root=BASE,
                )
                content = xlsx_path.read_bytes()

            filename = f"schedule_{req.quarter}_{req.year}_{datetime.now():%Y%m%d}_all-modes.xlsx"
            event_queue.put({
                "type":        "export_complete",
                "filename":    filename,
                "size_bytes":  len(content),
                # Base64 keeps the SSE frame text-safe. ~33% bloat on top of
                # ~10-50KB schedule files = ~14-66KB frames. Single SSE frame
                # is fine; revisit only if export sizes balloon.
                "xlsx_base64": _b64.b64encode(content).decode("ascii"),
            })
        except ValueError as e:
            event_queue.put({"type": "error", "message": str(e), "kind": "invalid_input"})
        except Exception as e:  # noqa: BLE001 — must not kill the app
            event_queue.put({"type": "error", "message": str(e), "kind": "export_error"})
        finally:
            event_queue.put(_STREAM_END)

    def _next_event_or_heartbeat():
        try:
            return event_queue.get(timeout=_SSE_HEARTBEAT_SECONDS)
        except queue.Empty:
            return None

    async def event_generator():
        loop = asyncio.get_running_loop()
        worker_task = loop.run_in_executor(None, run_solver_and_write_in_thread)

        yield _sse_frame("solve_started", {
            "quarter":     req.quarter,
            "year":        req.year,
            "n_offerings": len(react_offerings),
        })

        try:
            while True:
                event = await loop.run_in_executor(None, _next_event_or_heartbeat)
                if event is None:
                    yield ": heartbeat\n\n"
                    continue
                if event is _STREAM_END:
                    break
                event_type = event.get("type", "message")
                yield _sse_frame(event_type, event)
        finally:
            try:
                await worker_task
            except Exception:  # noqa: BLE001 — already surfaced via 'error'
                pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Resume from Excel — parse uploaded XLSX, return embedded draft state
# ---------------------------------------------------------------------------

import functools as _functools
import zipfile as _zipfile

from fastapi import File, UploadFile


@_functools.lru_cache(maxsize=1)
def _local_reference_ids() -> tuple[set[str], set[str], set[str]]:
    """Cache catalog/professor/room IDs for cross-machine drift validation.

    Loaded once at first call; data files don't change at runtime in the
    Fly.io container. Test runs that mutate these files would need to
    `_local_reference_ids.cache_clear()` between cases.
    """
    catalog = json.loads((BASE / "data" / "course_catalog.json").read_text())
    profs   = json.loads((BASE / "data" / "professors.json").read_text())
    rooms   = json.loads((BASE / "data" / "rooms.json").read_text())
    return (
        {c["id"] for c in catalog},
        {p["id"] for p in profs},
        {r["id"] for r in rooms},
    )


@app.post("/api/state/parse")
async def parse_state(file: UploadFile = File(...)) -> dict:
    """Parse a Scheduler-exported XLSX and return the embedded draft state.

    Returns:
        ``{"state": <cleaned draft state>, "errors": [<validation errors>]}``

        Each error is a dict ``{sheet, row, column, reason, severity}`` —
        one entry per dropped record. The Data Issues panel renders these
        as clickable entries pointing at the offending sheet row.

    Status codes:
        200 — parsed OK. ``errors`` may be non-empty if local catalog/
              profs/rooms don't recognize some referenced IDs (orphaned
              offerings/locks are dropped from the returned state).
        400 — uploaded file isn't a valid Excel workbook
        422 — file is XLSX but doesn't contain readable Scheduler draft state
              (missing _data_meta sheet, wrong marker, unsupported schema version,
              or malformed JSON). Detail copy is user-facing — surface it.
    """
    from export.excel_reader import (
        MalformedState,
        MarkerMismatch,
        MissingStateSheet,
        SchemaVersionUnsupported,
        StateReadError,
        read_draft_state,
        validate_against_local_data,
    )

    raw = await file.read()

    try:
        state = read_draft_state(raw)
    except _zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Not a valid Excel file.")
    except MissingStateSheet:
        raise HTTPException(
            status_code=422,
            detail=(
                "This Excel was exported by an older Scheduler build, "
                "or isn't a Scheduler export."
            ),
        )
    except MarkerMismatch:
        raise HTTPException(
            status_code=422,
            detail="This Excel doesn't look like a GAME Scheduler export.",
        )
    except SchemaVersionUnsupported as e:
        raise HTTPException(
            status_code=422,
            detail=(
                f"This Excel was exported by a newer Scheduler "
                f"(state v{e.found}, this build supports v{e.supported}). "
                f"Update the app and try again."
            ),
        )
    except MalformedState as e:
        raise HTTPException(
            status_code=422,
            detail=f"Draft state is corrupted: {e}",
        )
    except StateReadError as e:
        # Defensive fallback for any future StateReadError subclass we add
        # without remembering to update this handler.
        raise HTTPException(status_code=422, detail=f"Could not read Excel: {e}")

    catalog_ids, prof_ids, room_ids = _local_reference_ids()
    cleaned, errors = validate_against_local_data(
        state,
        catalog_ids=catalog_ids,
        prof_ids=prof_ids,
        room_ids=room_ids,
    )

    return {"state": cleaned, "errors": errors}


# ---------------------------------------------------------------------------
# Static React bundle (production)
# ---------------------------------------------------------------------------
# In dev, the Vite server serves the UI on :5174 and proxies /api/* here.
# In the Fly.io container, this same process also serves the prebuilt React
# bundle so there's one origin and no CORS. The Dockerfile copies the Vite
# output to frontend/dist; FRONTEND_DIST env var can override for tests.

FRONTEND_DIST = Path(
    os.environ.get("FRONTEND_DIST", BASE / "frontend" / "dist")
)

if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
    # Vite hashes everything under /assets/* — safe to serve with long cache.
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    # Top-level static files the build drops next to index.html (favicon etc.).
    @app.get("/favicon.svg", include_in_schema=False)
    def _favicon() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "favicon.svg")

    @app.get("/icons.svg", include_in_schema=False)
    def _icons() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "icons.svg")

    # SPA fallback. Any unmatched GET returns index.html so client-side
    # routing can take over. /api/* routes are already registered above and
    # take precedence; this catch-all never hijacks them.
    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(FRONTEND_DIST / "index.html")


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------

def run_dev() -> None:
    """Entry point for uvicorn when spawned from the local launcher scripts."""
    import uvicorn

    uvicorn.run(
        "api.server:app",
        host="127.0.0.1",
        port=8765,
        reload=False,
    )


if __name__ == "__main__":
    run_dev()
