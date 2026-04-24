"""Tests for the React <-> solver data adapters (api/adapter.py).

These run without ortools / uvicorn, so they stay fast in CI and catch
shape regressions when the React Offering contract changes.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.adapter import (
    apply_professor_overrides,
    apply_room_overrides,
    react_offerings_to_doc,
    react_pinned_to_solver,
    solver_result_to_react_mode,
    solver_schedule_to_react_assignments,
)


# ---------------------------------------------------------------------------
# react_offerings_to_doc
# ---------------------------------------------------------------------------

def test_react_offerings_to_doc_coalesces_siblings():
    """Flat React rows (one per sibling, `sections: 1`) collapse into one
    solver row per catalog_id with `sections: N`. First sibling's priority/
    overrides win because the Class panel only writes those to sibling #1."""
    react = [
        {
            "catalog_id": "GAME_120",
            "priority": "must_have",
            "sections": 1,
            "override_enrollment_cap": None,
            "override_preferred_professors": None,
            "notes": "first sibling",
            "assigned_prof_id": None,
            "assigned_room_id": None,
            "pinned": {"day_group": 2, "time_slot": "2:00PM"},
            "assignment": None,
        },
        {
            "catalog_id": "GAME_120",
            "priority": "must_have",
            "sections": 1,
            "override_enrollment_cap": None,
            "override_preferred_professors": None,
            "notes": "second sibling",
            "assigned_prof_id": None,
            "assigned_room_id": None,
            "pinned": None,
            "assignment": None,
        },
    ]
    doc = react_offerings_to_doc(react, "fall", 2026)
    assert doc["quarter"] == "fall"
    assert doc["year"] == 2026
    assert len(doc["offerings"]) == 1
    out = doc["offerings"][0]
    assert out["catalog_id"] == "GAME_120"
    assert out["sections"] == 2
    assert out["notes"] == "first sibling"  # first-sibling wins
    # `pinned`/`assignment` are stripped from the offering itself and carried
    # via react_pinned_to_solver instead.
    assert "pinned" not in out
    assert "assignment" not in out


def test_react_offerings_to_doc_singleton():
    doc = react_offerings_to_doc(
        [{"catalog_id": "X_100", "priority": "could_have"}], "fall", 2026,
    )
    assert doc["offerings"][0]["sections"] == 1


def test_react_offerings_to_doc_preserves_order_across_groups():
    react = [
        {"catalog_id": "A", "priority": "must_have"},
        {"catalog_id": "B", "priority": "must_have"},
        {"catalog_id": "A", "priority": "must_have"},
    ]
    doc = react_offerings_to_doc(react, "fall", 2026)
    cids = [o["catalog_id"] for o in doc["offerings"]]
    assert cids == ["A", "B"]  # A seen first, then B
    by_cid = {o["catalog_id"]: o for o in doc["offerings"]}
    assert by_cid["A"]["sections"] == 2
    assert by_cid["B"]["sections"] == 1


# ---------------------------------------------------------------------------
# react_pinned_to_solver
# ---------------------------------------------------------------------------

def test_react_pinned_extracts_only_pinned_offerings():
    react = [
        {"catalog_id": "GAME_120", "pinned": {"day_group": 2, "time_slot": "2:00PM"}},
        {"catalog_id": "MOME_200", "pinned": None},
        {"catalog_id": "AI_300"},
    ]
    pinned = react_pinned_to_solver(react)
    assert len(pinned) == 1
    assert pinned[0] == {
        "cs_key": "GAME_120__0",
        "day_group": 2,
        "time_slot": "2:00PM",
    }


def test_react_pinned_uses_group_index_for_siblings():
    """Second sibling's pinned uses cs_key `${cid}__1`, matching how the
    solver labels sections in react_offerings_to_doc's coalesce."""
    react = [
        {"catalog_id": "GAME_120", "pinned": None},
        {"catalog_id": "GAME_120", "pinned": {"day_group": 1, "time_slot": "8:00AM"}},
        {"catalog_id": "GAME_120", "pinned": {"day_group": 3, "time_slot": "5:00PM"}},
    ]
    pinned = react_pinned_to_solver(react)
    by_key = {p["cs_key"]: p for p in pinned}
    assert len(pinned) == 2
    assert by_key["GAME_120__1"]["time_slot"] == "8:00AM"
    assert by_key["GAME_120__2"]["time_slot"] == "5:00PM"


# ---------------------------------------------------------------------------
# apply_professor_overrides
# ---------------------------------------------------------------------------

def test_apply_professor_overrides_merges_partial():
    base = [
        {"id": "prof_a", "name": "A", "available_quarters": ["fall"]},
        {"id": "prof_b", "name": "B", "available_quarters": ["fall", "winter"]},
    ]
    out = apply_professor_overrides(
        base,
        {"prof_a": {"available_quarters": ["fall", "winter", "spring"]}},
    )
    assert out[0]["available_quarters"] == ["fall", "winter", "spring"]
    assert out[0]["name"] == "A"  # not clobbered
    assert out[1] == base[1]       # unchanged prof passes through


