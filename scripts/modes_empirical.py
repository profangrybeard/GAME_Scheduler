"""Run all three modes on the default offerings and dump the affinity +
time_pref distribution of each resulting schedule. Shows whether 'balanced'
actually behaves differently from 'time_pref_first' in practice."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from solver.scheduler import run_schedule
from config import TIME_PREF_MAP, MODE_WEIGHTS


def _time_label(prof_time_pref: str, ts: str) -> str:
    return TIME_PREF_MAP.get((prof_time_pref, ts), "not_preferred")


def _summarize_mode(mode_result: dict) -> dict:
    """Return per-mode tallies from a completed solve."""
    aff_dist  = Counter()
    time_dist = Counter()
    for a in mode_result["schedule"]:
        aff_dist[a["affinity_level"]] += 1
        time_dist[a["time_pref"]]     += 1
    return {
        "mode":        mode_result["mode"],
        "status":      mode_result["status"],
        "objective":   mode_result["objective"],
        "n_placed":    len(mode_result["schedule"]),
        "n_unsched":   len(mode_result["unscheduled"]),
        "aff_dist":    dict(aff_dist),
        "time_dist":   dict(time_dist),
        "schedule":    mode_result["schedule"],
    }


def main() -> None:
    doc = json.loads((ROOT / "data" / "quarterly_offerings.json").read_text("utf-8"))
    quarter = doc.get("quarter", "fall")
    print(f"Running all 3 modes on {quarter} {doc.get('year', 2026)} "
          f"({len(doc.get('offerings', []))} offerings) ...\n")

    results = run_schedule(quarter)

    summaries = [_summarize_mode(m) for m in results["modes"]]

    # ------------------------------------------------------------------
    # High-level comparison
    # ------------------------------------------------------------------
    print("=" * 76)
    print("MODE COMPARISON — weighted objectives + schedule-quality tallies")
    print("=" * 76)
    print(f"  {'mode':18s} {'status':10s} {'obj':>8s} {'placed':>8s} {'unsched':>8s}")
    for s in summaries:
        print(f"  {s['mode']:18s} {s['status']:10s} {s['objective']:>8} "
              f"{s['n_placed']:>8d} {s['n_unsched']:>8d}")
    print()

    # Affinity distribution (lower = better-matched)
    print("Affinity level distribution (0=override-preferred, 1=preferred, 2=eligible):")
    print(f"  {'mode':18s}  lvl0  lvl1  lvl2  avg")
    for s in summaries:
        d = s["aff_dist"]
        n = sum(d.values()) or 1
        avg = sum(k*v for k, v in d.items()) / n
        print(f"  {s['mode']:18s}  {d.get(0,0):4d}  {d.get(1,0):4d}  {d.get(2,0):4d}  {avg:.2f}")
    print()

    # Time-pref distribution
    print("Time-pref distribution:")
    labels = ["preferred", "acceptable", "not_preferred"]
    print(f"  {'mode':18s}  {'preferred':>10s}  {'acceptable':>11s}  {'not_preferred':>14s}")
    for s in summaries:
        d = s["time_dist"]
        print(f"  {s['mode']:18s}  {d.get('preferred',0):>10d}  "
              f"{d.get('acceptable',0):>11d}  {d.get('not_preferred',0):>14d}")
    print()

    # ------------------------------------------------------------------
    # Schedule-level diff: how many assignments differ between pairs?
    # ------------------------------------------------------------------
    def sched_key(a: dict) -> tuple:
        return (a["cs_key"], a["prof_id"], a["day_group"], a["time_slot"])

    by_mode = {s["mode"]: {sched_key(a) for a in s["schedule"]} for s in summaries}
    modes   = list(by_mode.keys())

    print("Schedule overlap — how many (cs, prof, slot) tuples match pairwise:")
    print(f"  {'pair':40s}  {'match':>6s}  {'total_A':>8s}  {'total_B':>8s}  {'jaccard':>8s}")
    for i in range(len(modes)):
        for j in range(i+1, len(modes)):
            a_set = by_mode[modes[i]]
            b_set = by_mode[modes[j]]
            inter = len(a_set & b_set)
            union = len(a_set | b_set) or 1
            print(f"  {modes[i]:18s} vs {modes[j]:18s}  {inter:>6d}  {len(a_set):>8d}  {len(b_set):>8d}  {inter/union:>8.2f}")
    print()

    # Per-section assignment comparison — which specific sections differ?
    print("Per-section comparison (cs_key -> prof / slot by mode):")
    all_keys = sorted({k for s in by_mode.values() for k,_,_,_ in s} |
                      {a["cs_key"] for summ in summaries for a in summ["schedule"]})
    per_mode_assign = {}
    for s in summaries:
        per_mode_assign[s["mode"]] = {a["cs_key"]: a for a in s["schedule"]}

    print(f"  {'cs_key':24s}  {'affinity_first':28s}  {'time_pref_first':28s}  {'balanced':28s}")
    for k in all_keys:
        cells = []
        for mode in modes:
            a = per_mode_assign[mode].get(k)
            if a:
                cells.append(f"{a['prof_name'][:10]:10s}/{a['time_slot']:7s}/{a['time_pref'][:4]}/a{a['affinity_level']}")
            else:
                cells.append("—")
        print(f"  {k:24s}  {cells[0]:28s}  {cells[1]:28s}  {cells[2]:28s}")


if __name__ == "__main__":
    main()
