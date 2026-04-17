"""Tests for the hidden _state sheet that lets exported XLSX files be
re-uploaded as a working draft (Slice 2 of the IO additions plan).

We don't run the solver here — `write_excel` accepts a synthetic results
dict with empty schedules so we can exercise the workbook construction +
state-sheet roundtrip in milliseconds.
"""
from __future__ import annotations

import json
from pathlib import Path

import openpyxl
import pytest

from export.excel_writer import (
    STATE_MARKER,
    STATE_SCHEMA_VERSION,
    STATE_SHEET_NAME,
    write_excel,
)


def _minimal_results() -> dict:
    """Smallest results dict that satisfies _write_summary + _write_schedule_sheet."""
    return {
        "quarter": "fall",
        "year": 2026,
        "modes": [
            {
                "mode": "balanced",
                "status": "optimal",
                "objective": 0,
                "schedule": [],
                "unscheduled": [],
                "data": {"priority_by_cs_key": {}},
            }
        ],
    }


def _sample_draft_state() -> dict:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "exported_at": "2026-04-17T12:00:00",
        "quarter": "fall",
        "year": 2026,
        "offerings": [
            {
                "catalog_id": "ITGM-220",
                "priority": "must_have",
                "sections": 1,
                "locked": {"day_group": 1, "time_slot": "8:00 AM"},
            }
        ],
        "locked_assignments": [
            {
                "cs_key": "ITGM-220__0",
                "prof_id": "p_001",
                "room_id": "r_101",
                "day_group": 1,
                "time_slot": "8:00 AM",
            }
        ],
        "solver_mode": "affinity_first",
    }


def test_write_excel_without_draft_state_omits_state_sheet(tmp_path: Path) -> None:
    """Backward-compat: callers that don't pass draft_state get the original
    4-sheet workbook."""
    path = write_excel(_minimal_results(), tmp_path)
    wb = openpyxl.load_workbook(path)
    assert STATE_SHEET_NAME not in wb.sheetnames


def test_state_sheet_is_hidden_and_marker_set(tmp_path: Path) -> None:
    path = write_excel(_minimal_results(), tmp_path, draft_state=_sample_draft_state())
    wb = openpyxl.load_workbook(path)
    assert STATE_SHEET_NAME in wb.sheetnames
    ws = wb[STATE_SHEET_NAME]
    assert ws.sheet_state == "hidden"
    assert ws["A1"].value == STATE_MARKER


def test_state_sheet_roundtrips_draft_state_json(tmp_path: Path) -> None:
    """The whole point of the sheet: write a draft state, read it back exactly."""
    original = _sample_draft_state()
    path = write_excel(_minimal_results(), tmp_path, draft_state=original)
    wb = openpyxl.load_workbook(path)
    ws = wb[STATE_SHEET_NAME]

    # Concatenate every non-empty cell in column A starting at row 2 — the
    # writer chunks payloads >30k chars across multiple rows.
    chunks = []
    row = 2
    while True:
        val = ws.cell(row=row, column=1).value
        if val is None or val == "":
            break
        chunks.append(val)
        row += 1
    payload = "".join(chunks)
    assert payload, "state sheet had no payload below the marker"

    parsed = json.loads(payload)
    assert parsed == original


def test_state_sheet_handles_payload_larger_than_one_cell(tmp_path: Path) -> None:
    """An offerings list big enough to exceed Excel's 32,767-char single-cell
    limit must still roundtrip cleanly via chunking."""
    big_state = _sample_draft_state()
    # ~80k chars of offerings — forces at least 3 chunks at chunk_size=30,000
    big_state["offerings"] = [
        {"catalog_id": f"DUMMY-{i:04d}", "priority": "could_have", "sections": 1, "notes": "x" * 100}
        for i in range(500)
    ]
    path = write_excel(_minimal_results(), tmp_path, draft_state=big_state)
    wb = openpyxl.load_workbook(path)
    ws = wb[STATE_SHEET_NAME]

    chunks = []
    row = 2
    while ws.cell(row=row, column=1).value:
        chunks.append(ws.cell(row=row, column=1).value)
        row += 1
    assert len(chunks) >= 2, f"expected chunking, got {len(chunks)} chunk(s)"
    parsed = json.loads("".join(chunks))
    assert parsed == big_state


def test_summary_sheet_has_metric_column_comments(tmp_path: Path) -> None:
    """The teaching-moment hover comments on Penalty Score / Placed /
    Unscheduled / Must-Have Met must survive the round-trip through openpyxl."""
    path = write_excel(_minimal_results(), tmp_path, draft_state=_sample_draft_state())
    wb = openpyxl.load_workbook(path)
    ws = wb["Summary"]

    # Mode comparison header lives at row 5 (title=1, subtitle=2, blank=3,
    # section header=4, column headers=5). Cols 3-6 are the metric columns.
    for col in (3, 4, 5, 6):
        cell = ws.cell(row=5, column=col)
        assert cell.comment is not None, f"col {col} ({cell.value}) missing comment"
        assert len(cell.comment.text) > 30, f"col {col} comment looks too short"