def test_apply_professor_overrides_passthrough_when_empty():
    base = [{"id": "prof_a"}]
    assert apply_professor_overrides(base, None) is base
    assert apply_professor_overrides(base, {}) is base


def test_apply_professor_overrides_ignores_unknown_ids():
    base = [{"id": "prof_a", "name": "A"}]
    out = apply_professor_overrides(base, {"prof_nope": {"name": "X"}})
    assert out == base


# ---------------------------------------------------------------------------
# apply_room_overrides
# ---------------------------------------------------------------------------

def test_apply_room_overrides_filters_offline():
    base = [
        {"id": "room_a", "capacity": 20},
        {"id": "room_b", "capacity": 30},
    ]
    out = apply_room_overrides(base, {"room_a": {"available": False}})
    assert len(out) == 1
    assert out[0]["id"] == "room_b"


def test_apply_room_overrides_merges_patch_fields():
    base = [{"id": "room_a", "capacity": 20, "notes": "old"}]
    out = apply_room_overrides(base, {"room_a": {"notes": "new"}})
    assert out[0]["notes"] == "new"
    assert out[0]["capacity"] == 20  # not clobbered


def test_apply_room_overrides_available_true_kept():
    base = [{"id": "room_a", "capacity": 20}]
    out = apply_room_overrides(base, {"room_a": {"available": True}})
    assert len(out) == 1
    assert out[0]["available"] is True


# ---------------------------------------------------------------------------
# solver_schedule_to_react_assignments
# ---------------------------------------------------------------------------

def test_solver_schedule_to_react_assignments_emits_every_section():
    """Post-PR 2: each (catalog_id, section_idx) becomes its own React
    assignment so sibling offering rows (`${cid}#1`, `#2`, ...) can each
    receive their solver-assigned slot."""
    schedule = [
        {
            "cs_key": "GAME_120__0",
            "catalog_id": "GAME_120",
            "section_idx": 0,
            "prof_id": "prof_allen",
            "room_id": "room_263",
            "day_group": 2,
            "time_slot": "2:00PM",
            "affinity_level": 0,
            "time_pref": "preferred",
        },
        {
            "cs_key": "GAME_120__1",
            "catalog_id": "GAME_120",
            "section_idx": 1,
            "prof_id": "prof_dodson",
            "room_id": "room_261",
            "day_group": 1,
            "time_slot": "8:00AM",
        },
    ]
    assignments = solver_schedule_to_react_assignments(schedule)
    assert len(assignments) == 2
    by_idx = {a["section_idx"]: a for a in assignments}
    assert by_idx[0]["catalog_id"] == "GAME_120"
    assert by_idx[0]["prof_id"] == "prof_allen"
    assert by_idx[0]["time_slot"] == "2:00PM"
    assert by_idx[1]["prof_id"] == "prof_dodson"
    assert by_idx[1]["time_slot"] == "8:00AM"


def test_solver_schedule_to_react_assignments_dedupes_repeated_rows():
    """Guard: if the solver emits two rows for the same (catalog_id,
    section_idx), only the first is kept so the frontend doesn't double-render
    a sibling."""
    schedule = [
        {
            "cs_key": "X__0", "catalog_id": "X", "section_idx": 0,
            "prof_id": "a", "room_id": "r1",
            "day_group": 1, "time_slot": "8:00AM",
        },
        {
            "cs_key": "X__0", "catalog_id": "X", "section_idx": 0,
            "prof_id": "b", "room_id": "r2",
            "day_group": 2, "time_slot": "2:00PM",
        },
    ]
    assignments = solver_schedule_to_react_assignments(schedule)
    assert len(assignments) == 1
    assert assignments[0]["prof_id"] == "a"


# ---------------------------------------------------------------------------
# solver_result_to_react_mode
# ---------------------------------------------------------------------------

def test_solver_result_drops_heavy_data_field():
    result = {
        "mode": "balanced",
        "status": "optimal",
        "objective": 42,
        "schedule": [
            {
                "cs_key": "X__0", "catalog_id": "X", "section_idx": 0,
                "prof_id": "p", "room_id": "r",
                "day_group": 1, "time_slot": "8:00AM",
            },
        ],
        "unscheduled": [{"catalog_id": "Y", "priority": "nice_to_have"}],
        "data": {"lots": "of", "CP_SAT": "artifacts"},  # must not leak to client
    }
    out = solver_result_to_react_mode(result)
    assert "data" not in out
    assert out["mode"] == "balanced"
    assert out["status"] == "optimal"
    assert out["objective"] == 42
    assert len(out["assignments"]) == 1
    assert out["unscheduled"] == [{"catalog_id": "Y", "priority": "nice_to_have"}]
