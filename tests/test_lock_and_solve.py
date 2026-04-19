"""Tests for lock-and-tweak re-generate functionality."""
import ast
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import inspect
import pytest
from pathlib import Path
from solver.scheduler import run_schedule
import config

PROJECT_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Import chain + config sanity
# ---------------------------------------------------------------------------

def test_imports():
    """All project modules import cleanly and key callables exist."""
    from solver.model_builder import build_model
    from solver.constraints import apply_hard_constraints
    from solver.objectives import build_objective
    from export.excel_writer import write_excel

    assert callable(build_model)
    assert callable(run_schedule)
    assert callable(apply_hard_constraints)
    assert callable(build_objective)
    assert callable(write_excel)
    assert len(config.TIME_SLOTS) == 4
    assert set(config.DAY_GROUPS.keys()) == {1, 2, 3}
    assert set(config.MODE_WEIGHTS.keys()) == {"affinity_first", "time_pref_first", "balanced"}
    assert list(config.ROOM_COMPATIBILITY.keys())  # non-empty


# ---------------------------------------------------------------------------
# Config room types vs rooms.json
# ---------------------------------------------------------------------------

def test_config_room_types():
    """
    Part A: every room_type in rooms.json must have a ROOM_COMPATIBILITY entry.
    Part B: warn (non-fatal) about required_room_type values in catalog not in config.
    """
    rooms_data   = json.loads((PROJECT_ROOT / "data" / "rooms.json").read_text(encoding="utf-8"))
    catalog_data = json.loads((PROJECT_ROOT / "data" / "course_catalog.json").read_text(encoding="utf-8"))

    config_keys    = set(config.ROOM_COMPATIBILITY.keys())
    physical_types = {r["room_type"] for r in rooms_data if r.get("room_type")}
    uncovered      = physical_types - config_keys
    assert not uncovered, (
        f"room_type(s) in rooms.json missing from ROOM_COMPATIBILITY: {sorted(uncovered)}"
    )

    catalog_required  = {c.get("required_room_type", "standard") for c in catalog_data}
    unknown_in_catalog = catalog_required - config_keys
    if unknown_in_catalog:
        print(
            f"\n[WARN] required_room_type value(s) in catalog not in ROOM_COMPATIBILITY "
            f"(solver falls back to 'any room'): {sorted(unknown_in_catalog)}"
        )


# ---------------------------------------------------------------------------
# Syntax guard
# ---------------------------------------------------------------------------

def test_app_syntax():
    """app.py must parse without SyntaxError."""
    source = (PROJECT_ROOT / "app.py").read_text(encoding="utf-8")
    try:
        ast.parse(source)
    except SyntaxError as e:
        pytest.fail(f"app.py syntax error at line {e.lineno}: {e.msg}")


# ---------------------------------------------------------------------------
# No duplicate function definitions
# ---------------------------------------------------------------------------

def test_no_duplicate_functions():
    """No duplicate function names in app.py, model_builder.py, or scheduler.py."""
    targets = [
        PROJECT_ROOT / "app.py",
        PROJECT_ROOT / "solver" / "model_builder.py",
        PROJECT_ROOT / "solver" / "scheduler.py",
    ]
    failures = []
    for path in targets:
        names = [
            node.name
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]
        seen: set[str] = set()
        dupes = []
        for n in names:
            if n in seen and n not in dupes:
                dupes.append(n)
            seen.add(n)
        if dupes:
            failures.append(f"{path.name}: {dupes}")
    assert not failures, "Duplicate function definitions found:\n" + "\n".join(failures)


def test_run_schedule_has_locked_param():
    sig = inspect.signature(run_schedule)
    assert 'locked' in sig.parameters
    assert sig.parameters['locked'].default is None


def test_basic_solve_returns_three_modes():
    results = run_schedule('fall')
    assert 'modes' in results
    modes = results['modes']
    assert len(modes) == 3
    mode_names = {m['mode'] for m in modes}
    assert mode_names == {'affinity_first', 'time_pref_first', 'balanced'}


def test_each_mode_has_required_keys():
    results = run_schedule('fall')
    for m in results['modes']:
        assert 'mode' in m
        assert 'status' in m
        assert 'schedule' in m
        assert 'unscheduled' in m
        assert m['status'] in ('optimal', 'feasible', 'infeasible', 'unknown')


def test_schedule_assignments_have_required_fields():
    results = run_schedule('fall')
    balanced = next(m for m in results['modes'] if m['mode'] == 'balanced')
    for a in balanced['schedule']:
        for field in ('cs_key', 'prof_id', 'room_id', 'day_group', 'time_slot',
                      'catalog_id', 'course_name', 'prof_name', 'room_name'):
            assert field in a, f"Missing field '{field}' in assignment {a.get('cs_key')}"


