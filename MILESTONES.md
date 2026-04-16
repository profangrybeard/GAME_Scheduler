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
- `data/professors.json` — 7 professors from Google Doc (Allen, Lindsey, Dodson, Avenali, Spencer, Maloney, Imperato)
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

Score: affinity_first=145, time_pref_first=15, balanced=75.

**Status:** COMPLETE

---

## M6 — Draft Room Refactor (Rev 1.3.0)

**What was built:**
- Unified 3-column "Quarter Planner" layout (Scout, Board, Roster).
- Reclaimed sidebar space for a wider 1.2:3.5:1.3 board ratio.
- Integrated "Scout Report" Inspector in Col 1 to replace overlapping tooltips.
- Relocated Directory navigation and Template Save controls into the main dashboard.
- Maintained legacy fallback at `app_v2.2_legacy.py`.

**How to verify:**
1. Run `streamlit run app.py`
2. Select a quarter and click "Create New Schedule".
3. Verify the three-column layout is visible.
4. Click the `[i]` icon on any course in the Scout (Col 1) to see it in the Inspector.
5. Add a course with `+` and verify it appears on The Board (Col 2).

**Status:** COMPLETE (UI Scaffolding)

---

## M8 — React Workspace First Playable (Rev 3.0.0, AI 201 Session 8)

**Big direction shift:** Streamlit-only → hybrid Streamlit shell + React workspace.
Panel mapping chose **Option Y** (scheduler's natural flow, not the rubric's default):

| Rubric role  | Panel              | Responsibility                                          |
|--------------|--------------------|---------------------------------------------------------|
| Browser      | **Catalogue**      | Pick a course from the full catalog (141 entries)       |
| Detail View* | **Class**          | Assign prof/room/priority/sections/notes — *writes*     |
| Controller   | **Quarter Schedule** | 2×4 weekly grid + dock; place, generate, export       |

\* Class deliberately bends the "Detail View reads only" rubric rule. See `docs/state-flow.md` → "Record of Resistance".

**What was built:**
- `frontend/` — Vite 8 + React 19 + TypeScript scaffold, port **5174** (`strictPort: true`). 5173 is squatted by a legacy repo-root `frontend/` that expects a Python backend — do not collide.
- Three panel components:
  - [`Catalogue.tsx`](frontend/src/components/Catalogue.tsx) — Browser: search + 8 dept chips, draggable rows
  - [`Class.tsx`](frontend/src/components/Class.tsx) — Detail (writes): priority segmented, sections stepper, prof/room selects with AUTO, notes, lock/unlock, remove
  - [`QuarterSchedule.tsx`](frontend/src/components/QuarterSchedule.tsx) — Controller: 2×4 grid, unplaced dock, HTML5 DnD source & target, solve mode chips, Generate/Export
- [`ProfAvatar.tsx`](frontend/src/components/ProfAvatar.tsx) — 3-tier fallback: portrait → initials circle → AUTO silhouette SVG
- Real data from `data/*.json` via [`data.ts`](frontend/src/data.ts) — 141 catalog courses, 7 professors, 7 rooms, 16 default offerings, GAME_120 locked at TTh/2:00PM
- Portraits auto-enumerated via Vite `import.meta.glob('../../data/portraits/*.{png,jpg,jpeg,webp}', { eager: true })` — empty dir falls through to initials circle
- `PROF_COLORS` mirrors the Streamlit `app.py` palette exactly (same 7 hex codes)
- Single source of truth in [`App.tsx`](frontend/src/App.tsx) with 9 memoized callbacks. `pinToSlot` clears `locked` when moving to a different slot (`sameSlot()` helper).
- JSON-accurate shapes in [`types.ts`](frontend/src/types.ts): `teaching_departments`, `display_count`, `station_type`, split `pinned` (soft) vs `locked` (hard)
- HTML5 drag-and-drop (no library): `application/x-offering` MIME + `text/plain` fallback, locked cards REFUSE drag (`e.preventDefault()` in `onDragStart`), drag-over visual via `.schedule-grid__cell--over`
- [`App.css`](frontend/src/App.css) — 3-panel grid (320px / 1fr / 360px), 7 dept color tokens, chip/segmented/stepper primitives, schedule card with dept-colored left stripe
- [`docs/state-flow.md`](docs/state-flow.md) — Mermaid diagram, Record of Resistance, 5-state lifecycle table, verification checklist (satisfies AI 201 P2 rubric 10pt item)
- `.claude/launch.json` — new `"vite"` config: `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev","--prefix","frontend"]`, port 5174
- [CLAUDE.md](CLAUDE.md) updated: lifted "no frontend framework" rule, added Frontend/Backend Boundary section
- `frontend/vite.config.ts` — `server.fs.allow: ['..']` so Vite can serve `../../data/*.json`; `frontend/tsconfig.app.json` — `"resolveJsonModule": true`
- `.gitignore` scoped root-level exclusions so `frontend/package.json` is trackable
- **Deleted legacy scaffolding:** `OfferingsBrowser.tsx`, `CourseInspector.tsx`, `KitStation.tsx`, `TheBoard.tsx` — all replaced by the three panels above

