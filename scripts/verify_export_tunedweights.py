"""E2E verify: POST /api/export with custom tunedWeights; confirm the
returned xlsx embeds tunedWeights in its hidden _state sheet.

Runs the real solver — takes 30s to 3min depending on offerings count.
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from export.excel_reader import read_draft_state

ROOT = Path(__file__).resolve().parent.parent

qo = json.loads((ROOT / "data" / "quarterly_offerings.default.json").read_text())
profs = json.loads((ROOT / "data" / "professors.json").read_text())
rooms = json.loads((ROOT / "data" / "rooms.json").read_text())

MARKER = {"affinity": 42, "time_pref": 7, "overload": 3}

payload = {
    "quarter":      qo["quarter"],
    "year":         qo["year"],
    "solveMode":    "balanced",
    "offerings":    qo["offerings"],
    "professors":   profs,
    "rooms":        rooms,
    "tunedWeights": MARKER,
}

body = json.dumps(payload).encode("utf-8")
req = urllib.request.Request(
    "http://127.0.0.1:8765/api/export",
    data=body,
    method="POST",
    headers={"Content-Type": "application/json"},
)

print(f"[{time.strftime('%H:%M:%S')}] POST /api/export (solver will run)...")
t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=300) as resp:
        xlsx_bytes = resp.read()
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:800]}")
    sys.exit(1)

elapsed = time.time() - t0
print(f"[{time.strftime('%H:%M:%S')}] got {len(xlsx_bytes)} bytes in {elapsed:.1f}s")

draft = read_draft_state(io.BytesIO(xlsx_bytes))

print(f"Top-level keys: {list(draft.keys())}")
print(f"tunedWeights in xlsx: {draft.get('tunedWeights')}")
print(f"professor count: {len(draft.get('professors') or [])}")
print(f"rooms count: {len(draft.get('rooms') or [])}")

tw = draft.get("tunedWeights")
if tw == MARKER:
    print("\n=== PASS: tunedWeights round-tripped through /api/export -> xlsx ===")
else:
    print(f"\n=== FAIL: expected {MARKER}, got {tw} ===")
    sys.exit(2)
