"""Build the CP-SAT model: load data, expand sections, create decision variables.

Usage:
    from solver.model_builder import build_model
    model, data = build_model('fall')
    # model is a cp_model.CpModel, ready for constraints and objective
    # data is a dict with all lookup structures needed by constraints.py / objectives.py

Variable shape
--------------
One BoolVar per (course_section, professor, room, day_group, time_slot) combination
that passes all structural eligibility filters (HC5-HC9 and HC12).

Key: (cs_key, prof_id, room_id, dg, ts)
  cs_key  — "{catalog_id}__{section_index}", e.g. "GAME_256__0"
  prof_id — "prof_dodson"
  room_id — "room_101"
  dg      — int key from DAY_GROUPS (1=MW, 2=TTh)
  ts      — time slot string, e.g. "11:00AM"

Structural filters applied at variable-creation time (no explicit constraints needed)
  HC5  — room capacity >= effective enrollment cap
  HC6  — room type compatible with course required_room_type
  HC7  — professor teaches course's department
  HC8  — professor available this quarter
  HC9  — graduate courses require has_masters or masters_in_progress
  HC12 — day group structure inherent in DAY_GROUPS dimension

override_preferred_professors (from offering) affects affinity scoring in objectives.py
only — it does NOT restrict the eligible professor pool.
"""

import json
from pathlib import Path

from ortools.sat.python import cp_model

from config import (
    TIME_SLOTS, DAY_GROUPS, VALID_QUARTERS, ROOM_COMPATIBILITY,
)

BASE = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _load(path: Path) -> object:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Structural eligibility filters (HC5-HC9)
# ---------------------------------------------------------------------------

def _eligible_professors(
    course: dict,
    professors: list[dict],
    quarter: str,
) -> list[str]:
    """Return IDs of professors eligible to teach this course this quarter.

    Enforces HC7 (teaching_departments), HC8 (available_quarters),
    HC9 (graduate courses require masters credential).
    """
    eligible = []
    for prof in professors:
        if course["department"] not in prof["teaching_departments"]:   # HC7
            continue
        if quarter not in prof.get("available_quarters", []):          # HC8
            continue
        if course["is_graduate"]:                                      # HC9
            if not prof.get("has_masters") and not prof.get("masters_in_progress"):
                continue
        eligible.append(prof["id"])
    return eligible


