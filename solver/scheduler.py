"""Orchestrate 3 CP-SAT solves — one per optimization mode.

Usage:
    from solver.scheduler import run_schedule
    results = run_schedule('fall')
    # results['modes'] is a list of 3 dicts, one per mode

Each mode dict contains:
    mode        — 'affinity_first', 'time_pref_first', or 'balanced'
    status      — 'optimal', 'feasible', 'infeasible', or 'unknown'
    objective   — int penalty score (None if infeasible/unknown)
    schedule    — list of assignment dicts (one per placed course-section)
    unscheduled — list of dicts for sections that could not be placed
    data        — the full data dict from build_model (needed by excel_writer)
"""

from ortools.sat.python import cp_model

from config import MODE_WEIGHTS, DAY_GROUPS, TIME_PREF_MAP, TIME_PREF_PENALTIES, AFFINITY_PENALTIES
from solver.model_builder import build_model
from solver.constraints import apply_hard_constraints
from solver.objectives import build_objective, _affinity_level, _time_pref_penalty


_SOLVER_TIME_LIMIT = 10.0   # seconds per mode

_STATUS_NAMES = {
    cp_model.OPTIMAL:       "optimal",
    cp_model.FEASIBLE:      "feasible",
    cp_model.INFEASIBLE:    "infeasible",
    cp_model.UNKNOWN:       "unknown",
    cp_model.MODEL_INVALID: "model_invalid",
}


# ---------------------------------------------------------------------------
# Result extraction
# ---------------------------------------------------------------------------

def _extract_result(solver: cp_model.CpSolver, raw_status: int, data: dict) -> dict:
    """Build a result dict from a completed solver run."""
    mode   = data["mode"]
    status = _STATUS_NAMES.get(raw_status, "unknown")

    if raw_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "mode":        mode,
            "status":      status,
            "objective":   None,
            "schedule":    [],
            "unscheduled": [
                {
                    "cs_key":     cs["cs_key"],
                    "catalog_id": cs["catalog_id"],
                    "section_idx": cs["section_idx"],
                    "priority":   cs["offering"]["priority"],
                }
                for cs in data["course_sections"]
            ],
            "data": data,
        }

    # Collect all active (value == 1) assignment variables
    schedule   = []
    placed_keys: set[str] = set()

    for (cs_key, prof_id, room_id, dg, ts), var in data["assignments"].items():
        if solver.Value(var) != 1:
            continue

        cs_info = data["cs_by_key"][cs_key]
        course  = cs_info["course"]
        offering = cs_info["offering"]
        prof    = data["profs_by_id"][prof_id]
        room    = data["rooms_by_id"][room_id]

        aff_level = _affinity_level(cs_info, prof_id)
        time_label = _time_label(prof, ts)

        schedule.append({
            "cs_key":       cs_key,
            "catalog_id":   cs_info["catalog_id"],
            "section_idx":  cs_info["section_idx"],
            "course_name":  course["name"],
            "department":   course["department"],
            "is_graduate":  course["is_graduate"],
            "priority":     offering["priority"],
            "prof_id":      prof_id,
            "prof_name":    prof["name"],
            "room_id":      room_id,
            "room_name":    room["name"],
            "day_group":    dg,
            "days":         DAY_GROUPS[dg],
            "time_slot":    ts,
            "affinity_level": aff_level,
            "time_pref":    time_label,
        })
        placed_keys.add(cs_key)

    # Sort schedule by time slot index, then day group
    from config import TIME_SLOTS
    ts_order = {ts: i for i, ts in enumerate(TIME_SLOTS)}
    schedule.sort(key=lambda a: (ts_order[a["time_slot"]], a["day_group"], a["catalog_id"]))

    # Unscheduled sections
    unscheduled = [
        {
            "cs_key":     cs["cs_key"],
            "catalog_id": cs["catalog_id"],
            "section_idx": cs["section_idx"],
            "priority":   cs["offering"]["priority"],
        }
        for cs in data["course_sections"]
        if cs["cs_key"] not in placed_keys
    ]

    return {
        "mode":        mode,
        "status":      status,
        "objective":   int(solver.ObjectiveValue()),
        "schedule":    schedule,
        "unscheduled": unscheduled,
        "data":        data,
    }


def _time_label(prof: dict, ts: str) -> str:
    """Return 'preferred', 'acceptable', or 'not_preferred'."""
    return TIME_PREF_MAP.get((prof["time_preference"], ts), "not_preferred")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_schedule(
    quarter: str,
    locked: list | None = None,
    pinned: list | None = None,
    *,
    offerings_override: dict | None = None,
    professors_override: dict[str, dict] | None = None,
    rooms_override: dict[str, dict] | None = None,
) -> dict:
    """Run 3 CP-SAT solves (one per mode) for the given quarter.

    Parameters
    ----------
    locked : list | None
        Optional list of assignment dicts (cs_key, prof_id, room_id, day_group,
        time_slot) that are pinned as hard constraints in every mode solve.
        Used by the lock-and-tweak re-generate flow.
    pinned : list | None
        Slot-only hints. Section 0 of each catalog_id is typically pinned
        from the React workspace when the user drags a card onto the grid.
    offerings_override, professors_override, rooms_override
        See build_model. When the React workspace calls this via the HTTP
        API, all three are supplied so the solver operates on the user's
        in-memory state without mutating canonical JSON on disk.

    Returns
    -------
    dict with keys:
        quarter  — str
        year     — int (from offerings_override or quarterly_offerings.json)
        modes    — list of 3 result dicts
    """
    import json
    from pathlib import Path

    if offerings_override is not None:
        offerings_doc = offerings_override
    else:
        offerings_doc = json.loads(
            (Path(__file__).resolve().parent.parent / "data" / "quarterly_offerings.json")
            .read_text(encoding="utf-8")
        )
    year = offerings_doc.get("year", 2026)

    mode_results = []
    for mode in MODE_WEIGHTS:
        print(f"\n[{mode}] Building model ...")
        model, data = build_model(
            quarter, mode,
            locked=locked, pinned=pinned,
            offerings_override=offerings_override,
            professors_override=professors_override,
            rooms_override=rooms_override,
        )

        print(f"[{mode}] Applying constraints ...")
        apply_hard_constraints(model, data)

        print(f"[{mode}] Building objective ...")
        build_objective(model, data)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = _SOLVER_TIME_LIMIT
        solver.parameters.num_search_workers  = 0   # use all CPU cores

        print(f"[{mode}] Solving ...")
        raw_status = solver.Solve(model)
        status_name = _STATUS_NAMES.get(raw_status, "unknown")

        result = _extract_result(solver, raw_status, data)
        mode_results.append(result)

        n_sched = len(result["schedule"])
        n_total = len(data["course_sections"])
        obj     = result["objective"]
        print(f"[{mode}] {status_name.upper()} | {n_sched}/{n_total} sections placed | score={obj}")

        if result["unscheduled"]:
            for u in result["unscheduled"]:
                flag = " *** MUST-HAVE UNSCHEDULED ***" if u["priority"] == "must_have" else ""
                print(f"  Unscheduled: {u['cs_key']} ({u['priority']}){flag}")

    return {"quarter": quarter, "year": year, "modes": mode_results}
