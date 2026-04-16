"""Pytest fixtures for the GAME Scheduler test suite.

Seeds data/quarterly_offerings.json from the shipped default before tests
run so CI doesn't need any pre-existing user state. The file is gitignored
(per-user scratchpad), but solver.scheduler.run_schedule reads it off disk
when called without the offerings_override parameter.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Make the project root importable — matches the pattern in the existing
# test_lock_and_solve.py (which does `sys.path.insert(0, ...)` itself),
# but doing it here once saves every test file from repeating it.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session", autouse=True)
def seed_quarterly_offerings() -> None:
    """Copy data/quarterly_offerings.default.json into place as the runtime
    file the solver expects. Idempotent — only copies when the destination
    doesn't already exist, so local dev state isn't stomped on.
    """
    src = ROOT / "data" / "quarterly_offerings.default.json"
    dst = ROOT / "data" / "quarterly_offerings.json"
    if not dst.exists():
        shutil.copyfile(src, dst)
    yield
