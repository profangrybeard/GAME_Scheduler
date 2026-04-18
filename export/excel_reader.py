"""Read draft state back from a previously-exported XLSX.

Companion to ``excel_writer.py``. The hidden ``_state`` sheet uses a
versioned, chunked-JSON protocol — see ``write_excel`` for the writer
side. This module is pure parsing + reference validation; the Streamlit
upload UI lives in ``app.py``.

Two public entry points:

  read_draft_state(file)
      Returns the parsed dict, or raises one of the typed exceptions
      below. UI code maps each exception to a specific user message.

  validate_against_local_data(state, catalog_ids, prof_ids, room_ids)
      Filters offerings/locks against the locally-loaded reference data
      and returns (cleaned_state, warnings). Drift answer: drop the
      affected items, surface a warning per category. Never silently
      mutate, never refuse the whole file because of one bad ref.
"""
from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import BinaryIO, Union

import openpyxl

from export.excel_writer import (
    STATE_MARKER,
    STATE_SCHEMA_VERSION,
    STATE_SHEET_NAME,
)


# ---------------------------------------------------------------------------
# Exceptions — UI code catches StateReadError to handle any reader failure,
# or specific subclasses to give targeted error copy.
# ---------------------------------------------------------------------------

class StateReadError(Exception):
    """Base class for all reader failures."""


class MissingStateSheet(StateReadError):
    """No _state sheet — likely an XLSX exported before Slice 2 shipped."""


class MarkerMismatch(StateReadError):
    """A1 doesn't carry the expected marker — not a Scheduler export."""


class SchemaVersionUnsupported(StateReadError):
    """schema_version is newer than what this build knows how to read."""

    def __init__(self, found: int, supported: int) -> None:
        super().__init__(f"state schema v{found} > supported v{supported}")
        self.found = found
        self.supported = supported


class MalformedState(StateReadError):
    """JSON parse failed or required keys are missing/wrong type."""


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------

_REQUIRED_KEYS = frozenset({
    "schema_version", "quarter", "year",
    "offerings", "solver_mode",
})
# locked_assignments and solver_results are intentionally optional — the first
# is Streamlit-specific (React uses per-offering `pinned` slots), the second
# is large+optional (older Slice-2-era files won't have it). Consumers use
# state.get(key, default) rather than indexing directly.


def read_draft_state(file: Union[str, Path, BinaryIO, bytes]) -> dict:
    """Open an XLSX and return the embedded draft state dict.

    ``file`` may be a path, a file-like object (Streamlit's UploadedFile
    qualifies), or raw bytes.

    Raises one of the typed exceptions above on any failure.
    """
    if isinstance(file, bytes):
        wb = openpyxl.load_workbook(BytesIO(file), read_only=True, data_only=True)
    else:
        wb = openpyxl.load_workbook(file, read_only=True, data_only=True)

    if STATE_SHEET_NAME not in wb.sheetnames:
        raise MissingStateSheet(
            "No _state sheet — this file was exported before draft-reload "
            "was supported, or isn't a Scheduler export."
        )

    ws = wb[STATE_SHEET_NAME]
    marker = ws["A1"].value
    if marker != STATE_MARKER:
        raise MarkerMismatch(f"expected marker {STATE_MARKER!r}, got {marker!r}")

    # Concatenate every non-empty cell in column A from row 2 onward.
    # The writer chunks payloads >30,000 chars across multiple rows.
    chunks: list[str] = []
    row = 2
    while True:
        val = ws.cell(row=row, column=1).value
        if val is None or val == "":
            break
        chunks.append(str(val))
        row += 1

    payload = "".join(chunks)
    if not payload:
        raise MalformedState("state sheet has marker but no JSON payload below it")

    try:
        state = json.loads(payload)
    except json.JSONDecodeError as e:
        raise MalformedState(f"JSON parse failed: {e}") from e

    if not isinstance(state, dict):
        raise MalformedState(
            f"top-level must be a JSON object, got {type(state).__name__}"
        )

    missing = _REQUIRED_KEYS - state.keys()
    if missing:
        raise MalformedState(f"missing required keys: {sorted(missing)}")

    schema = state.get("schema_version")
    if not isinstance(schema, int):
        raise MalformedState(
            f"schema_version must be int, got {type(schema).__name__}"
        )
    # We could read older versions if/when v2+ ships; for now we only refuse
    # newer ones. Older versions hitting a newer reader are forward-compat.
    if schema > STATE_SCHEMA_VERSION:
        raise SchemaVersionUnsupported(schema, STATE_SCHEMA_VERSION)

    return state


# ---------------------------------------------------------------------------
# Reference-data drift validation
# ---------------------------------------------------------------------------

def validate_against_local_data(
    state: dict,
    catalog_ids: set[str],
    prof_ids: set[str],
    room_ids: set[str],
) -> tuple[dict, list[str]]:
    """Filter draft state against local reference data.

    Returns (cleaned_state, warnings). Offerings whose ``catalog_id`` isn't
    in ``catalog_ids`` are dropped. Locks whose ``prof_id`` or ``room_id``
    aren't local are dropped. Each category produces at most one warning
    line — no spam if many items drop.

    The cleaned state is a shallow copy with ``offerings`` and
    ``locked_assignments`` replaced; all other keys pass through.
    """
    warnings: list[str] = []

    raw_offerings = state.get("offerings", []) or []
    valid_offerings: list[dict] = []
    dropped_cids: list[str] = []
    for o in raw_offerings:
        cid = o.get("catalog_id")
        if cid in catalog_ids:
            valid_offerings.append(o)
        else:
            dropped_cids.append(cid if cid else "<unknown>")

    if dropped_cids:
        sample = ", ".join(dropped_cids[:5])
        more = "" if len(dropped_cids) <= 5 else f" (+{len(dropped_cids) - 5} more)"
        warnings.append(
            f"Loaded {len(valid_offerings)} of {len(raw_offerings)} offerings — "
            f"dropped {len(dropped_cids)} referencing courses not in your local "
            f"catalog: {sample}{more}"
        )

    raw_locks = state.get("locked_assignments", []) or []
    valid_locks: list[dict] = []
    dropped_lock_reasons: list[str] = []
    for la in raw_locks:
        prof_id = la.get("prof_id")
        room_id = la.get("room_id")
        if prof_id not in prof_ids:
            dropped_lock_reasons.append(
                f"professor {prof_id!r} not on your roster"
            )
            continue
        if room_id not in room_ids:
            dropped_lock_reasons.append(
                f"room {room_id!r} not in your local rooms"
            )
            continue
        valid_locks.append(la)

    if dropped_lock_reasons:
        sample = "; ".join(dropped_lock_reasons[:3])
        more = "" if len(dropped_lock_reasons) <= 3 else f" (+{len(dropped_lock_reasons) - 3} more)"
        warnings.append(
            f"Loaded {len(valid_locks)} of {len(raw_locks)} locks — "
            f"dropped {len(dropped_lock_reasons)}: {sample}{more}"
        )

    cleaned = dict(state)
    cleaned["offerings"] = valid_offerings
    cleaned["locked_assignments"] = valid_locks
    return cleaned, warnings
