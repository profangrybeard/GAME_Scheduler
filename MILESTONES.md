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

## M9 — Roster Pivot, Theme System, Professor Card, Responsive Layout (Rev 3.1.0)

**Big shift in panel semantics.** The M8 "Option Y" mapping put the Catalogue (141
courses) as the permanent left panel. User feedback via a sports analogy
reframed it: the Catalogue is the *bench*, Classes are the *active team*,
Professors are *team captains*, Detail is the *rulebook*. The left panel
became a new **Roster** showing only the offerings selected for the quarter.
Everything below built on that pivot.

### What was built

**Roster + Catalogue Drawer**
- New [Roster.tsx](frontend/src/components/Roster.tsx) — the permanent left panel
  showing active offerings. 32px professor "captain" avatar leads each card;
  course ID + truncated name on row 1, prof last name on row 2, status dot
  (offering / kitted / placed / locked), dept-colored 3px left border.
- Roster filters to **unplaced only** — placed offerings live on the grid, so
  the Roster becomes the "to-be-scheduled" pile. Empty roster = winning. Header
  shows `unplaced / total` (e.g. `14 / 16`).
- New [CatalogueDrawer.tsx](frontend/src/components/CatalogueDrawer.tsx) — thin
  slide-out wrapper around the existing `Catalogue.tsx`. Always mounted (preserves
  search + dept filter between opens), transforms from `translateX(-100%)` to
  `translateX(0)`. Closes via scrim click, Escape, or `×`. `Catalogue.tsx`
  unchanged — it's embedded inside the drawer wrapper.
- Unplaced dock in QuarterSchedule replaced by a thin "Drop to unpin" strip
  (40px) that stays as a DnD drop target but reclaims ~32% of vertical space.

**Dark / Light Theme System**
- Dual palette via CSS custom properties in [index.css](frontend/src/index.css).
  `:root` is the dark default; `:root[data-theme="light"]` overrides. 7 dept
  colors have per-theme variants (e.g. `--dept-game: #fcd34d` dark → `#b45309`
  light). New tokens: `--accent-on` (text on accent backgrounds), `--scrim`.
- New [useTheme.ts](frontend/src/hooks/useTheme.ts) hook. Reads `prefers-color-scheme`
  for system default, allows manual override via localStorage (`theme` key),
  cycles `system → light → dark`. Applies `data-theme` to `<html>` eagerly at
  module load to avoid FOUC.
- Topbar toggle button (sun/moon icon, small "A" badge when in system mode).
- All 11 hardcoded rgba/hex values in App.css replaced with variables or
  `color-mix(in srgb, var(--accent) 12%, transparent)` for alpha tints.

**Contextual Professor Card**
- The right detail panel is now bi-contextual: `Class` (course rules) when an
  offering is selected, `ProfessorCard` (player card) when a professor is
  selected. Mutually exclusive — `selectedProfId` in App.tsx is local UI state
  (not in SchedulerState).
- New [ProfessorCard.tsx](frontend/src/components/ProfessorCard.tsx) — lean,
  edit-focused. 64px avatar hero, time-preference segmented control,
  max-classes stepper, quarter availability chips, notes textarea, portrait
  upload. Read-only noise (specializations, teaching depts, masters info)
  stripped per user feedback.
- Professor avatars are clickable everywhere: Roster cards, Class panel
  lockup, schedule grid cards. The lockup has a `--clickable` variant that
  only activates when a prof is assigned.
- `updateProfessor` callback mutates `SchedulerState.professors` (needed for
  solver) AND persists to `localStorage` under `professor-edits` key.
  On app load, stored edits merge over the base `professors.json`.

**Portrait Upload**
- User-uploaded portraits stored as data URLs in localStorage under
  `portrait-overrides` key. No filesystem write (no backend).
- New `PortraitContext` in [ProfAvatar.tsx](frontend/src/components/ProfAvatar.tsx).
  Fallback chain extended: user override → Vite glob from `data/portraits/` →
  colored initials → AUTO silhouette.
