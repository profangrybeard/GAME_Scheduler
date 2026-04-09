"""Validate all scheduler data files: schemas + cross-reference integrity.

Usage:
    python -m ingest.validate

Exit code 0  — no errors found (warnings are informational only)
Exit code 1  — one or more ERROR-level problems found

Checks performed
----------------
Schema validation
  • data/professors.json         vs schemas/professor.schema.json
  • data/course_catalog.json     vs schemas/course_catalog.schema.json
  • data/rooms.json              vs schemas/room.schema.json
  • data/quarterly_offerings.json vs schemas/quarterly_offering.schema.json

Cross-reference integrity
  • Every catalog_id in quarterly_offerings exists in course_catalog
  • Every prof ID in course_catalog.preferred_professors exists in professors
  • Every prof ID in offerings.override_preferred_professors exists in professors
  • course_catalog.required_room_type values are valid (in ROOM_COMPATIBILITY)
  • course_catalog.specialization_tags are in VALID_SPECIALIZATIONS

Warnings (non-fatal)
  • Courses with no preferred_professors
  • Professors whose available_quarters excludes the offering quarter
"""

import json
import sys
from pathlib import Path

import jsonschema

from config import ROOM_COMPATIBILITY, VALID_SPECIALIZATIONS

BASE = Path(__file__).resolve().parent.parent

DATA = {
    "professors":          BASE / "data" / "professors.json",
    "course_catalog":      BASE / "data" / "course_catalog.json",
    "rooms":               BASE / "data" / "rooms.json",
    "quarterly_offerings": BASE / "data" / "quarterly_offerings.json",
}

SCHEMAS = {
    "professors":          BASE / "schemas" / "professor.schema.json",
    "course_catalog":      BASE / "schemas" / "course_catalog.schema.json",
    "rooms":               BASE / "schemas" / "room.schema.json",
    "quarterly_offerings": BASE / "schemas" / "quarterly_offering.schema.json",
}

VALID_ROOM_TYPES = set(ROOM_COMPATIBILITY.keys())
VALID_TAGS = set(VALID_SPECIALIZATIONS)

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

_errors: list[str] = []
_warnings: list[str] = []


def error(msg: str) -> None:
    """Record a fatal error and print it."""
    _errors.append(msg)
    print(f"  [ERROR] {msg}")


def warn(msg: str) -> None:
    """Record a non-fatal warning and print it."""
    _warnings.append(msg)
    print(f"  [WARN]  {msg}")


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> object | None:
    if not path.exists():
        error(f"File not found: {path.relative_to(BASE)}")
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        error(f"JSON parse error in {path.relative_to(BASE)}: {e}")
        return None


def _load_schema(path: Path) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        error(f"Could not load schema {path.name}: {e}")
        return None


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------

def _validate_item(item: dict, schema: dict, label: str) -> bool:
    try:
        jsonschema.validate(item, schema)
        return True
    except jsonschema.ValidationError as e:
        error(f"{label}: {e.message} (path: {list(e.absolute_path)})")
        return False


def validate_professors(professors: list[dict]) -> None:
    """Validate each professor record against the professor JSON schema."""
    print("\nValidating professors ...")
    schema = _load_schema(SCHEMAS["professors"])
    if schema is None:
        return
    for prof in professors:
        _validate_item(prof, schema, f"professor {prof.get('id', '?')}")
    print(f"  {len(professors)} professors checked")


def validate_course_catalog(catalog: list[dict]) -> None:
    """Validate each course against its schema plus room type and tag controlled vocabularies."""
    print("\nValidating course catalog ...")
    schema = _load_schema(SCHEMAS["course_catalog"])
    if schema is None:
        return
    for course in catalog:
        cid = course.get("id", "?")
        _validate_item(course, schema, f"course {cid}")

        # Room type validity
        rtype = course.get("required_room_type")
        if rtype and rtype not in VALID_ROOM_TYPES:
            error(f"course {cid}: unknown required_room_type '{rtype}'")

        # Specialization tag validity
        for tag in course.get("specialization_tags", []):
            if tag not in VALID_TAGS:
                error(f"course {cid}: unknown specialization_tag '{tag}'")

    print(f"  {len(catalog)} courses checked")


