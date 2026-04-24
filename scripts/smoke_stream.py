"""Smoke test for POST /api/solve/stream.

Pulls the first few offerings from data/quarterly_offerings.default.json,
POSTs them to the running local backend, and prints each SSE frame as
it arrives. Useful for checking that the stream actually emits events
incrementally rather than buffering until the end.

Run with the backend already listening on 127.0.0.1:8765:

    python scripts/smoke_stream.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "data" / "quarterly_offerings.default.json"
PROFS = ROOT / "data" / "professors.json"
ROOMS = ROOT / "data" / "rooms.json"


def build_request_body() -> dict:
    doc = json.loads(DEFAULT.read_text(encoding="utf-8"))
    professors = json.loads(PROFS.read_text(encoding="utf-8"))
    rooms = json.loads(ROOMS.read_text(encoding="utf-8"))
    offerings = [
        {
            "catalog_id": o["catalog_id"],
            "priority": o.get("priority", "should_have"),
            "sections": o.get("sections", 1),
            "override_enrollment_cap": None,
            "override_preferred_professors": None,
            "notes": None,
            "assigned_prof_id": None,
            "assigned_room_id": None,
            "pinned": None,
            "assignment": None,
        }
        for o in doc.get("offerings", [])[:8]
    ]
    return {
        "quarter":    doc.get("quarter", "fall"),
        "year":       doc.get("year", 2026),
        "solveMode":  "balanced",
        "offerings":  offerings,
        "professors": professors,
        "rooms":      rooms,
    }


def main() -> int:
    body = build_request_body()
    req = urllib.request.Request(
        "http://127.0.0.1:8765/api/solve/stream",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )

    start = time.time()
    print(f"POST /api/solve/stream with {len(body['offerings'])} offerings")
    print("---")

    buffer = b""
    n_events = 0
    n_solutions = 0
    with urllib.request.urlopen(req, timeout=120) as resp:
        print(f"status={resp.status}  content-type={resp.headers.get('Content-Type')!r}")
        print(f"x-accel-buffering={resp.headers.get('X-Accel-Buffering')!r}")
        print("---")
        while True:
            chunk = resp.read1() if hasattr(resp, "read1") else resp.read(4096)
            if not chunk:
                break
            buffer += chunk
            while b"\n\n" in buffer:
                raw_frame, buffer = buffer.split(b"\n\n", 1)
                frame = raw_frame.decode("utf-8").strip()
                if not frame:
                    continue
                if frame.startswith(":"):
                    print(f"[{time.time()-start:6.2f}s]  (heartbeat)")
                    continue
                event_type = ""
                data_str = ""
                for line in frame.split("\n"):
                    if line.startswith("event:"):
                        event_type = line[len("event:"):].strip()
                    elif line.startswith("data:"):
                        data_str = line[len("data:"):].strip()
                try:
                    data = json.loads(data_str) if data_str else {}
                except json.JSONDecodeError:
                    data = {"_raw": data_str}
                n_events += 1
                if event_type == "solution_found":
                    n_solutions += 1
                summary = {k: v for k, v in data.items() if k != "modes"}
                if event_type == "solve_complete":
                    summary["modes_count"] = len(data.get("modes", []))
                print(f"[{time.time()-start:6.2f}s]  {event_type:<16}  {summary}")

    print("---")
    print(f"Stream closed. {n_events} events, {n_solutions} solutions. "
          f"Total {time.time()-start:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