- File input → `FileReader.readAsDataURL` → context + localStorage update.
  Instant propagation to every avatar via context.

**Responsive Layout — 3 Breakpoints**
- CLAUDE.md Rule 1 ("No Mobile, No Tablet") **removed**. Rules rewritten for
  three breakpoints.
- **Desktop (≥1024px):** unchanged 3-panel grid `280px 1fr 340px`.
- **Landscape (768-1023px):** grid collapses to `1fr 280px`. Roster becomes
  a left slide-drawer opened via hamburger button in topbar. Schedule cards
  compact (room row hidden). Time-label column shrinks `72px → 56px`.
- **Portrait (<768px):** single-panel at a time via `data-active` attribute
  on `<main>`. Bottom tab bar (Roster / Schedule / Detail) — 60px tall,
  safe-area aware (`env(safe-area-inset-bottom)`). Schedule grid shows ONE
  day column (MW or TTh) with segmented toggle; `48px 1fr` grid.
- New `--hit-min` CSS token: `36px` desktop, `44px` mobile. Applied to theme
  toggle, steppers, drawer close, chips.
- `@media (hover: none)` makes the Roster remove `×` always visible — critical
  for touch users who can't hover.
- Font base bumps `14px → 16px` on mobile; all rem sizes scale automatically.

**Tap-to-Place (touch DnD alternative)**
- New `placingId` state in App.tsx. Coexists with existing HTML5 DnD (touch
  never fires drag events, so no feature detection needed).
- Tap a card (roster / placed / grid) → selects AND enters placement mode. Card
  visually lifts (scale + shadow + accent border). Placement banner appears at
  top of viewport: "Tap a cell to place GAME_220, or tap the unpin strip to
  remove." with Cancel button.
- Tap a cell → pins and clears `placingId`.
- Tap the unpin strip → unpins.
- Tap the same card again → cancels placement mode (banner disappears).
- Grid cells pulse (animation) when in placement mode to indicate drop targets.

### Record of Resistance

1. **Rubric bend, extended.** M8 flagged that Class "Detail writes, not just reads"
   bends the AI 201 rubric. M9 pushes the bend further — the detail panel is now
   *bi-contextual*, also editing professors. The architectural rule
   (single source of truth, props down, events up) still holds: ProfessorCard
   and Class both dispatch callbacks to App.tsx; neither holds local copies of
   domain state.
2. **CLAUDE.md Rule 1 rewritten.** The old rule said "no mobile, no tablet ever."
   Breaking it was deliberate — React lets us do responsive cleanly, unlike
   Streamlit. Rewrite preserves the spirit (desktop is primary) while adding
   three explicit breakpoints. Schedule grid is still king at every breakpoint.
3. **Localstorage over filesystem for persistence.** Professor edits and portrait
   uploads save to `localStorage`, not to `data/professors.json` or
   `data/portraits/`. The app has no backend; writing to disk would require one.
   This is "local config" in the literal sense — per-browser, not per-repo.
4. **Roster shows unplaced only, not all offerings.** The original plan had
   Roster show all 16 offerings. User feedback: placed ones live on the grid,
   so showing them in the Roster too is redundant. Empty roster is the
   winning state.
5. **Selection model is asymmetric.** `selectedOfferingId` lives in
   SchedulerState (solver input); `selectedProfId` is local App.tsx state (UI
   only). Justification: `selectedOfferingId` drives which card is drop-target
   selected on the grid (solver-ish); `selectedProfId` is purely which detail
   panel to render.
6. **Tap-to-place, not touch-DnD polyfill.** Rather than add a heavy dnd-kit
   dependency, we implemented a simple tap-then-tap flow. Coexists with HTML5
   DnD because touch never fires drag events. Two different interaction models
   for two different input modes.

### How to verify

```bash
# 1. From the worktree root
cd C:\SCAD\Projects\GAME_Scheduler\.claude\worktrees\infallible-pare

# 2. Install deps if needed
cd frontend && npm install

# 3. Type-check
npx tsc -b     # expect: 0 errors

# 4. Start dev server
#    preview_start(name="vite") or: npm run dev
#    → http://localhost:5174
```

