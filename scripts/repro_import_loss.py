"""Repro: prof/room edits and tunedWeights are lost on Excel reimport.

Writes a minimal hidden _state sheet with a modified prof name + custom
tuned weights, then reads it back via the same reader /api/state/parse uses.
This isolates which layer is dropping data.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from openpyxl import Workbook

from export.excel_reader import read_draft_state
from export.excel_writer import _write_state_sheet

ROOT = Path(__file__).resolve().parent.parent

profs = json.loads((ROOT / "data" / "professors.json").read_text())
rooms = json.loads((ROOT / "data" / "rooms.json").read_text())

modified_profs = [dict(p) for p in profs]
modified_profs[0]["name"] = "SMOKING_GUN_NAME"

draft_state = {
    "schema_version": 1,
    "source":         "react",
    "exported_at":    "2026-04-20",
    "quarter":        "fall",
    "year":           2026,
    "solver_mode":    "balanced",
    "offerings":      [],
    "professors":     modified_profs,
    "rooms":          rooms,
    "tunedWeights":   {"affinity": 99, "time_pref": 1, "overload": 1},
    "solver_results": None,
}

wb = Workbook()
wb.active.title = "placeholder"
state_ws = wb.create_sheet("_state")
_write_state_sheet(state_ws, draft_state)
buf = io.BytesIO()
wb.save(buf)
buf.seek(0)

# Also persist to disk for the UI repro.
out_path = ROOT / "scripts" / "repro_smoking_gun.xlsx"
out_path.write_bytes(buf.getvalue())
print(f"wrote: {out_path}")
buf.seek(0)

parsed = read_draft_state(buf)

print("=== ROUND-TRIP RESULT (writer -> reader) ===")
print(f"Top-level keys returned:    {list(parsed.keys())}")
print(f"professors count returned:  {len(parsed.get('professors') or [])}")
print(f"first prof name returned:   {parsed.get('professors', [{}])[0].get('name')!r}")
print(f"tunedWeights returned:      {parsed.get('tunedWeights')}")
print()
print("=== INTERPRETATION ===")
print("If 'SMOKING_GUN_NAME' and tunedWeights both come back,")
print("the Python layer is fine — the loss is in the React client's handleReloadFile.")
