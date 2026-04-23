"""Tests for POST /api/solve/stream — the SSE progress-streaming endpoint.

We monkeypatch solver.scheduler.run_schedule with a fake that invokes
progress_callback with a canned event sequence. That exercises the
queue → async generator → SSE frame plumbing without waiting 30 seconds
for a real CP-SAT solve. A slower end-to-end test is marked so it can
be run explicitly when verifying the full loop.
"""
from __future__ import annotations

import json
from typing import Callable

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def client() -> TestClient:
    from api.server import app
    return TestClient(app)


def _minimal_solve_body() -> dict:
    """A request body the endpoint will accept. The fake `run_schedule`
    monkeypatch ignores the contents — we just need pydantic to validate."""
    return {
        "quarter": "fall",
        "year": 2026,
        "solveMode": "balanced",
        "offerings": [],
        "professors": [],
        "rooms": [],
    }


def _parse_sse(stream_bytes: bytes) -> list[tuple[str, dict | None]]:
    """Split an SSE byte stream into (event_type, data_dict) tuples.
    Heartbeat comment frames (lines starting with ':') are returned as
    ('heartbeat', None) so tests can assert on them too."""
    events: list[tuple[str, dict | None]] = []
    text = stream_bytes.decode("utf-8")
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith(":"):
            events.append(("heartbeat", None))
            continue
        event_type = "message"
        data_str = None
        for line in block.split("\n"):
            if line.startswith("event:"):
                event_type = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_str = line[len("data:"):].strip()
        parsed = json.loads(data_str) if data_str is not None else None
        events.append((event_type, parsed))
    return events


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_stream_emits_ordered_progress_sequence(monkeypatch, client):
    """Verify the canonical event order: solve_started → mode_started →
    solution_found × N → mode_complete → solve_complete."""

    def fake_run_schedule(quarter, *, progress_callback: Callable, **kwargs):
        assert progress_callback is not None, "endpoint must pass a callback"

        progress_callback({"type": "mode_started", "mode": "cover_first", "index": 1, "total": 3})
        progress_callback({
            "type": "solution_found", "mode": "cover_first",
            "objective": 100, "best_bound": 50, "n_placed": 5, "n_total": 10,
            "elapsed_ms": 120, "solution_index": 1,
        })
        progress_callback({
            "type": "solution_found", "mode": "cover_first",
            "objective": 80, "best_bound": 60, "n_placed": 8, "n_total": 10,
            "elapsed_ms": 400, "solution_index": 2,
        })
        progress_callback({
            "type": "mode_complete", "mode": "cover_first",
            "status": "optimal", "objective": 80, "n_placed": 8, "n_total": 10,
            "elapsed_ms": 500, "unscheduled_count": 2,
        })

        return {
            "quarter": quarter,
            "year": 2026,
            "modes": [{
                "mode": "cover_first",
                "status": "optimal",
                "objective": 80,
                "schedule": [],
                "unscheduled": [],
                "data": {"course_sections": [], "offerings_full": [],
                         "cs_by_key": {}, "profs_by_id": {}, "rooms_by_id": {}},
            }],
        }

    monkeypatch.setattr("solver.scheduler.run_schedule", fake_run_schedule)

    with client.stream("POST", "/api/solve/stream", json=_minimal_solve_body()) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers.get("x-accel-buffering") == "no"
        body = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body) if e[0] != "heartbeat"]
    types = [e[0] for e in events]

    assert types == [
        "solve_started",
        "mode_started",
        "solution_found",
        "solution_found",
        "mode_complete",
        "solve_complete",
    ], f"unexpected order: {types}"

    # Spot-check the payloads
    solve_started = events[0][1]
    assert solve_started["quarter"] == "fall"
    assert solve_started["year"] == 2026

    sol_1, sol_2 = events[2][1], events[3][1]
    assert sol_1["objective"] == 100 and sol_2["objective"] == 80
    assert sol_1["solution_index"] == 1 and sol_2["solution_index"] == 2
    assert sol_2["n_placed"] > sol_1["n_placed"]

    complete = events[-1][1]
    assert complete["quarter"] == "fall"
    assert complete["year"] == 2026
    assert len(complete["modes"]) == 1
    assert complete["modes"][0]["mode"] == "cover_first"