def _eligible_rooms(course: dict, rooms: list[dict]) -> list[str]:
    """Return IDs of rooms compatible with course room type and enrollment cap.

    Enforces HC5 (room.capacity >= enrollment_cap) and
    HC6 (room type must satisfy ROOM_COMPATIBILITY check).
    """
    required = course.get("required_room_type", "standard")
    compat = ROOM_COMPATIBILITY.get(required, lambda r: True)
    cap = course.get("enrollment_cap", 1)
    return [r["id"] for r in rooms if compat(r) and r["capacity"] >= cap]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_model(quarter: str, mode: str = "balanced", locked: list | None = None, pinned: list | None = None) -> tuple:
    """Load quarterly offerings and catalog, expand sections, build CP-SAT model.

    Parameters
    ----------
    quarter : str
        Must match the quarter field in quarterly_offerings.json.
    mode : str
        Optimization mode — 'affinity_first', 'time_pref_first', or 'balanced'.
        Stored in data dict and read by objectives.py.
    locked : list | None
        Optional list of assignment dicts (each with cs_key, prof_id, room_id,
        day_group, time_slot) that are fixed to 1 as hard constraints. Used by
        the lock-and-tweak re-generate flow in the UI.
    pinned : list | None
        Optional list of dicts (each with cs_key, day_group, time_slot) that
        constrain a section to a specific time slot while letting the solver
        choose professor and room.

    Returns
    -------
    model : cp_model.CpModel
        Empty model (no constraints or objective yet).
    data : dict
        All lookup structures needed by constraints.py and objectives.py.
    """
    if quarter not in VALID_QUARTERS:
        raise ValueError(f"Invalid quarter {quarter!r}. Choose from {VALID_QUARTERS}")

    # --- Load all data files ---
    offerings_doc = _load(BASE / "data" / "quarterly_offerings.json")
    catalog_raw   = _load(BASE / "data" / "course_catalog.json")
    professors    = _load(BASE / "data" / "professors.json")
    rooms         = _load(BASE / "data" / "rooms.json")

    if offerings_doc["quarter"] != quarter:
        raise ValueError(
            f"quarterly_offerings.json is for '{offerings_doc['quarter']}', "
            f"not '{quarter}'"
        )

    # --- Fast lookup dicts ---
    catalog       = {c["id"]: c for c in catalog_raw}
    profs_by_id   = {p["id"]: p for p in professors}
    rooms_by_id   = {r["id"]: r for r in rooms}
    offerings_by_id = {o["catalog_id"]: o for o in offerings_doc["offerings"]}

    # --- Expand offerings into course_sections ---
    # Each section of a multi-section offering is an independent scheduling unit.
    course_sections: list[dict] = []
    for offering in offerings_doc["offerings"]:
        cid = offering["catalog_id"]
        if cid not in catalog:
            print(f"  [warn] catalog_id '{cid}' not in course_catalog — skipping")
            continue
        for sec_idx in range(offering.get("sections", 1)):
            cs_key = f"{cid}__{sec_idx}"
            course_sections.append({
                "catalog_id": cid,
                "section_idx": sec_idx,
                "cs_key": cs_key,
                "course": catalog[cid],
                "offering": offering,
            })

    cs_by_key = {cs["cs_key"]: cs for cs in course_sections}
    priority_by_cs_key = {cs["cs_key"]: cs["offering"]["priority"] for cs in course_sections}

    # --- Compute eligible professors and rooms per course_section ---
    # Sections of the same course share the same eligibility, computed once per catalog_id.
    _profs_cache: dict[str, list[str]] = {}
    _rooms_cache: dict[str, list[str]] = {}

    eligible_profs: dict[str, list[str]] = {}
    eligible_rooms: dict[str, list[str]] = {}

    for cs in course_sections:
        cs_key  = cs["cs_key"]
        cid     = cs["catalog_id"]
        course  = cs["course"]
        offering = cs["offering"]

        # Eligible professors (cached per catalog_id — same for all sections)
        if cid not in _profs_cache:
            _profs_cache[cid] = _eligible_professors(course, professors, quarter)
        eligible_profs[cs_key] = _profs_cache[cid]

        # Eligible rooms respect enrollment-cap and room-type overrides from the offering
        override_key = (
            cid,
            offering.get("override_enrollment_cap"),
            offering.get("override_room_type"),
        )
        if override_key not in _rooms_cache:
            effective = dict(course)
            if offering.get("override_enrollment_cap") is not None:
                effective["enrollment_cap"] = offering["override_enrollment_cap"]
            if offering.get("override_room_type") is not None:
                effective["required_room_type"] = offering["override_room_type"]
            _rooms_cache[override_key] = _eligible_rooms(effective, rooms)
        eligible_rooms[cs_key] = _rooms_cache[override_key]

        if not eligible_profs[cs_key]:
            print(f"  [warn] {cs_key}: no eligible professors — model will be infeasible for this section")
        if not eligible_rooms[cs_key]:
            print(f"  [warn] {cs_key}: no eligible rooms — model will be infeasible for this section")

    # --- Build CP-SAT model and decision variables ---
    model = cp_model.CpModel()
    day_group_keys = list(DAY_GROUPS.keys())   # [1, 2]

    assignments: dict[tuple, cp_model.IntVar] = {}

    for cs in course_sections:
        cs_key = cs["cs_key"]
        for prof_id in eligible_profs[cs_key]:
            for room_id in eligible_rooms[cs_key]:
                for dg in day_group_keys:
                    for ts in TIME_SLOTS:
                        key = (cs_key, prof_id, room_id, dg, ts)
                        # Sanitize ts for variable name (colons not valid in some solvers)
                        ts_safe = ts.replace(":", "")
                        var_name = f"x__{cs_key}__{prof_id}__{room_id}__dg{dg}__{ts_safe}"
                        assignments[key] = model.NewBoolVar(var_name)

    # --- Build index structures for O(1) constraint lookup ---

    vars_by_cs: dict[str, list]        = {cs["cs_key"]: [] for cs in course_sections}
    vars_by_prof_dg_ts: dict[tuple, list] = {}
    vars_by_room_dg_ts: dict[tuple, list] = {}
    vars_by_prof: dict[str, list]      = {p["id"]: [] for p in professors}
    vars_by_cs_dg_ts: dict[tuple, list]   = {}

    for (cs_key, prof_id, room_id, dg, ts), var in assignments.items():
        vars_by_cs[cs_key].append(var)

        k_p = (prof_id, dg, ts)
        vars_by_prof_dg_ts.setdefault(k_p, []).append(var)

        k_r = (room_id, dg, ts)
        vars_by_room_dg_ts.setdefault(k_r, []).append(var)

        vars_by_prof[prof_id].append(var)

        k_cdt = (cs_key, dg, ts)
        vars_by_cs_dg_ts.setdefault(k_cdt, []).append(var)

    # Group cs_keys by catalog_id for HC11 multi-section constraints
    sections_by_catalog_id: dict[str, list[str]] = {}
    for cs in course_sections:
        sections_by_catalog_id.setdefault(cs["catalog_id"], []).append(cs["cs_key"])

    # --- Fix locked assignments to 1 (hard constraints for re-generate) ---
    locked_keys: set[tuple] = set()
    if locked:
        for lock in locked:
            key = (lock["cs_key"], lock["prof_id"], lock["room_id"],
                   lock["day_group"], lock["time_slot"])
            if key in assignments:
                model.Add(assignments[key] == 1)
                locked_keys.add(key)
            else:
                print(f"  [lock] {lock['cs_key']} — combo not in variable set, skipping lock")

    # --- Fix pinned sections to specific time slots ---
    if pinned:
        for pin in pinned:
            cs_key = pin["cs_key"]
            dg = pin["day_group"]
            ts = pin["time_slot"]
            k = (cs_key, dg, ts)
            if k in vars_by_cs_dg_ts:
                model.Add(sum(vars_by_cs_dg_ts[k]) == 1)
                print(f"  [pin] {cs_key} pinned to dg{dg}/{ts}")
            else:
                print(f"  [pin] {cs_key} at dg{dg}/{ts} — no variables available, skipping")

    data = {
        # Identity
        "quarter":            quarter,
        "mode":               mode,
        # Core data
        "assignments":        assignments,
        "course_sections":    course_sections,
        "cs_by_key":          cs_by_key,
        "priority_by_cs_key": priority_by_cs_key,
        "catalog":            catalog,
        "offerings_by_id":    offerings_by_id,
        "professors":         professors,
        "profs_by_id":        profs_by_id,
        "rooms":              rooms,
        "rooms_by_id":        rooms_by_id,
        "eligible_profs":     eligible_profs,
        "eligible_rooms":     eligible_rooms,
        # Dimension keys
        "day_group_keys":     day_group_keys,
        # Index structures
        "vars_by_cs":             vars_by_cs,
        "vars_by_prof_dg_ts":     vars_by_prof_dg_ts,
        "vars_by_room_dg_ts":     vars_by_room_dg_ts,
        "vars_by_prof":           vars_by_prof,
        "vars_by_cs_dg_ts":       vars_by_cs_dg_ts,
        "sections_by_catalog_id": sections_by_catalog_id,
        "locked_keys":            locked_keys,
    }

    return model, data
