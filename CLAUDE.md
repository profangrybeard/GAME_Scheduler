# GAME Scheduler — Project Rules

## Responsive Design Rules

The React workspace is **responsive across three breakpoints**. Desktop is the primary
target (where real scheduling work happens), mobile is for reference and light editing.

### Primary Target: Desktop

| Spec | Value |
|------|-------|
| Effective resolution | **1440 x 900** (16:10, macOS default scaling) |
| Usable viewport height | **~820px** (after browser chrome) |
| Layout | 3-panel grid: Roster 280px / Schedule 1fr / Detail 340px |

### Breakpoints

| Range | Layout |
|-------|--------|
| **≥ 1024px** | 3-panel grid (primary target) |
| **768-1023px** | Schedule + Detail visible, Roster becomes a left slide-drawer opened via hamburger |
| **< 768px** | Single-column, bottom tab bar navigates between Roster / Schedule / Detail. Schedule grid shows one day group (MW or TTh) with a toggle. |

Plus `@media (hover: none)` for touch-specific fixes (always-visible remove buttons, tap-to-place).

### Rule 1: Schedule Grid is King

The MW / TTh weekly grid is the most important view. On desktop/landscape it gets priority
on space. On portrait it's accessible via the middle tab with a MW/TTh toggle — all 4 time
slots visible per day.

### Rule 2: Vertical Real Estate is Sacred (desktop)

On desktop, usable viewport is ~820px tall. Maximum **60px for sticky headers/context bars**.
The schedule grid must show all 4 time slots without scrolling.

### Rule 3: Touch-First Where It Matters

All interactive elements are **≥44px on mobile** (≥36px desktop) via the `--hit-min` token.
The `roster-card__remove` button is always visible on `hover: none` devices (no hover-only UI).

### Rule 4: Tap-to-Place Coexists with DnD

HTML5 drag-and-drop stays on desktop. On touch, tap a card to enter placement mode
(banner appears), tap a cell to place. Both systems are always active — touch never fires
drag events, so there's no feature detection needed.

### Rule 5: No Scroll Traps

Each panel's content fits in a single scroll column. No nested scroll areas, no horizontal
overflow.

## Distribution Model

This app is **not hosted**. Users clone the repo and run locally:
- Mac: `./launch.sh`
- Windows: `run.bat`

Launchers handle venv creation, dependency installation, and `streamlit run`.

## Tech Stack

- **Streamlit** (Python) — app shell, session state, welcome screen, sidebar tools, solver invocation, deployment host
- **React + TypeScript + Vite** (in `frontend/`) — the three workspace panels (Offerings Browser, The Board, Course Inspector), embedded in the Streamlit shell via `streamlit-component-lib`
- **OR-Tools CP-SAT** — constraint solver (Python, unchanged)
- **Inline CSS** via `st.markdown(unsafe_allow_html=True)` for remaining Streamlit surfaces; CSS variables + tokens inside the React workspace

## Frontend / Backend Boundary

**React owns:** the workspace canvas (Browser / Board / Inspector). Single shared state object in `frontend/src/App.tsx`; props down, events up. No panel stores a copy of state — see [`docs/state-flow.md`](docs/state-flow.md).

**Streamlit owns:** welcome screen, sidebar tools, template management, file I/O, solver invocation. Data flows into the React component as serialized-JSON props; user actions flow back via component return values.

**Do not** reintroduce custom HTML hacks in `app.py` to replicate workspace behavior. If a workspace panel needs new interactivity, it belongs in the React components — not in Streamlit markdown.
