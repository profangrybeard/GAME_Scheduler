"""Pure data-shape adapters between the React workspace state and the solver.

The React workspace talks in terms of Offering/Professor/Room objects (see
frontend/src/types.ts). The solver expects JSON dicts on disk. These adapters
keep the HTTP layer free of solver-specific assumptions and let us test the
transformations in isolation.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# React → solver
# ---------------------------------------------------------------------------

def react_offerings_to_doc(
    react_offerings: list[dict],
    quarter: str,
    year: int,
) -> dict:
    """Build a quarterly_offerings.json-shaped dict from React's offerings.

    React `Offering` ships `pinned: {day_group, time_slot} | null` as the only
    slot hint (we collapsed `locked` into `pinned` earlier this session).
    The solver reads offerings from disk; we drop `pinned` here and emit the
    slot as a `pinned` solver hint separately via `react_pinned_to_solver()`.
    """
    out_offerings = []
    for o in react_offerings:
        out_offerings.append({
            "catalog_id":  o["catalog_id"],
            "priority":    o["priority"],
            "sections":    o.get("sections", 1),
            "override_enrollment_cap":         o.get("override_enrollment_cap"),
            "override_room_type":              o.get("override_room_type"),
            "override_preferred_professors":   o.get("override_preferred_professors"),
            "notes":                           o.get("notes"),
            "assigned_prof_id":                o.get("assigned_prof_id"),
            "assigned_room_id":                o.get("assigned_room_id"),
        })
    return {"quarter": quarter, "year": year, "offerings": out_offerings}


def react_pinned_to_solver(react_offerings: list[dict]) -> list[dict]:
    """Build solver-shaped `pinned=[{cs_key, day_group, time_slot}]` from React.

    Section 0 of each pinned offering receives the slot hint. Additional
    sections (if sections > 1) are free for the solver to place — matches
    app.py's existing behavior (see app.py:1004-1012).
    """
    pinned = []
    for o in react_offerings:
        p = o.get("pinned")
        if not p:
            continue
        pinned.append({
            "cs_key":     f"{o['catalog_id']}__0",
            "day_group":  p["day_group"],
            "time_slot":  p["time_slot"],
        })
    return pinned


def apply_professor_overrides(
    base_professors: list[dict],
    overrides: dict[str, dict] | None,
) -> list[dict]:
    """Shallow-merge React's per-prof partial overrides onto the canonical
    professors list. Unknown IDs in overrides are ignored.
    """
    if not overrides:
        return base_professors
    out = []
    for p in base_professors:
        patch = overrides.get(p["id"])
        out.append({**p, **patch} if patch else p)
    return out


def apply_room_overrides(
    base_rooms: list[dict],
    overrides: dict[str, dict] | None,
) -> list[dict]:
    """Shallow-merge React's per-room partial overrides. Rooms with
    `available: false` in the override are filtered out — the solver never
    considers them.
    """
    if not overrides:
        return base_rooms
    out = []
    for r in base_rooms:
        patch = overrides.get(r["id"])
        merged = {**r, **patch} if patch else r
        if merged.get("available") is False:
            continue
        out.append(merged)
    return out


# ---------------------------------------------------------------------------
# Solver → React
# ---------------------------------------------------------------------------

def solver_schedule_to_react_assignments(schedule: list[dict]) -> list[dict]:
    """Flatten solver's verbose schedule rows into React-friendly assignment
    records. The React workspace stores one `Assignment` per offering (section
    0); multi-section overflow is on our roadmap, not this plan.
    """
    out: list[dict] = []
    seen_catalog_ids: set[str] = set()
    for row in schedule:
        catalog_id = row["catalog_id"]
        if row.get("section_idx", 0) != 0:
            continue
        if catalog_id in seen_catalog_ids:
            continue
        seen_catalog_ids.add(catalog_id)
        out.append({
            "catalog_id":     catalog_id,
            "section_idx":    row.get("section_idx", 0),
            "prof_id":        row["prof_id"],
            "room_id":        row["room_id"],
            "day_group":      row["day_group"],
            "time_slot":      row["time_slot"],
            "affinity_level": row.get("affinity_level"),
            "time_pref":      row.get("time_pref"),
        })
    return out


def solver_result_to_react_mode(result: dict) -> dict[str, Any]:
    """Reshape a single mode's solver result for the HTTP response. Drops the
    heavyweight `data` field (CP-SAT artifacts) that the export endpoint needs
    internally but the browser doesn't.
    """
    return {
        "mode":        result["mode"],
        "status":      result["status"],
        "objective":   result.get("objective"),
        "assignments": solver_schedule_to_react_assignments(result.get("schedule", [])),
        "unscheduled": [
            {"catalog_id": u["catalog_id"], "priority": u.get("priority")}
            for u in result.get("unscheduled", [])
        ],
    }
