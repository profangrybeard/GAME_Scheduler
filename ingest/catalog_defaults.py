"""Inference engine for course catalog defaults.

Given raw scraped course data, fills in:
  - department (from prefix)
  - enrollment_cap (heuristic)
  - specialization_tags (keyword matching against VALID_SPECIALIZATIONS)
  - preferred_professors (match tags to professor specializations)
  - teaching_order (sequential)
  - source

Equipment requirements (required_equipment / preferred_equipment) are not
inferred — the chair authors them on the course card when a course has real
hardware needs. The solver treats missing/empty as "no equipment requirement."
"""

import json
import re
from pathlib import Path
from config import (
    PREFIX_TO_DEPT,
    VALID_SPECIALIZATIONS,
)


def _normalize(text: str) -> str:
    """Lower-case, strip punctuation, collapse whitespace."""
    return re.sub(r"[^a-z0-9 ]", " ", text.lower()).strip()


# Build a lookup: each specialization mapped to its constituent words
_SPEC_WORDS = {}
for spec in VALID_SPECIALIZATIONS:
    _SPEC_WORDS[spec] = set(spec.replace("_", " ").split())


def infer_department(prefix: str) -> str:
    """Map a course prefix (GAME, ITGM, MOME, AI) to a department."""
    return PREFIX_TO_DEPT.get(prefix.upper(), "game")


def infer_enrollment_cap(is_graduate: bool, department: str) -> int:
    """Heuristic enrollment cap."""
    if is_graduate:
        return 16
    return 20


def infer_specialization_tags(name: str, description: str) -> list[str]:
    """Match course name + description against the controlled vocabulary.

    Strategy: for each specialization tag, check whether ALL of its
    constituent words appear somewhere in the combined text.  This avoids
    partial matches while still being flexible.
    """
    combined = _normalize(f"{name} {description}")
    words_in_text = set(combined.split())
    tags = []
    for spec, spec_words in _SPEC_WORDS.items():
        if spec_words.issubset(words_in_text):
            tags.append(spec)
    # Also do substring matching for multi-word specs that might appear
    # as a phrase in the text
    combined_flat = combined.replace("  ", " ")
    for spec in VALID_SPECIALIZATIONS:
        if spec not in tags:
            phrase = spec.replace("_", " ")
            if phrase in combined_flat:
                tags.append(spec)
    return sorted(set(tags))


def infer_preferred_professors(
    tags: list[str], professors: list[dict]
) -> list[str]:
    """Return professor IDs whose specializations overlap with course tags.

    Ranked by overlap count, top 3 returned.
    """
    if not tags:
        return []
    tag_set = set(tags)
    scored = []
    for prof in professors:
        overlap = len(tag_set & set(prof.get("specializations", [])))
        if overlap > 0:
            scored.append((overlap, prof["id"]))
    scored.sort(key=lambda x: -x[0])
    return [prof_id for _, prof_id in scored[:3]]


def apply_defaults(
    raw_courses: list[dict],
    professors: list[dict] | None = None,
) -> list[dict]:
    """Take raw scraped course dicts and fill in all catalog schema fields.

    Each raw course should have at minimum:
      - prefix (str): e.g. "GAME"
      - number (str or int): e.g. "256"
      - name (str): course title
      - credits (int): credit hours
      - description (str): catalog description
      - is_graduate (bool)

    Optional raw fields: prerequisites (list[str]), notes (str)
    """
    if professors is None:
        prof_path = Path(__file__).resolve().parent.parent / "data" / "professors.json"
        with open(prof_path) as f:
            professors = json.load(f)

    catalog = []
    for i, raw in enumerate(raw_courses, start=1):
        prefix = raw["prefix"].upper()
        number = str(raw["number"])
        dept = infer_department(prefix)
        num_int = int(re.match(r"\d+", number).group())
        is_grad = raw.get("is_graduate", num_int >= 500)
        name = raw["name"]
        desc = raw.get("description", "")
        credits = raw.get("credits", 5)

        tags = infer_specialization_tags(name, desc)
        prefs = infer_preferred_professors(tags, professors)

        entry = {
            "id": f"{prefix}_{number}",
            "name": name,
            "department": dept,
            "is_graduate": is_grad,
            "credits": credits,
            "required_equipment": raw.get("required_equipment", []),
            "preferred_equipment": raw.get("preferred_equipment", []),
            "specialization_tags": tags,
            "preferred_professors": prefs,
            "enrollment_cap": raw.get("enrollment_cap", infer_enrollment_cap(is_grad, dept)),
            "teaching_order": i,
            "prerequisites": raw.get("prerequisites", []),
            "description": desc,
            "source": raw.get("source", "scraped"),
            "last_scraped": raw.get("last_scraped"),
        }
        if raw.get("notes"):
            entry["notes"] = raw["notes"]

        catalog.append(entry)

    return catalog