def validate_rooms(rooms: list[dict]) -> None:
    """Validate each room record against the room JSON schema."""
    print("\nValidating rooms ...")
    schema = _load_schema(SCHEMAS["rooms"])
    if schema is None:
        return
    for room in rooms:
        _validate_item(room, schema, f"room {room.get('id', '?')}")
    print(f"  {len(rooms)} rooms checked")


def validate_quarterly_offerings(offerings_doc: dict) -> None:
    """Validate the quarterly offerings document against its JSON schema."""
    print("\nValidating quarterly offerings ...")
    schema = _load_schema(SCHEMAS["quarterly_offerings"])
    if schema is None:
        return
    _validate_item(offerings_doc, schema, "quarterly_offerings")
    n = len(offerings_doc.get("offerings", []))
    print(f"  {n} offerings checked")


# ---------------------------------------------------------------------------
# Cross-reference checks
# ---------------------------------------------------------------------------

def cross_reference(
    professors: list[dict],
    catalog: list[dict],
    offerings_doc: dict,
) -> None:
    """Check referential integrity across all data files.

    Verifies that professor IDs, catalog IDs, and room/tag values referenced
    anywhere are actually defined in their respective source files.
    """
    print("\nRunning cross-reference checks ...")

    prof_ids = {p["id"] for p in professors}
    course_ids = {c["id"] for c in catalog}
    quarter = offerings_doc.get("quarter", "")

    # --- course_catalog: preferred_professors must exist ---
    for course in catalog:
        cid = course["id"]
        for pid in course.get("preferred_professors", []):
            if pid not in prof_ids:
                error(f"course {cid}: preferred_professor '{pid}' not in professors.json")

    # --- course_catalog: warn on courses with no preferred professors ---
    no_prefs = [c["id"] for c in catalog if not c.get("preferred_professors")]
    if no_prefs:
        warn(f"{len(no_prefs)} courses have no preferred_professors: {', '.join(no_prefs[:10])}"
             + (" ..." if len(no_prefs) > 10 else ""))

    # --- quarterly_offerings cross-references ---
    for offering in offerings_doc.get("offerings", []):
        cid = offering["catalog_id"]

        # catalog_id must exist
        if cid not in course_ids:
            error(f"offering catalog_id '{cid}' not found in course_catalog.json")

        # override_preferred_professors must exist
        overrides = offering.get("override_preferred_professors") or []
        for pid in overrides:
            if pid not in prof_ids:
                error(f"offering {cid}: override_preferred_professor '{pid}' not in professors.json")

    # --- warn if professors unavailable this quarter ---
    if quarter:
        unavailable = [
            p["id"] for p in professors
            if quarter not in p.get("available_quarters", [])
        ]
        if unavailable:
            warn(
                f"Quarter '{quarter}': these professors are not available: "
                + ", ".join(unavailable)
            )

    print("  Cross-reference checks complete")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run() -> int:
    """Run the full validation suite. Returns 0 if clean, 1 if errors found."""
    print("=" * 60)
    print("  SCAD Course Scheduler - Data Validation")
    print("=" * 60)

    # Load all data files
    professors = _load_json(DATA["professors"])
    catalog    = _load_json(DATA["course_catalog"])
    rooms      = _load_json(DATA["rooms"])
    offerings  = _load_json(DATA["quarterly_offerings"])

    # Schema validation (only for files that loaded successfully)
    if professors is not None:
        validate_professors(professors)
    if catalog is not None:
        validate_course_catalog(catalog)
    if rooms is not None:
        validate_rooms(rooms)
    if offerings is not None:
        validate_quarterly_offerings(offerings)

    # Cross-reference checks (need all three)
    if professors is not None and catalog is not None and offerings is not None:
        cross_reference(professors, catalog, offerings)

    # Summary
    print()
    print("=" * 60)
    if _errors:
        print(f"  RESULT: FAILED  - {len(_errors)} error(s), {len(_warnings)} warning(s)")
    else:
        print(f"  RESULT: PASSED  - 0 errors, {len(_warnings)} warning(s)")
    print("=" * 60)

    return 1 if _errors else 0


if __name__ == "__main__":
    sys.exit(run())
