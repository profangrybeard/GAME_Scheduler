"""FastAPI bridge between the React workspace and the OR-Tools solver.

Runs locally via uvicorn on port 8765 (invoked from launch_workspace.sh /
run_workspace.bat). The Vite dev server proxies /api/* to here so dev and
prod share the same path.

In the Fly.io production container, this same process also serves the
prebuilt React static bundle (frontend/dist/) at `/` — one port, one service,
same-origin (no CORS needed in prod).

Endpoints
---------
POST /api/solve    — Run 3-mode CP-SAT solve with React's current state.
POST /api/export   — Write an Excel workbook from a prior solve's results.
GET  /api/health   — Liveness check (React uses this to show availability).
GET  /             — React index.html (production only).
GET  /{anything}   — SPA fallback to index.html, or 404 if /api/*.

Not wired
---------
- No streaming / progress events. Solve is synchronous; client sees a spinner.
- No persistence back to disk. React's localStorage remains the source of
  truth for user edits; the solver reads a snapshot per request.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
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


@app.post("/api/solve")
def solve(req: SolveRequest) -> dict:
    """Run the 3-mode solve for the given React state. Returns all three
    mode results; React applies the one matching its current solveMode chip.
    """
    # Lazy import — keeps the `api` module importable for testing without
    # ortools being installed.
    from solver.scheduler import run_schedule

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

    return {
        "quarter": results["quarter"],
        "year":    results["year"],
        "modes":   [solver_result_to_react_mode(m) for m in results["modes"]],
    }


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