def test_stream_surfaces_solver_exception_as_error_event(monkeypatch, client):
    """A raised exception inside run_schedule must arrive as an `error` event,
    NOT as a 500 response — the stream has already committed 200 OK by the
    time the solver runs."""

    def fake_run_schedule(quarter, *, progress_callback, **kwargs):
        progress_callback({"type": "mode_started", "mode": "cover_first", "index": 1, "total": 3})
        raise RuntimeError("simulated solver crash")

    monkeypatch.setattr("solver.scheduler.run_schedule", fake_run_schedule)

    with client.stream("POST", "/api/solve/stream", json=_minimal_solve_body()) as r:
        assert r.status_code == 200
        body = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body) if e[0] != "heartbeat"]
    types = [e[0] for e in events]

    assert "error" in types, f"expected error event, got {types}"
    error_event = next(data for t, data in events if t == "error")
    assert "simulated solver crash" in error_event["message"]
    assert error_event["kind"] == "solver_error"

    # Must NOT emit solve_complete after an error
    assert "solve_complete" not in types


def test_stream_value_error_is_invalid_input(monkeypatch, client):
    """ValueError from the solver (bad input) is distinct from unexpected
    crashes — gets `kind: invalid_input` so the UI can show a friendlier
    message than 'solver crash'."""

    def fake_run_schedule(quarter, *, progress_callback, **kwargs):
        raise ValueError("quarter must be one of fall/winter/spring")

    monkeypatch.setattr("solver.scheduler.run_schedule", fake_run_schedule)

    with client.stream("POST", "/api/solve/stream", json=_minimal_solve_body()) as r:
        body = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body) if e[0] != "heartbeat"]
    error_event = next(data for t, data in events if t == "error")
    assert error_event["kind"] == "invalid_input"
    assert "quarter must be" in error_event["message"]


def test_stream_frames_are_wellformed_sse(monkeypatch, client):
    """Every non-heartbeat block has exactly one `event:` line and one
    `data:` line; data is valid JSON; frames are separated by blank lines."""

    def fake_run_schedule(quarter, *, progress_callback, **kwargs):
        progress_callback({"type": "mode_started", "mode": "balanced", "index": 1, "total": 1})
        return {
            "quarter": quarter,
            "year": 2026,
            "modes": [{
                "mode": "balanced", "status": "optimal", "objective": 0,
                "schedule": [], "unscheduled": [],
                "data": {"course_sections": [], "offerings_full": [],
                         "cs_by_key": {}, "profs_by_id": {}, "rooms_by_id": {}},
            }],
        }

    monkeypatch.setattr("solver.scheduler.run_schedule", fake_run_schedule)

    with client.stream("POST", "/api/solve/stream", json=_minimal_solve_body()) as r:
        body = b"".join(r.iter_bytes()).decode("utf-8")

    blocks = [b for b in body.split("\n\n") if b.strip()]
    for block in blocks:
        if block.startswith(":"):
            continue
        lines = block.split("\n")
        event_lines = [line for line in lines if line.startswith("event:")]
        data_lines = [line for line in lines if line.startswith("data:")]
        assert len(event_lines) == 1, f"expected one event: line in block: {block!r}"
        assert len(data_lines) == 1, f"expected one data: line in block: {block!r}"
        # data must parse as JSON
        json.loads(data_lines[0][len("data:"):].strip())


# ---------------------------------------------------------------------------
# Optional: real CP-SAT integration (slow, ~30s). Skipped by default.
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_stream_real_solver_emits_solutions(client):
    """End-to-end against the real solver + shipped default offerings.
    Verifies that at least one `solution_found` event actually fires — i.e.
    the CpSolverSolutionCallback wiring works, not just the stream plumbing."""
    import json as _json
    from pathlib import Path

    default = Path(__file__).resolve().parent.parent / "data" / "quarterly_offerings.default.json"
    doc = _json.loads(default.read_text(encoding="utf-8"))
    rooms_doc = _json.loads(
        (Path(__file__).resolve().parent.parent / "data" / "rooms.json")
        .read_text(encoding="utf-8")
    )

    offerings = [
        {
            "catalog_id": o["catalog_id"],
            "priority": o.get("priority", "should_have"),
            "sections": o.get("sections", 1),
            "override_enrollment_cap": None,
            "override_room_type": None,
            "override_preferred_professors": None,
            "notes": None,
            "assigned_prof_id": None,
            "assigned_room_id": None,
            "pinned": None,
            "assignment": None,
        }
        for o in doc.get("offerings", [])[:8]  # 8 offerings keeps it under ~5s
    ]

    body = {
        "quarter":    doc.get("quarter", "fall"),
        "year":       doc.get("year", 2026),
        "solveMode":  "balanced",
        "offerings":  offerings,
        "professors": [],
        "rooms":      rooms_doc,
    }

    with client.stream("POST", "/api/solve/stream", json=body, timeout=60) as r:
        body_bytes = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body_bytes) if e[0] != "heartbeat"]
    types = [e[0] for e in events]

    assert "solve_started" in types
    assert "mode_started" in types
    assert "solve_complete" in types
    # Most real solves find at least one feasible solution
    assert types.count("solution_found") >= 1, \
        f"expected >=1 solution_found, saw events: {types}"