**How to verify (resume steps):**
```bash
# 1. Get back to the worktree
cd C:\SCAD\Projects\GAME_Scheduler\.claude\worktrees\confident-grothendieck
git checkout claude/confident-grothendieck        # already there

# 2. Install deps (if node_modules missing)
cd frontend && npm install

# 3. Start dev server — use launch.json, not raw bash
#    preview_start(name="vite")  →  http://localhost:5174
#    (5173 is the legacy frontend at repo root — do NOT use)

# 4. Expect in the browser:
#    Topbar:      "GAME Scheduler · Fall 2026 · 16 offerings · balanced"
#    Left:        CATALOGUE — 141 rows, search + 8 dept chips
#    Middle:      QUARTER SCHEDULE — 2×4 grid (MW/TTh × 8/11/2/5), dock
#                 GAME_120 card locked at TTh / 2:00 PM with 🔒
#    Right:       CLASS — "No offering selected" placeholder

# 5. Smoke-test DnD:
#    • Drag a CATALOGUE row onto a grid cell → row gets added + pinned
#    • Drag a placed card to a different cell → moves
#    • Drag a placed card into the dock → unpins
#    • Try to drag the locked GAME_120 card → cursor = not-allowed, refuses
#    • Click GAME_120 → CLASS populates, click "🔒 Unlock slot" → 🔒 goes away

# 6. Type-check + build
cd frontend && npm run build          # expect 0 TS errors
```

**Session cadence (AI 201 Project 2):**
- Session 8 (Wed 4/15): **this milestone** — first playable with real data, DnD, portraits, Option Y panel names.
- Session 9 (Mon 4/20): Streamlit ↔ React bridge via `streamlit-component-lib`; wire `requestSolve` / `requestExport` to Python backend.
- Session 10 (Wed 4/22): Polish and professor/room quarterly availability editing (see memory: project_open_design_question.md — awaiting Tim's choice between A/B/C).
- Session 11 (Mon 4/27): Juice pass — tokens, motion, typography.
- Session 12 (Wed 4/29): Studio crit + deliverable due.

**Status:** COMPLETE (scaffolded + first playable). Code is not committed yet — `frontend/` and `docs/` remain untracked pending review.

**Follow-ups (M9 roadmap):**
- Commit the `frontend/` + `docs/` scaffold
- Wire Streamlit ↔ React bridge (streamlit-component-lib)
- Replace `requestSolve` stub (400ms setTimeout) with real Python solver invocation
- Replace `requestExport` stub (console.info) with Excel download
- Build the quarterly availability editor (location TBD — see project_open_design_question.md)
- Upload actual portrait files to `data/portraits/`

---

## M7 — Interactive Calendar & Stability (Rev 1.4.5)

**What was built:**
- **Interactive Weekly Grid:** Replaced static placeholder with a functional "Click-to-Pin" calendar.
- **Professor Selector:** Integrated manual faculty assignment directly into draft cards.
- **Draft Ticker:** Added a live activity log for all user actions (DRAFT, PIN, ASSIGN).
- **Theme Fixes:** Nuked "Panic Reds" via `.streamlit/config.toml` and localized CSS.
- **Engine Safety:** Refactored CSS injection to use `.format()` to prevent NameErrors.

**How to verify:**
1. Run `streamlit run app.py`
2. Verify header shows `REVISION 1.4.4 — ACTIVE` (or later) and sidebar shows `Rev: 1.4.5-HOTFIX`.
3. Add a course, click the 📍 icon, and click a slot in the Weekly Schedule to pin it.
4. Verify the Draft Ticker logs the `PIN` action.
5. Verify Toggles and chips are Indigo, not Red.

**Status:** COMPLETE (Experience Layer)


---

## M5 — Polish & Documentation

**What to build:**
- `README.md` — per Section 13 spec (non-technical chair audience)
- Docstrings on every module
- Final validation pass

**How to verify:**
- A non-technical user can follow README from clone to first schedule
- `python main.py --quarter fall` works end-to-end from clean clone

**Actual result:** README.md written for non-technical chair audience. Module docstrings
added to ingest/__init__.py, solver/__init__.py, export/__init__.py. Function docstrings
added to all 8 public functions in ingest/validate.py and main(). Final validation pass:
0 errors, 1 warning (expected -- 14 internship/stub courses with no preferred professors).
End-to-end pipeline confirmed: 3x OPTIMAL, output/schedule_fall_2026.xlsx written cleanly.

**Status:** COMPLETE

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
