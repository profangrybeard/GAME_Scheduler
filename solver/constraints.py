"""Apply all hard constraints to the CP-SAT model.

Call apply_hard_constraints(model, data) after build_model() and before solving.
All constraints are added to the model in-place; nothing is returned.

Hard constraints
----------------
Structural (enforced at variable-creation time in model_builder — no CP-SAT
constraint needed):
  HC5   Room capacity >= enrollment cap
  HC6   Room equipment_tags ⊇ course required_equipment (tag-subset check)
  HC7   Professor must be in teaching_departments for course department
  HC8   Professor must be available this quarter
  HC9   Graduate courses require has_masters or masters_in_progress
  HC12  Day group structure (MW vs TTh) inherent in the dg dimension

Explicit CP-SAT constraints added here:
  HC1   Each course-section assigned at most one (prof, room, dg, ts)
  HC2   A professor teaches at most one class per (dg, ts)
  HC3   A room holds at most one class per (dg, ts)
  HC4   Professor total load <= max_classes (CHAIR_MAX / STANDARD_MAX / OVERLOAD_MAX)
  HC10  must_have course-sections must be assigned (sum == 1)
  HC11  Multi-section courses must use different (dg, ts) slots
"""

from ortools.sat.python import cp_model

from config import STANDARD_MAX, OVERLOAD_MAX, CHAIR_MAX, TIME_SLOTS


def apply_hard_constraints(model: cp_model.CpModel, data: dict) -> None:
    """Add HC1–HC12 to model in-place using pre-built index structures from data."""

    course_sections      = data["course_sections"]
    professors           = data["professors"]
    priority_by_cs_key   = data["priority_by_cs_key"]
    vars_by_cs           = data["vars_by_cs"]
    vars_by_prof_dg_ts   = data["vars_by_prof_dg_ts"]
    vars_by_room_dg_ts   = data["vars_by_room_dg_ts"]
    vars_by_prof         = data["vars_by_prof"]
    vars_by_cs_dg_ts     = data["vars_by_cs_dg_ts"]
    sections_by_catalog_id = data["sections_by_catalog_id"]
    day_group_keys       = data["day_group_keys"]

    # ------------------------------------------------------------------
    # HC1 + HC10: Assignment cardinality per course-section
    #
    # must_have  → exactly one assignment (HC10 forces scheduling)
    # others     → at most one assignment (may be left unscheduled)
    # ------------------------------------------------------------------
    for cs in course_sections:
        cs_key = cs["cs_key"]
        vs = vars_by_cs.get(cs_key, [])
        if not vs:
            continue   # no eligible (prof, room, slot) combos — infeasible by construction
        priority = priority_by_cs_key[cs_key]
        if priority == "must_have":
            model.Add(sum(vs) == 1)    # HC10: must be scheduled
        else:
            model.Add(sum(vs) <= 1)    # HC1: at most one slot

    # ------------------------------------------------------------------
    # HC2: Professor teaches at most one class per (dg, ts)
    # ------------------------------------------------------------------
    for (prof_id, dg, ts), vs in vars_by_prof_dg_ts.items():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)

    # ------------------------------------------------------------------
    # HC3: Room holds at most one class per (dg, ts)
    # ------------------------------------------------------------------
    for (room_id, dg, ts), vs in vars_by_room_dg_ts.items():
        if len(vs) > 1:
            model.Add(sum(vs) <= 1)

    # ------------------------------------------------------------------
    # HC4: Professor total load <= max_classes
    #
    # is_chair     → CHAIR_MAX (2)
    # can_overload → OVERLOAD_MAX (5)
    # default      → STANDARD_MAX (4)
    # ------------------------------------------------------------------
    for prof in professors:
        pid = prof["id"]
        vs = vars_by_prof.get(pid, [])
        if not vs:
            continue
        if prof.get("is_chair"):
            max_load = CHAIR_MAX
        elif prof.get("can_overload"):
            max_load = OVERLOAD_MAX
        else:
            max_load = STANDARD_MAX
        model.Add(sum(vs) <= max_load)

    # ------------------------------------------------------------------
    # HC11: Multi-section courses must use different (dg, ts) slots
    #
    # Students enroll in one section; sections must not overlap so students
    # can actually choose between them.
    # ------------------------------------------------------------------
    for catalog_id, cs_keys in sections_by_catalog_id.items():
        if len(cs_keys) < 2:
            continue
        for dg in day_group_keys:
            for ts in TIME_SLOTS:
                # Collect all assignment vars across every section at this (dg, ts)
                cross_section_vars = []
                for cs_key in cs_keys:
                    cross_section_vars.extend(vars_by_cs_dg_ts.get((cs_key, dg, ts), []))
                if len(cross_section_vars) > 1:
                    model.Add(sum(cross_section_vars) <= 1)
