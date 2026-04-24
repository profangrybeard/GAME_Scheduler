"""Generate frontend/public/example-schedule.xlsx — a canned, human-readable
exported schedule that "Resume from Excel" can reload.

Run from repo root:
    py scripts/generate_example_xlsx.py

No solver is invoked. The schedule is hand-picked from the bundled catalog
+ professors + rooms so the file is always in sync with reference data.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from export.excel_writer import DATA_SCHEMA_VERSION, write_excel  # noqa: E402
DATA = REPO_ROOT / "data"
OUT_DIR = REPO_ROOT / "frontend" / "public"


def _load_json(name: str) -> dict | list:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def build_example() -> tuple[dict, dict]:
    catalog = {c["id"]: c for c in _load_json("course_catalog.json")}
    profs   = {p["id"]: p for p in _load_json("professors.json")}
    rooms   = {r["id"]: r for r in _load_json("rooms.json")}

    # Pin a small, plausible week across both day groups and 3 time slots.
    # Each entry: catalog_id, prof_id, room_id, day_group (1=MW, 2=TTh),
    # time_slot, priority, time_pref, affinity_level.
    plan = [
        ("GAME_120", "prof_allen",    "room_263", 2, "2:00PM",  "must_have",   "afternoon",         1),
        ("GAME_220", "prof_dodson",   "room_261", 1, "8:00AM",  "must_have",   "morning",           1),
        ("GAME_256", "prof_dodson",   "room_261", 1, "11:00AM", "must_have",   "morning",           1),
        ("GAME_360", "prof_allen",    "room_263", 1, "11:00AM", "must_have",   "morning",           1),
        ("GAME_405", "prof_avenali",  "room_263", 2, "11:00AM", "must_have",   "morning",           2),
        ("GAME_706", "prof_lindsey",  "room_261", 2, "8:00AM",  "must_have",   "morning",           1),
        ("MOME_130", "prof_spencer",  "room_261", 1, "2:00PM",  "must_have",   "afternoon",         1),
        ("MOME_719", "prof_maloney",  "room_263", 2, "5:00PM",  "should_have", "afternoon_evening", 2),
        ("AI_101",   "prof_imperato", "room_263", 1, "5:00PM",  "must_have",   "afternoon_evening", 2),
    ]

    schedule = []
    for catalog_id, prof_id, room_id, day_group, time_slot, priority, time_pref, affinity in plan:
        course = catalog[catalog_id]
        prof   = profs[prof_id]
        room   = rooms[room_id]
        schedule.append({
            "catalog_id":     catalog_id,
            "section_idx":    0,
            "course_name":    course["name"],
            "department":     course["department"],
            "is_graduate":    course.get("is_graduate", False),
            "prof_id":        prof_id,
            "prof_name":      prof["name"],
            "room_id":        room_id,
            "room_name":      room["name"],
            "priority":       priority,
            "time_pref":      time_pref,
            "affinity_level": affinity,
            "day_group":      day_group,
            "time_slot":      time_slot,
        })

    # Sort to the order _write_schedule_sheet expects (by time slot).
    time_order = {"8:00AM": 0, "11:00AM": 1, "2:00PM": 2, "5:00PM": 3}
    schedule.sort(key=lambda a: (time_order.get(a["time_slot"], 99), a["day_group"], a["catalog_id"]))

    mode_result = {
        "mode":        "balanced",
        "status":      "optimal",
        "objective":   42,
        "schedule":    schedule,
        "unscheduled": [],
        "data":        {"priority_by_cs_key": {}},
    }
    # All three modes share the same schedule in the example — good enough
    # for reload UX; the user can Generate locally to see real per-mode splits.
    results = {
        "quarter": "fall",
        "year":    2026,
        "modes": [
            {**mode_result, "mode": "cover_first"},
            {**mode_result, "mode": "time_pref_first"},
            {**mode_result, "mode": "balanced"},
        ],
    }

    # React-shape offerings for the hidden _data_* sheets — same contract as
    # live exports. Locks pin the course to the slot shown in the schedule.
    offerings = []
    for a in schedule:
        offerings.append({
            "catalog_id":                    a["catalog_id"],
            "priority":                      a["priority"],
            "sections":                      1,
            "override_enrollment_cap":       None,
            "override_preferred_professors": None,
            "notes":                         None,
            "assigned_prof_id":              a["prof_id"],
            "assigned_room_id":              a["room_id"],
            "pinned":                        {"day_group": a["day_group"], "time_slot": a["time_slot"]},
        })

    response_assignments = [{
        "catalog_id":       a["catalog_id"],
        "section_idx":      a["section_idx"],
        "prof_id":          a["prof_id"],
        "room_id":          a["room_id"],
        "day_group":        a["day_group"],
        "time_slot":        a["time_slot"],
        "affinity_level":   a["affinity_level"],
        "time_pref":        a["time_pref"],
    } for a in schedule]

    draft_state = {
        "schema_version": DATA_SCHEMA_VERSION,
        "source":         "example",
        "exported_at":    datetime.now(timezone.utc).isoformat(),
        "quarter":        "fall",
        "year":           2026,
        "solver_mode":    "balanced",
        "offerings":      offerings,
        # Ship the canonical rooms in the example so "Resume from Excel"
        # hydrates the rooms deck with structured-location fields
        # (campus / building / room_number) — matches chair-export shape.
        "rooms":          list(rooms.values()),
        "solver_results": {
            "modes": [
                {"mode": "cover_first",  "assignments": response_assignments},
                {"mode": "time_pref_first", "assignments": response_assignments},
                {"mode": "balanced",        "assignments": response_assignments},
            ],
        },
    }
    return results, draft_state


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results, draft_state = build_example()
    tmp = write_excel(results, OUT_DIR, draft_state=draft_state)
    final = OUT_DIR / "example-schedule.xlsx"
    if tmp != final:
        if final.exists():
            final.unlink()
        tmp.rename(final)
    print(f"wrote {final.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