**Desktop (≥1024px, e.g. 1440×900):**
- Topbar: "GAME Scheduler · FALL 2026 · 16 OFFERINGS · BALANCED" + theme toggle
- Left: Roster panel showing unplaced offerings (expect `14 / 16` after adding
  a prof-assignment + placement to GAME_120, which is locked at TTh 2:00PM)
- Center: Schedule grid, 4 time slots × 2 day groups, "Drop to unpin" strip
- Right: Class detail panel (empty state or selected course)
- Click `+ Add` on roster → Catalogue drawer slides in from left with scrim
- Click any course → added to offerings, appears in Roster, Class panel populates
- Click the professor lockup in Class → Detail panel flips to ProfessorCard

**Theme toggle:**
- Click sun/moon button in topbar → cycles `system → light → dark`
- Light mode: warm neutral `#f5f5f7` background, dept colors darker for contrast
- Reload page → chosen theme persists via localStorage
- macOS theme change when in "system" mode → app tracks automatically

**Professor editing:**
- Click any prof avatar (Roster card, Class hero, schedule grid card) → Professor
  card renders in detail panel
- Edit time preference / max classes / quarter chips / notes → changes
  immediately reflected
- Reload page → edits persist (localStorage `professor-edits` key)
- Portrait upload → FileReader → data URL stored in localStorage
  (`portrait-overrides` key) → avatar updates everywhere

**Landscape (768-1023px, e.g. 900×600):**
- Roster panel hidden; hamburger button appears in topbar
- Click hamburger → Roster slides in from left as drawer with scrim
- Schedule grid shows both MW and TTh columns, time labels at 56px
- Detail panel at 280px on right

**Portrait (<768px, e.g. 375×812):**
- Single panel at a time, bottom tab bar at 60px tall shows Roster / Schedule / Detail
- Topbar: "GAME Scheduler" + theme toggle only (context + hamburger hidden)
- Schedule tab: MW / TTh segmented toggle above grid; single day column visible
- Tap a Roster card → placement banner appears, auto-switches to Detail tab
  with Class populated
- Switch to Schedule tab → cells pulse (animation) as drop targets
- Tap a cell → card lands, banner clears
- Selecting an offering from any panel auto-switches activePanel to "detail"

**Touch (`hover: none`):**
- Roster `×` button always visible (not hover-gated)
- All buttons have ≥44px hit area via `--hit-min` token

### Files changed / created

**Created:**
- `frontend/src/components/Roster.tsx`
- `frontend/src/components/CatalogueDrawer.tsx`
- `frontend/src/components/ProfessorCard.tsx`
- `frontend/src/hooks/useTheme.ts`
- `.github/workflows/frontend-ci.yml` (this milestone adds CI)

**Modified:**
- `CLAUDE.md` — responsive rules rewritten
- `frontend/src/App.tsx` — selection state, catalogue drawer, theme, prof panel,
  portraits, activePanel, placingId, bottom tabs, roster drawer
- `frontend/src/App.css` — ~300 lines added (roster, drawer, prof card, tabs,
  3 media queries, placement mode)
- `frontend/src/index.css` — dual palette, `--hit-min`, mobile font-size
- `frontend/src/types.ts` — `classifyOffering` + `OfferingState` extracted
- `frontend/src/components/ProfAvatar.tsx` — `PortraitContext`
- `frontend/src/components/Class.tsx` — clickable prof lockup, imports shared `classifyOffering`
- `frontend/src/components/QuarterSchedule.tsx` — unplaced dock → unpin strip,
  day-group toggle, placement handling, clickable avatars

**Unchanged:** `Catalogue.tsx`, `data.ts`, `tokens.ts`

### Follow-ups (M10 roadmap)

- Streamlit ↔ React bridge via `streamlit-component-lib`
- Real `requestSolve` → Python solver invocation
- Real `requestExport` → Excel download
- Export / import professor edits + portraits (currently local-only per-browser)
- Persist offering placements across sessions (currently reset on reload)

**Status:** COMPLETE

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
