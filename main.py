"""SCAD Course Scheduler — full pipeline entry point.

Usage:
    python main.py --quarter fall
    python main.py --quarter fall --offline     # skip catalog re-scrape

Pipeline:
    1. (optional) Re-run catalog scraper to refresh course_catalog.json
    2. Validate all data files (fail fast if errors found)
    3. Run solver: 3 CP-SAT solves across all optimization modes
    4. Export results to output/schedule_{quarter}_{year}.xlsx
    5. Print console summary
"""

import argparse
import sys
from pathlib import Path

import config

BASE = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Console summary
# ---------------------------------------------------------------------------

def _print_summary(results: dict) -> None:
    quarter = results["quarter"].capitalize()
    year    = results["year"]
    modes   = results["modes"]

    print()
    print("=" * 64)
    print(f"  SCAD Schedule Summary  -  {quarter} {year}")
    print("=" * 64)
    print(f"  {'Mode':<22} {'Status':<12} {'Score':>7}  {'Placed':>8}  {'Unscheduled':>12}")
    print("  " + "-" * 60)

    for res in modes:
        n_placed = len(res["schedule"])
        n_unsched = len(res["unscheduled"])
        n_total  = n_placed + n_unsched
        obj = str(res["objective"]) if res["objective"] is not None else "N/A"
        mode_label = res["mode"].replace("_", " ").title()
        print(f"  {mode_label:<22} {res['status'].upper():<12} {obj:>7}  {n_placed:>4}/{n_total:<3}  {n_unsched:>12}")

    print("=" * 64)

    # Flag any must-have failures
    for res in modes:
        must_fail = [u for u in res["unscheduled"] if u["priority"] == "must_have"]
        if must_fail:
            print(f"\n  *** MUST-HAVE FAILURES in [{res['mode']}]:")
            for u in must_fail:
                print(f"      {u['cs_key']}")

    # Quick schedule preview for the 'balanced' mode
    balanced = next((r for r in modes if r["mode"] == "balanced"), None)
    if balanced and balanced["schedule"]:
        print(f"\n  Preview - balanced schedule ({len(balanced['schedule'])} sections):")
        for a in balanced["schedule"]:
            days  = config.DAY_GROUP_LABELS.get(a["day_group"], f"dg{a['day_group']}")
            grad  = "(G)" if a["is_graduate"] else "   "
            name  = a["course_name"][:40]
            print(f"    {a['time_slot']:8s} {days}  {a['catalog_id']:12s} {grad} {name}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    """Parse arguments and run the full scheduling pipeline."""
    parser = argparse.ArgumentParser(
        description="SCAD Game Dept Course Scheduler"
    )
    parser.add_argument(
        "--quarter",
        required=True,
        choices=["fall", "winter", "spring", "summer"],
        help="Quarter to schedule (must match quarterly_offerings.json)"
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Skip catalog re-scrape; use existing data/course_catalog.json"
    )
    args = parser.parse_args()

    # Step 1: (Optional) refresh catalog
    if not args.offline:
        print("Refreshing course catalog from live scrape ...")
        try:
            from ingest.catalog_scraper import run as scrape
            scrape()
        except Exception as e:
            print(f"  [warn] Scraper failed ({e}); proceeding with existing catalog")

    # Step 2: Validate
    print("\nValidating data files ...")
    from ingest.validate import run as validate
    val_exit = validate()
    if val_exit != 0:
        print("\nValidation errors found. Fix them before scheduling. Exiting.")
        sys.exit(1)

    # Step 3: Solve
    print("\nRunning solver (3 modes) ...")
    from solver.scheduler import run_schedule
    results = run_schedule(args.quarter)

    # Step 4: Export
    output_dir = BASE / "output"
    from export.excel_writer import write_excel
    xlsx_path = write_excel(results, output_dir)
    print(f"\nExcel workbook written to: {xlsx_path}")

    # Step 5: Console summary
    _print_summary(results)


if __name__ == "__main__":
    main()