def test_lock_preserves_assignments():
    """Locked assignments must appear unchanged in re-solve results."""
    results = run_schedule('fall')
    balanced = next(m for m in results['modes'] if m['mode'] == 'balanced')
    sched = balanced['schedule']
    if len(sched) < 2:
        pytest.skip("Not enough assignments to test locking")

    locked = [
        {k: a[k] for k in ('cs_key', 'prof_id', 'room_id', 'day_group', 'time_slot')}
        for a in sched[:2]
    ]
    results2 = run_schedule('fall', locked=locked)
    balanced2 = next(m for m in results2['modes'] if m['mode'] == 'balanced')
    sched2 = balanced2['schedule']

    for lock in locked:
        matches = [a for a in sched2 if a['cs_key'] == lock['cs_key']]
        assert len(matches) > 0, f"Locked cs_key {lock['cs_key']} missing from re-solve"
        a = matches[0]
        assert a['prof_id'] == lock['prof_id'], f"Prof changed for {lock['cs_key']}"
        assert a['room_id'] == lock['room_id'], f"Room changed for {lock['cs_key']}"
        assert a['day_group'] == lock['day_group'], f"Day group changed for {lock['cs_key']}"
        assert a['time_slot'] == lock['time_slot'], f"Time slot changed for {lock['cs_key']}"


def test_lock_with_none_behaves_like_base_solve():
    """run_schedule(q, locked=None) should behave same as run_schedule(q)."""
    r1 = run_schedule('fall')
    r2 = run_schedule('fall', locked=None)
    assert len(r1['modes']) == len(r2['modes'])
    for m1, m2 in zip(r1['modes'], r2['modes']):
        assert m1['mode'] == m2['mode']
        assert m1['status'] == m2['status']
        assert len(m1['schedule']) == len(m2['schedule'])


def test_eligibility_includes_wrong_dept_profs_at_fallback_tier():
    """HC7 is a soft signal. An out-of-department prof must still appear in
    the eligible pool and be tagged affinity level 3, so must_have sections
    in a department with no roster coverage don't go infeasible."""
    from solver.model_builder import _eligible_professors
    from solver.objectives import _affinity_level

    course_game = {
        "department": "game",
        "is_graduate": False,
        "preferred_professors": [],
    }
    profs = [
        {
            "id": "prof_game",
            "teaching_departments": ["game"],
            "available_quarters": ["fall"],
            "has_masters": True,
        },
        {
            "id": "prof_mome",
            "teaching_departments": ["motion_media"],
            "available_quarters": ["fall"],
            "has_masters": True,
        },
        {
            "id": "prof_offline",
            "teaching_departments": ["game"],
            "available_quarters": ["winter"],
            "has_masters": True,
        },
    ]

    eligible = _eligible_professors(course_game, profs, "fall")
    assert eligible == ["prof_game", "prof_mome"], (
        "HC8-offline prof correctly excluded; HC7 wrong-dept prof included"
    )

    cs_info = {"course": course_game, "offering": {}}
    assert _affinity_level(cs_info, "prof_game", profs[0]) == 2
    assert _affinity_level(cs_info, "prof_mome", profs[1]) == 3, (
        "wrong-department prof must surface at fallback tier (level 3)"
    )


def test_eligibility_still_enforces_grad_credential():
    """HC9 stays hard — a prof without masters / masters-in-progress cannot
    be placed on a graduate course even at the fallback tier."""
    from solver.model_builder import _eligible_professors

    grad_course = {
        "department": "game",
        "is_graduate": True,
        "preferred_professors": [],
    }
    profs = [
        {"id": "prof_ok",      "teaching_departments": ["game"], "available_quarters": ["fall"], "has_masters": True},
        {"id": "prof_undergrad", "teaching_departments": ["game"], "available_quarters": ["fall"], "has_masters": False, "masters_in_progress": False},
    ]
    assert _eligible_professors(grad_course, profs, "fall") == ["prof_ok"]


def test_warm_start_all_three_modes_find_feasible():
    """Regression: at scale, later modes can time out hunting for a first
    feasible because the objective topology doesn't lead CP-SAT there
    quickly. Warm-starting each mode from the previous mode's feasible
    assignment (same hard constraints across modes) gives CP-SAT a free
    first solution. If any mode returns UNKNOWN/INFEASIBLE on the default
    fixture, warm-start has regressed.
    """
    results = run_schedule('fall')
    for m in results['modes']:
        assert m['status'] in ('optimal', 'feasible'), (
            f"mode {m['mode']} returned {m['status']!r} — warm-start should "
            "guarantee first-feasibility for modes 2 and 3"
        )
        assert len(m['schedule']) > 0, (
            f"mode {m['mode']} placed 0 sections — warm-start should have "
            "seeded the full prior assignment"
        )
