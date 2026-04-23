"""Build the weighted penalty objective function for the CP-SAT model.

Call build_objective(model, data) after apply_hard_constraints() and before solving.
Sets model.Minimize(total_weighted_penalty) in-place.

Soft objectives
---------------
  SO1  Affinity penalty    — how well prof specializations match course tags
                             (fixed weight AFFINITY_WEIGHT, not mode-tuned)
  SO2  Time-pref penalty   — how well time slot matches prof time_preference
  SO3  Overload penalty    — penalty if prof teaches > STANDARD_MAX sections
  SO4  should_have drop    — penalty if a should_have section goes unscheduled
                             (scaled by coverage weight)
  SO5  could_have drop     — penalty if a could_have section goes unscheduled
                             (scaled by coverage weight)
  SO6  Under-contract      — penalty per missing class below the prof's floor
                             (chair=CHAIR_MAX, others=STANDARD_MAX). Dominates
                             SO1-SO5 so the solver never under-loads one prof
                             to overload another. Not mode-tuned.

Affinity levels
---------------
  0  Professor is in offering.override_preferred_professors  → AFFINITY_PENALTIES[0] = 0
  1  Professor is in course.preferred_professors             → AFFINITY_PENALTIES[1] = 1
  2  Professor in course department, not preferred           → AFFINITY_PENALTIES[2] = 3
  3  Professor outside course department (fallback tier)     → AFFINITY_PENALTIES[3] = 10

Mode weights (from config.MODE_WEIGHTS — three tunable axes)
------------------------------------------------------------
  cover_first     : coverage*10  time_pref*1   overload*1
  time_pref_first : coverage*3   time_pref*10  overload*2
  balanced        : coverage*5   time_pref*5   overload*3
"""

from ortools.sat.python import cp_model

from config import (
    AFFINITY_PENALTIES, AFFINITY_WEIGHT, TIME_PREF_MAP, TIME_PREF_PENALTIES,
    OVERLOAD_PENALTY, SHOULD_HAVE_DROP_PENALTY, COULD_HAVE_DROP_PENALTY,
    UNDER_CONTRACT_PENALTY,
    MODE_WEIGHTS, STANDARD_MAX, CHAIR_MAX,
)


# ---------------------------------------------------------------------------
# Per-variable penalty helpers
# ---------------------------------------------------------------------------

def _affinity_level(cs_info: dict, prof_id: str, prof: dict | None = None) -> int:
    """Return affinity level (0-3) for a professor-course pairing.

    Level 3 is the out-of-department fallback. `_eligible_professors` returns
    any prof who passes HC8/HC9, so wrong-dept profs show up here and get
    penalized — never excluded. Pass ``prof`` (the full professor record) to
    detect out-of-department pairings; without it, out-of-dept profs collapse
    into level 2 (back-compat for legacy callers that don't have a prof handle).
    """
    override = set(cs_info["offering"].get("override_preferred_professors") or [])
    preferred = set(cs_info["course"].get("preferred_professors") or [])
    if override and prof_id in override:
        return 0
    if prof_id in preferred:
        return 1
    if prof is not None:
        course_dept = cs_info["course"]["department"]
        if course_dept not in prof.get("teaching_departments", []):
            return 3
    return 2


def _time_pref_penalty(prof: dict, ts: str) -> int:
    """Return time preference penalty for assigning prof to time slot ts."""
    label = TIME_PREF_MAP.get((prof["time_preference"], ts), "not_preferred")
    return TIME_PREF_PENALTIES[label]


# ---------------------------------------------------------------------------
# Weight scaling
# ---------------------------------------------------------------------------

# Canonical MODE_WEIGHTS top out at 10. Per-assignment penalty coefs scale
# as w * pen, so a weight of 10 with the worst time_pref penalty (5) gives
# coef 50. Inputs from the gear UI live on a percent-of-100 scale, so an
# extreme mix like {5, 90, 5} would yield a coef of 450 — ~9x the canonical
# ceiling. CP-SAT's search heuristic is sensitive to objective scale: at
# that magnitude, on Fly's shared-cpu-1x, balanced/Tune mode timed out at
# UNKNOWN with zero feasible solutions found. Rescaling so the max weight
# equals the canonical ceiling preserves the user's intended ratio without
# blowing up the heuristic.
_CANONICAL_MAX_WEIGHT = 10


def _normalize_weights(weights: dict) -> dict:
    """Rescale a weight vector so its max equals _CANONICAL_MAX_WEIGHT,
    preserving ratios. No-op for canonical MODE_WEIGHTS (already on this
    scale). All-zero input is returned as-is — Minimize(0) handles it."""
    max_w = max(weights["coverage"], weights["time_pref"], weights["overload"])
    if max_w <= _CANONICAL_MAX_WEIGHT:
        return weights
    scale = _CANONICAL_MAX_WEIGHT / max_w
    return {
        "coverage":  max(1, round(weights["coverage"]  * scale)),
        "time_pref": max(1, round(weights["time_pref"] * scale)),
        "overload":  max(1, round(weights["overload"]  * scale)),
    }


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
    weights = _normalize_weights(weights)
    w_cov   = weights["coverage"]
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

        aff_pen  = AFFINITY_PENALTIES.get(_affinity_level(cs_info, prof_id, prof),
                                           AFFINITY_PENALTIES["other"])
        time_pen = _time_pref_penalty(prof, ts)

        coef = AFFINITY_WEIGHT * aff_pen + w_time * time_pen
        if coef != 0:
            obj_vars.append(var)
            obj_coefs.append(int(coef))

    # ------------------------------------------------------------------
    # SO3 + SO6: Per-professor load-based penalties
    #
    # Both the overload penalty (load above STANDARD_MAX) and the
    # under-contract penalty (load below the prof's contract floor) key
    # off the same prof_load IntVar, so build it once per prof.
    # ------------------------------------------------------------------
    for prof in professors:
        pid = prof["id"]
        vs  = vars_by_prof.get(pid, [])
        if not vs:
            continue

        prof_load = model.NewIntVar(0, len(vs), f"load_{pid}")
        model.Add(prof_load == sum(vs))

        # --- SO6: Under-contract penalty ---------------------------------
        # Floor: chair = CHAIR_MAX (2); everyone else = STANDARD_MAX (4).
        # Skip profs whose eligible-var count is below the floor — the miss
        # is forced by data, not a solver choice, so penalizing it is noise.
        contract_min = CHAIR_MAX if prof.get("is_chair") else STANDARD_MAX
        if len(vs) >= contract_min:
            under_slack = model.NewIntVar(0, contract_min, f"under_{pid}")
            model.Add(under_slack >= contract_min - prof_load)
            obj_vars.append(under_slack)
            obj_coefs.append(UNDER_CONTRACT_PENALTY)

        # --- SO3: Overload penalty ---------------------------------------
        # Chairs are hard-capped at CHAIR_MAX (HC4); no overload concept.
        # Non-overloaders are hard-capped at STANDARD_MAX (HC4); nothing to soft-penalize.
        if prof.get("is_chair") or not prof.get("can_overload"):
            continue

        max_possible_overload = len(vs) - STANDARD_MAX
        if max_possible_overload <= 0:
            continue

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
        obj_coefs.append(int(w_cov * dp))

    # ------------------------------------------------------------------
    # Set objective
    # ------------------------------------------------------------------
    if obj_vars:
        model.Minimize(cp_model.LinearExpr.WeightedSum(obj_vars, obj_coefs))
    else:
        model.Minimize(0)
