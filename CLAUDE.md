# GAME Scheduler — Project Rules

## Responsive Design Rules

This app is optimized for a **single target**: MacBook Pro 15" running in a browser.

### Golden Target

| Spec | Value |
|------|-------|
| Effective resolution | **1440 x 900** (16:10, macOS default scaling) |
| Usable viewport height | **~820px** (after browser chrome) |
| Sidebar width | **~300px** (Streamlit default) |
| Main content area | **~1140px** (sidebar open) |
| Aspect ratio | **16:10** |

### Rule 1: No Mobile, No Tablet

There is **no mobile layout and no tablet layout**. Screens below 1024px wide show a
"designed for laptop" message instead of a broken layout. Do not add media queries for
small screens. Do not add responsive font scaling or bottom navigation.

### Rule 2: Two Modes Only

**Full** (sidebar open) and **Focus** (sidebar collapsed). The main content does not
reflow when the sidebar toggles — collapsing it gives bonus space, not a different layout.

### Rule 3: Vertical Real Estate is Sacred

The usable viewport is ~820px tall. Maximum **60px for sticky headers/context bars**.
The schedule grid must show all 4 time slots without scrolling when possible. Target
visible grid area: at least **600px tall**.

### Rule 4: Schedule Grid is King

The MW / TTh weekly grid is the most important view. It gets priority on space. Course
cards in the grid must be scannable at a glance — no truncation of course ID or professor
name. Target card height: **~60-70px**, fitting 4 rows cleanly.

### Rule 5: Sidebar is a Tool Drawer

Sidebar stays at ~300px. It holds setup controls (roster, draft ticker, template save).
The main content area is where real work happens.

### Rule 6: No Scroll Traps

Each tab's content fits in a single scroll column. No nested scroll areas, no horizontal
overflow. The Catalog and Courses lists can scroll vertically (expected), but the Schedule
grid should aim for full visibility without scroll.

### Rule 7: No Breakpoint Soup

Do not add media queries for arbitrary widths. The only breakpoint is the **min-width
gate at 1024px** that shows the desktop-only message.

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
