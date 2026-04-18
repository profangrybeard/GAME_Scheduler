"""Tests for POST /api/export/stream — the SSE streaming export endpoint.

Mirrors test_solve_stream.py: monkeypatches `run_schedule` with a fake that
fires a canned event sequence, then asserts the endpoint emits the expected
SSE frames. Avoids running the real CP-SAT solver (would add ~30s per case).
"""
from __future__ import annotations

import base64
import io
import json
from typing import Callable

import openpyxl
import pytest
from fastapi.testclient import TestClient

from export.excel_writer import STATE_MARKER, STATE_SHEET_NAME


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def client() -> TestClient:
    from api.server import app
    return TestClient(app)


def _minimal_export_body() -> dict:
    return {
        "quarter": "fall",
        "year": 2026,
        "solveMode": "balanced",
        "offerings": [
            {"catalog_id": "GAME_120", "priority": "must_have", "sections": 1},
        ],
        "professorOverrides": {},
        "rooms": [],
    }


def _parse_sse(stream_bytes: bytes) -> list[tuple[str, dict | None]]:
    """Split an SSE byte stream into (event_type, data_dict) tuples."""
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


def _fake_run_schedule_with_progress(progress_events: list[dict]):
    """Build a `run_schedule` stub that fires the given progress events,
    then returns a minimal results dict shaped like the real solver."""
    def _fake(quarter, *, progress_callback: Callable, **kwargs):
        for ev in progress_events:
            progress_callback(ev)
        return {
            "quarter": quarter,
            "year": 2026,
            "modes": [
                {
                    "mode": "balanced", "status": "optimal", "objective": 80,
                    "schedule": [], "unscheduled": [],
                    "data": {"priority_by_cs_key": {}},
                }
            ],
        }
    return _fake


# ---------------------------------------------------------------------------
# Happy-path event sequence
# ---------------------------------------------------------------------------

def test_stream_emits_solve_then_xlsx_then_export_complete(monkeypatch, client):
    """The canonical event order: solve_started → mode_* → solve_complete →
    xlsx_writing → export_complete (terminal)."""
    monkeypatch.setattr(
        "solver.scheduler.run_schedule",
        _fake_run_schedule_with_progress([
            {"type": "mode_started", "mode": "balanced", "index": 1, "total": 1},
            {"type": "mode_complete", "mode": "balanced", "status": "optimal",
             "objective": 80, "n_placed": 1, "n_total": 1, "elapsed_ms": 100,
             "unscheduled_count": 0},
        ]),
    )

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers.get("x-accel-buffering") == "no"
        body = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body) if e[0] != "heartbeat"]
    types = [e[0] for e in events]

    assert types == [
        "solve_started",
        "mode_started",
        "mode_complete",
        "solve_complete",
        "xlsx_writing",
        "export_complete",
    ]


def test_stream_export_complete_carries_decodable_xlsx(monkeypatch, client):
    """`export_complete` must include base64 bytes that decode to a valid
    workbook with the hidden _state sheet (proves end-to-end roundtrip
    capability — the streamed file matches what /api/export produces)."""
    monkeypatch.setattr(
        "solver.scheduler.run_schedule",
        _fake_run_schedule_with_progress([]),
    )

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        body = b"".join(r.iter_bytes())

    events = [e for e in _parse_sse(body) if e[0] not in ("heartbeat",)]
    final = next(e for t, e in events if t == "export_complete")

    assert final["filename"].startswith("schedule_fall_2026_")
    assert final["filename"].endswith(".xlsx")
    assert final["size_bytes"] > 0

    xlsx_bytes = base64.b64decode(final["xlsx_base64"])
    assert len(xlsx_bytes) == final["size_bytes"]

    # Real workbook with the embedded _state sheet?
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
    assert STATE_SHEET_NAME in wb.sheetnames
    assert wb[STATE_SHEET_NAME]["A1"].value == STATE_MARKER


def test_stream_solve_complete_carries_react_shape_modes(monkeypatch, client):
    """The pre-XLSX `solve_complete` event uses the same React shape as
    /api/solve/stream — `mode.assignments` (not `schedule`), no `data`."""
    monkeypatch.setattr(
        "solver.scheduler.run_schedule",
        _fake_run_schedule_with_progress([]),
    )

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        body = b"".join(r.iter_bytes())

    events = [(t, e) for t, e in _parse_sse(body) if t != "heartbeat"]
    sc = next(e for t, e in events if t == "solve_complete")
    for m in sc["modes"]:
        assert "assignments" in m, "modes must use React shape"
        assert "schedule" not in m
        assert "data" not in m


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------

def test_stream_solver_value_error_emits_invalid_input(monkeypatch, client):
    def _raises(*a, **k):
        raise ValueError("bad quarter 'autumn'")
    monkeypatch.setattr("solver.scheduler.run_schedule", _raises)

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        body = b"".join(r.iter_bytes())

    events = [(t, e) for t, e in _parse_sse(body) if t != "heartbeat"]
    err = next(e for t, e in events if t == "error")
    assert err["kind"] == "invalid_input"
    assert "autumn" in err["message"]
    # Terminal — no export_complete after error
    assert not any(t == "export_complete" for t, _ in events)


def test_stream_unexpected_solver_crash_emits_export_error(monkeypatch, client):
    def _crashes(*a, **k):
        raise RuntimeError("solver segfault simulation")
    monkeypatch.setattr("solver.scheduler.run_schedule", _crashes)

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        body = b"".join(r.iter_bytes())

    events = [(t, e) for t, e in _parse_sse(body) if t != "heartbeat"]
    err = next(e for t, e in events if t == "error")
    assert err["kind"] == "export_error"
    assert "segfault" in err["message"]


def test_stream_frames_are_wellformed_sse(monkeypatch, client):
    """Every non-heartbeat frame must have an `event:` line and a JSON-parseable
    `data:` payload (the Vite proxy + CF Access have bitten us on malformed
    frames before — pin this contract)."""
    monkeypatch.setattr(
        "solver.scheduler.run_schedule",
        _fake_run_schedule_with_progress([]),
    )

    with client.stream("POST", "/api/export/stream", json=_minimal_export_body()) as r:
        body = b"".join(r.iter_bytes())

    text = body.decode("utf-8")
    for block in text.split("\n\n"):
        block = block.strip()
        if not block or block.startswith(":"):
            continue
        lines = block.split("\n")
        assert any(L.startswith("event:") for L in lines), f"no event line in: {block!r}"
        data_lines = [L for L in lines if L.startswith("data:")]
        assert len(data_lines) == 1, f"expected exactly one data line in: {block!r}"
        # Must parse as JSON
        json.loads(data_lines[0][len("data:"):].strip())
