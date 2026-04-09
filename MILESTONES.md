# Course Scheduler — Build Milestones

Each milestone is a self-contained checkpoint. At each milestone boundary:
- All code compiles/runs without errors
- A commit is created with a passing state
- Context is dumped to memory for session switching
- Steps to reproduce / verify are documented below

---

## M0 — Project Scaffold (this commit)

**What was built:**
- Repository folder structure matching spec Section 3
- `config.py` — all constants, penalties, weight vectors, mappings from Section 11
- JSON schemas in `schemas/` — professor, course_catalog, quarterly_offering, room
- `data/professors.json` — 7 professors from Google Doc (Allen, Lindsay, Dodson, Avenali, Spencer, Maloney, Imperato)
- `data/rooms.json` — 6 dummy rooms from Section 8.3
- `requirements.txt` — ortools, openpyxl, jsonschema, beautifulsoup4, requests, gspread
- `.gitignore`, `.env.example`

**How to verify:**
```bash
pip install -r requirements.txt
python -c "import config; print(len(config.VALID_SPECIALIZATIONS), 'specializations')"
python -c "import json; d=json.load(open('data/professors.json')); print(len(d), 'professors')"
python -c "import json; d=json.load(open('data/rooms.json')); print(len(d), 'rooms')"
```

**Status:** COMPLETE

---

## M1 — Catalog Pipeline

**What to build:**
- `ingest/catalog_scraper.py` — scrape SCAD catalog (GAME, ITGM, MOME pages)
- `ingest/catalog_defaults.py` — inference engine (dept, room type, enrollment cap, specialization tags, preferred professors)
- Run scraper to produce `data/course_catalog.json` with real courses
- Add manual AI department courses

**How to verify:**
```bash
python -m ingest.catalog_scraper
python -c "import json; d=json.load(open('data/course_catalog.json')); print(len(d), 'courses')"
# Expect: 30+ real courses from SCAD catalog
# Spot-check: GAME_256 should exist with game_design tags
```

**Actual result:** 108 courses (game: 63, motion_media: 44, ai: 1) — live Courseleaf scrape
from catalog.scad.edu/courses/{game,itgm,mome}/. GAME_256 confirmed with game_design tags.

**Status:** COMPLETE

---

## M2 — Validation & Test Data

**What to build:**
- `ingest/validate.py` — full validation per Section 12
- `data/quarterly_offerings.json` — test file with ~16 courses (8 GAME, 4 MOME, 4 AI)

**How to verify:**
```bash
python -m ingest.validate
# Expect: 0 errors, possibly some warnings
# Intentionally break a field and re-run to confirm it catches errors
```

**Actual result:** 0 errors, 1 warning (14 internship/stub courses have no preferred
professors - expected). Break test confirmed: bad catalog_id and bad specialization_tag
both caught as ERRORs with exit code 1.

**Status:** COMPLETE

---

## M3 — Solver Core

**What to build:**
- `solver/model_builder.py` — join catalog+offerings, build integer model + lookups
- `solver/constraints.py` — all 12 hard constraints from Section 4
- `solver/objectives.py` — all 5 soft constraints + 3 mode weight vectors from Section 5

**How to verify:**
```bash
python -c "
from solver.model_builder import build_model
from solver.constraints import apply_hard_constraints
model, data = build_model('fall')
print('Variables created:', len(data['assignments']))
"
```

**Actual result:** 1528 BoolVars across 19 sections (16 offerings, 3 expanded to 2 sections).
Hard constraints OK, objective OK. All 3 import paths verified clean.

**Status:** COMPLETE

---

## M4 — Scheduler + Excel Export

**What to build:**
- `solver/scheduler.py` — orchestrate 3 CP-SAT solves with different objectives
- `export/excel_writer.py` — formatted Excel output per Section 10
- `main.py` — full pipeline entry point per Section 9

**How to verify:**
```bash
python main.py --quarter fall
# Expect: output/schedule_fall_2026.xlsx with 4 sheets
# Open in Excel: Summary sheet, 3 option sheets with department colors
# Check: no hard constraint violations, affinity highlights in yellow, time pref in orange
```

**Actual result:** All 3 modes solved OPTIMAL. 18-19/19 sections placed. One could_have
section (ITGM_748) left unscheduled in affinity_first and balanced modes — correct
solver behavior. output/schedule_fall_2026.xlsx written with 4 sheets, dept colour
coding, affinity/time-pref highlights. No hard constraint violations.

Scores: affinity_first=145, time_pref_first=15, balanced=75.

**Status:** COMPLETE

---

## M5 — Polish & Documentation

**What to build:**
- `README.md` — per Section 13 spec (non-technical chair audience)
- Docstrings on every module
- Final validation pass

**How to verify:**
- A non-technical user can follow README from clone to first schedule
- `python main.py --quarter fall` works end-to-end from clean clone

**Status:** PENDING

---

## Session Switching Protocol

When pausing at any milestone boundary:
1. Commit all work with milestone tag in message
2. Update this file (mark completed milestones)
3. Save context to `.claude/` memory files
4. Note any open questions or decisions for next session

When resuming:
1. Read `MILESTONES.md` to see current state
2. Read `.claude/` memory files for context
3. Run verification steps for last completed milestone
4. Continue from next pending milestone
