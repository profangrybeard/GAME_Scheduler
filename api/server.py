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


class SolveRequest(BaseModel):
    quarter: str
    year: int
    solveMode: str = Field("balanced")
    offerings: list[OfferingModel]
    professorOverrides: dict[str, dict] = Field(default_factory=dict)
    roomOverrides: dict[str, dict] = Field(default_factory=dict)


class ExportRequest(BaseModel):
    quarter: str
    year: int
    offerings: list[OfferingModel]
    professorOverrides: dict[str, dict] = Field(default_factory=dict)
    roomOverrides: dict[str, dict] = Field(default_factory=dict)


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
                professors_override=req.professorOverrides,
                rooms_override=req.roomOverrides,
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
            professors_override=req.professorOverrides,
            rooms_override=req.roomOverrides,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        xlsx_path = write_excel(results, out_dir)
        content = xlsx_path.read_bytes()

    filename = f"schedule_{req.quarter}_{req.year}_{datetime.now():%Y%m%d}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
