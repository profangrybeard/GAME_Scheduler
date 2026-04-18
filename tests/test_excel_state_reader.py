"""Tests for export/excel_reader.py — the reload side of Slice 3.

Round-trips against excel_writer (write a draft state, read it back,
assert equality), exercises every typed exception, and pins the
reference-drift policy (drop + warn, never refuse the file).
"""
from __future__ import annotations

import json
from pathlib import Path

import openpyxl
import pytest

from export.excel_reader import (
    MalformedState,
    MarkerMismatch,
    MissingStateSheet,
    SchemaVersionUnsupported,
    StateReadError,
    read_draft_state,
    validate_against_local_data,
)
from export.excel_writer import (
    STATE_MARKER,
    STATE_SCHEMA_VERSION,
    STATE_SHEET_NAME,
    write_excel,
)


def _minimal_results() -> dict:
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


def _sample_state() -> dict:
    return {
        "schema_version": STATE_SCHEMA_VERSION,
        "exported_at": "2026-04-17T12:00:00",
        "quarter": "fall",
        "year": 2026,
        "offerings": [
            {"catalog_id": "ITGM-220", "priority": "must_have", "sections": 1},
            {"catalog_id": "ITGM-340", "priority": "should_have", "sections": 2},
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


# ---------------------------------------------------------------------------
# Reader — happy path + exceptions
# ---------------------------------------------------------------------------

def test_round_trip_returns_identical_state(tmp_path: Path) -> None:
    original = _sample_state()
    path = write_excel(_minimal_results(), tmp_path, draft_state=original)
    loaded = read_draft_state(path)
    assert loaded == original


def test_read_from_bytes_works(tmp_path: Path) -> None:
    """Streamlit's UploadedFile gives us bytes — must accept that path."""
    path = write_excel(_minimal_results(), tmp_path, draft_state=_sample_state())
    raw = path.read_bytes()
    loaded = read_draft_state(raw)
    assert loaded["quarter"] == "fall"


def test_missing_state_sheet_raises_specific(tmp_path: Path) -> None:
    """Older exports (or non-Scheduler XLSX) have no _state sheet."""
    path = write_excel(_minimal_results(), tmp_path)  # no draft_state passed
    with pytest.raises(MissingStateSheet):
        read_draft_state(path)


def test_marker_mismatch_raises_specific(tmp_path: Path) -> None:
    path = write_excel(_minimal_results(), tmp_path, draft_state=_sample_state())
    # Corrupt the marker in A1 of the _state sheet
    wb = openpyxl.load_workbook(path)
    wb[STATE_SHEET_NAME]["A1"] = "NOT_OUR_MARKER"
    bad = tmp_path / "bad_marker.xlsx"
    wb.save(bad)
    with pytest.raises(MarkerMismatch):
        read_draft_state(bad)


def test_unsupported_schema_version_carries_versions(tmp_path: Path) -> None:
    state = _sample_state()
    state["schema_version"] = STATE_SCHEMA_VERSION + 99
    path = write_excel(_minimal_results(), tmp_path, draft_state=state)
    with pytest.raises(SchemaVersionUnsupported) as exc_info:
        read_draft_state(path)
    assert exc_info.value.found == STATE_SCHEMA_VERSION + 99
    assert exc_info.value.supported == STATE_SCHEMA_VERSION


def test_malformed_json_raises_specific(tmp_path: Path) -> None:
    path = write_excel(_minimal_results(), tmp_path, draft_state=_sample_state())
    wb = openpyxl.load_workbook(path)
    ws = wb[STATE_SHEET_NAME]
    # Wipe valid payload, write garbage that won't parse
    ws.cell(row=2, column=1, value="{not valid json")
    for row in range(3, 10):
        ws.cell(row=row, column=1, value=None)
    bad = tmp_path / "bad_json.xlsx"
    wb.save(bad)
    with pytest.raises(MalformedState):
        read_draft_state(bad)


def test_missing_required_keys_raises_specific(tmp_path: Path) -> None:
    state = _sample_state()
    del state["offerings"]
    path = write_excel(_minimal_results(), tmp_path, draft_state=state)
    with pytest.raises(MalformedState) as exc_info:
        read_draft_state(path)
    assert "offerings" in str(exc_info.value)


def test_all_typed_errors_inherit_state_read_error(tmp_path: Path) -> None:
    """UI code can catch StateReadError as a single net for any failure."""
    path = write_excel(_minimal_results(), tmp_path)  # no _state
    with pytest.raises(StateReadError):
        read_draft_state(path)


# ---------------------------------------------------------------------------
# validate_against_local_data — drift policy
# ---------------------------------------------------------------------------

def test_validate_passes_through_when_all_refs_resolve() -> None:
    state = _sample_state()
    cleaned, warnings = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220", "ITGM-340"},
        prof_ids={"p_001"},
        room_ids={"r_101"},
    )
    assert warnings == []
    assert cleaned["offerings"] == state["offerings"]
    assert cleaned["locked_assignments"] == state["locked_assignments"]


def test_validate_drops_offering_with_unknown_catalog_id() -> None:
    state = _sample_state()
    cleaned, warnings = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220"},  # missing ITGM-340
        prof_ids={"p_001"},
        room_ids={"r_101"},
    )
    assert len(cleaned["offerings"]) == 1
    assert cleaned["offerings"][0]["catalog_id"] == "ITGM-220"
    assert len(warnings) == 1
    assert "ITGM-340" in warnings[0]
    assert "1 of 2 offerings" in warnings[0]


def test_validate_drops_lock_with_unknown_prof() -> None:
    state = _sample_state()
    cleaned, warnings = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220", "ITGM-340"},
        prof_ids=set(),  # p_001 not present
        room_ids={"r_101"},
    )
    assert cleaned["locked_assignments"] == []
    assert len(warnings) == 1
    assert "p_001" in warnings[0]
    assert "professor" in warnings[0]


def test_validate_drops_lock_with_unknown_room() -> None:
    state = _sample_state()
    cleaned, warnings = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220", "ITGM-340"},
        prof_ids={"p_001"},
        room_ids=set(),  # r_101 not present
    )
    assert cleaned["locked_assignments"] == []
    assert len(warnings) == 1
    assert "r_101" in warnings[0]
    assert "room" in warnings[0]


def test_validate_collapses_long_drop_lists() -> None:
    """Don't spam the user — sample first few, summarize the rest."""
    state = _sample_state()
    state["offerings"] = [
        {"catalog_id": f"GHOST-{i:03d}", "priority": "could_have", "sections": 1}
        for i in range(20)
    ]
    cleaned, warnings = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220"},  # none of the GHOSTs match
        prof_ids={"p_001"},
        room_ids={"r_101"},
    )
    assert cleaned["offerings"] == []
    assert len(warnings) == 1
    assert "20" in warnings[0]
    assert "+15 more" in warnings[0]  # 20 dropped, sample 5, +15 more


def test_validate_preserves_all_other_top_level_keys() -> None:
    state = _sample_state()
    state["custom_extension"] = {"future": "field"}
    cleaned, _ = validate_against_local_data(
        state,
        catalog_ids={"ITGM-220", "ITGM-340"},
        prof_ids={"p_001"},
        room_ids={"r_101"},
    )
    assert cleaned["custom_extension"] == {"future": "field"}
    assert cleaned["solver_mode"] == "affinity_first"
    assert cleaned["schema_version"] == STATE_SCHEMA_VERSION
