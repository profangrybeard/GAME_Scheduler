"""Build the weighted penalty objective function for the CP-SAT model.

Call build_objective(model, data) after apply_hard_constraints() and before solving.
Sets model.Minimize(total_weighted_penalty) in-place.

Soft objectives
---------------
  SO1  Affinity penalty    — how well prof specializations match course tags
  SO2  Time-pref penalty   — how well time slot matches prof time_preference
  SO3  Overload penalty    — penalty if prof teaches > STANDARD_MAX sections
  SO4  should_have drop    — penalty if a should_have section goes unscheduled
  SO5  could_have drop     — penalty if a could_have section goes unscheduled

Affinity levels
---------------
  0  Professor is in offering.override_preferred_professors  → AFFINITY_PENALTIES[0] = 0
  1  Professor is in course.preferred_professors             → AFFINITY_PENALTIES[1] = 1
  2  Professor eligible but not in either preferred list     → AFFINITY_PENALTIES[2] = 3

Mode weights (from config.MODE_WEIGHTS)
---------------------------------------
  affinity_first  : affinity*10  time_pref*1   overload*2
  time_pref_first : affinity*1   time_pref*10  overload*2
  balanced        : affinity*10  time_pref*4   overload*3   (expert-leaning)

Drop penalties are NOT mode-weighted — they reflect schedule completeness, not quality.
"""

from ortools.sat.python import cp_model

from config import (
    AFFINITY_PENALTIES, TIME_PREF_MAP, TIME_PREF_PENALTIES,
    OVERLOAD_PENALTY, SHOULD_HAVE_DROP_PENALTY, COULD_HAVE_DROP_PENALTY,
    MODE_WEIGHTS, STANDARD_MAX,
)


# ---------------------------------------------------------------------------
# Per-variable penalty helpers
# ---------------------------------------------------------------------------

def _affinity_level(cs_info: dict, prof_id: str) -> int:
    """Return affinity level (0, 1, or 2) for a professor-course pairing."""
    override = set(cs_info["offering"].get("override_preferred_professors") or [])
    preferred = set(cs_info["course"].get("preferred_professors") or [])
    if override and prof_id in override:
        return 0
    if prof_id in preferred:
        return 1
    return 2


def _time_pref_penalty(prof: dict, ts: str) -> int:
    """Return time preference penalty for assigning prof to time slot ts."""
    label = TIME_PREF_MAP.get((prof["time_preference"], ts), "not_preferred")
    return TIME_PREF_PENALTIES[label]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_objective(
    model: cp_model.CpModel,
    data: dict,
    *,
    tuned_weights: dict | None = None,
) -> None:
    """Compute weighted penalty and call model.Minimize().

    Adds auxiliary IntVars for overload and drop tracking; does not add
    any hard constraints beyond what is needed for penalty computation.

    Parameters
    ----------
    tuned_weights : dict | None
        When supplied, replaces MODE_WEIGHTS[mode]. Same shape as a
        MODE_WEIGHTS entry: {affinity, time_pref, overload}. Used by the
        "Tune" UI in the React workspace; only the caller (run_schedule)
        decides which modes the override applies to.
    """
    mode    = data.get("mode", "balanced")
    weights = tuned_weights if tuned_weights is not None else MODE_WEIGHTS[mode]
    w_aff   = weights["affinity"]
    w_time  = weights["time_pref"]
    w_over  = weights["overload"]

    assignments   = data["assignments"]
    course_sections = data["course_sections"]
    cs_by_key     = data["cs_by_key"]
    professors    = data["professors"]
    profs_by_id   = data["profs_by_id"]
    vars_by_cs    = data["vars_by_cs"]
    vars_by_prof  = data["vars_by_prof"]

    obj_vars:  list = []
    obj_coefs: list = []

    # ------------------------------------------------------------------
    # SO1 + SO2: Per-assignment affinity and time-preference penalties
    # Both are constants (determined by which variable is chosen), so they
    # become linear coefficients on the BoolVar.
    # ------------------------------------------------------------------
    for (cs_key, prof_id, room_id, dg, ts), var in assignments.items():
        cs_info = cs_by_key[cs_key]
        prof    = profs_by_id[prof_id]

        aff_pen  = AFFINITY_PENALTIES.get(_affinity_level(cs_info, prof_id),
                                           AFFINITY_PENALTIES["other"])
        time_pen = _time_pref_penalty(prof, ts)

        coef = w_aff * aff_pen + w_time * time_pen
        if coef != 0:
            obj_vars.append(var)
            obj_coefs.append(int(coef))

    # ------------------------------------------------------------------
    # SO3: Overload penalty
    # For each professor, create an IntVar tracking assignments beyond
    # STANDARD_MAX. Minimizing the objective drives it to max(0, load - MAX).
    # ------------------------------------------------------------------
    for prof in professors:
        pid = prof["id"]
        vs  = vars_by_prof.get(pid, [])
        if not vs:
            continue

        # Chairs are hard-capped at CHAIR_MAX (HC4); no overload concept.
        if prof.get("is_chair"):
            continue

        # Professors who cannot overload are hard-capped at STANDARD_MAX (HC4);
        # the constraint already prevents over-assignment, so no soft penalty.
        if not prof.get("can_overload"):
            continue

        # This professor can overload. Create a soft penalty for doing so.
        # overload_var >= prof_load - STANDARD_MAX, overload_var >= 0
        # Minimizing the objective will drive overload_var to max(0, load - STANDARD_MAX).
        max_possible_overload = len(vs) - STANDARD_MAX
        if max_possible_overload <= 0:
            continue

        prof_load = model.NewIntVar(0, len(vs), f"load_{pid}")
        model.Add(prof_load == sum(vs))

        overload_var = model.NewIntVar(0, max_possible_overload, f"overload_{pid}")
        model.Add(overload_var >= prof_load - STANDARD_MAX)

        obj_vars.append(overload_var)
        obj_coefs.append(int(w_over * OVERLOAD_PENALTY))

    # ------------------------------------------------------------------
    # SO4 + SO5: Drop penalties for unscheduled non-must_have sections
    #
    # Create a BoolVar 'is_dropped' per section, constrained so that
    # is_dropped = 1 iff the section goes unscheduled.
    # ------------------------------------------------------------------
    for cs in course_sections:
        cs_key   = cs["cs_key"]
        priority = cs["offering"]["priority"]

        if priority == "must_have":
            continue   # HC10 guarantees scheduling; no drop penalty needed

        dp = (SHOULD_HAVE_DROP_PENALTY if priority == "should_have"
              else COULD_HAVE_DROP_PENALTY)

        vs = vars_by_cs.get(cs_key, [])

        is_dropped = model.NewBoolVar(f"dropped_{cs_key}")
        if vs:
            # sum(vs) + is_dropped == 1  →  is_dropped = 1 - sum(vs)
            model.Add(sum(vs) + is_dropped == 1)
        else:
            # No eligible slots: always dropped
            model.Add(is_dropped == 1)

        obj_vars.append(is_dropped)
        obj_coefs.append(dp)

    # ------------------------------------------------------------------
    # Set objective
    # ------------------------------------------------------------------
    if obj_vars:
        model.Minimize(cp_model.LinearExpr.WeightedSum(obj_vars, obj_coefs))
    else:
        model.Minimize(0)
