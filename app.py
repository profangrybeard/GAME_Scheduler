"""SCAD Course Scheduler — Streamlit Web Interface.

Launch: streamlit run app.py
Or:     python -m streamlit run app.py

Provides a browser-based interface for the department chair to:
  1. Select courses for a quarterly offering
  2. Adjust faculty preferences per quarter
  3. Generate and preview 3 optimized schedule options
  4. Export the approved schedule to Excel
"""

import html
import json
import random
import sys
from pathlib import Path

import streamlit as st

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

import config
from solver.scheduler import run_schedule
from export.excel_writer import write_excel

# ─── Design Tokens ──────────────────────────────────────────────────
BG_BASE     = "#111113"
BG_CARD     = "#1A1A1E"
BG_HOVER    = "#222228"
BG_SIDEBAR  = "#151517"
BORDER      = "#2A2A30"
BORDER_LITE = "#222228"

TXT_PRIMARY   = "#E8E8ED"
TXT_SECONDARY = "#9CA3AF"
TXT_MUTED     = "#6B7280"
TXT_ACCENT    = "#818CF8"

ACCENT        = "#818CF8"
ACCENT_GREEN  = "#34D399"
ACCENT_AMBER  = "#FBBF24"
ACCENT_RED    = "#F87171"

DEPT_DOT    = {"game": "#60A5FA", "motion_media": "#A78BFA", "ai": "#FBBF24"}
DEPT_LABELS = {"game": "Game Design", "motion_media": "Motion Media", "ai": "AI"}
PRIORITY_LABELS = {"must_have": "Must", "should_have": "Should", "could_have": "Could"}
TIME_PREF_LABELS = {"morning": "Morning", "afternoon": "Afternoon", "afternoon_evening": "Afternoon / Evening"}

# ─── Page Config ─────────────────────────────────────────────────────
st.set_page_config(
    page_title="Course Scheduler",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Global CSS ──────────────────────────────────────────────────────
st.markdown(f"""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .stApp {{
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: {BG_BASE};
        color: {TXT_PRIMARY};
    }}
    .block-container {{ padding-top: 2.5rem; max-width: 1200px; }}

    section[data-testid="stSidebar"] {{
        background: {BG_SIDEBAR};
        border-right: 1px solid {BORDER};
    }}
    section[data-testid="stSidebar"] .stMarkdown p,
    section[data-testid="stSidebar"] .stMarkdown span {{
        color: {TXT_SECONDARY};
    }}

    .stTabs [data-baseweb="tab-list"] {{ gap: 0; border-bottom: 1px solid {BORDER}; }}
    .stTabs [data-baseweb="tab"] {{
        background: transparent; color: {TXT_MUTED};
        border-bottom: 2px solid transparent;
        padding: 0.6rem 1.2rem; font-weight: 500; font-size: 0.88rem;
    }}
    .stTabs [aria-selected="true"] {{
        color: {TXT_PRIMARY} !important;
        border-bottom: 2px solid {ACCENT} !important;
        background: transparent !important;
    }}

    h1, h2, h3, h4 {{ color: {TXT_PRIMARY} !important; }}

    /* Toggle switch — green when on, muted when off */
    .stToggle label[data-checked="true"] span[data-testid="stToggleThumb"],
    div[data-testid="stToggle"] label span:last-child {{}}
    .stToggle [role="checkbox"][aria-checked="true"],
    div[data-baseweb="toggle"] input:checked + div {{
        background-color: {ACCENT_GREEN} !important;
    }}
    div[data-baseweb="toggle"] div {{
        background-color: #3F3F46 !important;
    }}
    div[data-baseweb="toggle"] input:checked + div {{
        background-color: {ACCENT_GREEN} !important;
    }}

    /* ── Header ── */
    .app-header {{
        font-size: 1.45rem; font-weight: 700; color: {TXT_PRIMARY};
        letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 0;
    }}
    .app-sub {{
        font-size: 0.7rem; font-weight: 600; color: {TXT_MUTED};
        text-transform: uppercase; letter-spacing: 0.1em;
        margin-top: 5px; margin-bottom: 1.6rem;
    }}

    .section-label {{
        font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.06em; color: {TXT_MUTED};
        margin: 1.5rem 0 0.6rem 0; padding-bottom: 6px; border-bottom: 1px solid {BORDER};
    }}

    .dept-dot {{
        display: inline-block; width: 8px; height: 8px;
        border-radius: 50%; margin-right: 7px; vertical-align: middle; flex-shrink: 0;
    }}

    .course-card {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 8px;
        padding: 12px 16px; margin-bottom: 6px;
        transition: background 0.15s ease, border-color 0.15s ease;
    }}
    .course-card:hover {{ background: {BG_HOVER}; border-color: #333340; }}
    .cc-top {{ display: flex; align-items: center; gap: 6px; }}
    .cc-id {{ font-weight: 600; font-size: 0.88rem; color: {TXT_ACCENT}; white-space: nowrap; }}
    .cc-title {{ font-weight: 400; font-size: 0.88rem; color: {TXT_PRIMARY}; }}
    .cc-grad {{
        font-size: 0.7rem; font-weight: 500; color: {TXT_MUTED};
        background: {BG_HOVER}; border: 1px solid {BORDER};
        border-radius: 4px; padding: 1px 6px; margin-left: 4px;
    }}
    .cc-suggested {{ font-size: 0.78rem; color: {TXT_MUTED}; margin-top: 3px; padding-left: 15px; }}

    /* ── Course description tooltips ── */
    .course-tooltip-wrap {{
        position: relative;
        display: block;
    }}
    .course-tooltip-wrap .course-tooltip {{
        visibility: hidden;
        opacity: 0;
        position: absolute;
        left: 0; top: 100%;
        z-index: 9999;
        background: {BG_CARD};
        border: 1px solid {BORDER};
        border-radius: 8px;
        padding: 10px 14px;
        max-width: 400px;
        color: {TXT_PRIMARY};
        font-size: 0.8rem;
        line-height: 1.6;
        max-height: 4.8em;
        overflow: hidden;
        margin-top: 4px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        transition: opacity 0.15s ease, visibility 0.15s ease;
        white-space: normal;
        word-break: break-word;
    }}
    .course-tooltip-wrap:hover .course-tooltip {{
        visibility: visible;
        opacity: 1;
    }}

    .stButton > button {{
        background: transparent !important; border: 1px solid {BORDER} !important;
        color: {TXT_MUTED} !important; font-size: 0.82rem !important; font-weight: 500 !important;
        padding: 4px 14px !important; border-radius: 6px !important;
        transition: all 0.15s ease !important; min-height: 0 !important; line-height: 1.6 !important;
    }}
    .stButton > button:hover {{
        background: {BG_HOVER} !important; border-color: {ACCENT} !important; color: {ACCENT} !important;
    }}
    .stButton > button:disabled {{
        background: transparent !important; border: 1px solid {BORDER_LITE} !important;
        color: #3F3F46 !important; opacity: 1 !important;
    }}
    .stButton > button[kind="primary"] {{
        background: {ACCENT} !important; border-color: {ACCENT} !important; color: #FFF !important;
    }}
    .stButton > button[kind="primary"]:hover {{
        background: #6366F1 !important; border-color: #6366F1 !important; color: #FFF !important;
    }}

    .stSelectbox > div > div, .stNumberInput > div > div > input, .stTextInput > div > div > input {{
        background: {BG_CARD} !important; border-color: {BORDER} !important;
        color: {TXT_PRIMARY} !important; font-size: 0.85rem !important;
    }}

    .metric-box {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 8px;
        padding: 16px; text-align: center;
    }}
    .metric-box .num {{ font-size: 1.6rem; font-weight: 700; color: {TXT_PRIMARY}; }}
    .metric-box .lbl {{ font-size: 0.75rem; color: {TXT_MUTED}; margin-top: 2px; }}

    .mode-card {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 8px;
        padding: 18px; text-align: center;
    }}
    .mode-card .mc-label {{ font-weight: 600; color: {TXT_SECONDARY}; font-size: 0.85rem; }}
    .mode-card .mc-value {{ font-size: 1.5rem; font-weight: 700; color: {TXT_PRIMARY}; margin: 4px 0; }}
    .mode-card .mc-sub {{ font-size: 0.78rem; color: {TXT_MUTED}; }}

    /* ── Schedule grid ── */
    .day-header {{
        font-size: 1.15rem; font-weight: 700; color: {ACCENT};
        letter-spacing: -0.01em;
        padding-bottom: 8px; border-bottom: 1px solid {BORDER};
    }}
    .day-header-first {{ margin-top: 2rem; }}
    .day-header-next  {{ margin-top: 2.5rem; }}

    .time-header {{
        font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.07em; color: {TXT_MUTED};
        margin-top: 20px; margin-bottom: 6px;
        padding-left: 10px;
        border-left: 2px solid {BORDER};
    }}

    .sched-card {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 6px;
        padding: 10px 14px; margin-bottom: 8px;
    }}
    .sched-card:hover {{ background: {BG_HOVER}; }}
    .sched-card .sc-course {{ font-weight: 600; font-size: 0.85rem; color: {TXT_PRIMARY}; }}
    .sched-card .sc-course .sc-id {{ color: {TXT_ACCENT}; }}
    .sched-card .sc-detail {{ color: {TXT_SECONDARY}; font-size: 0.8rem; margin-top: 2px; }}
    .sched-card .sc-flags {{ font-size: 0.73rem; color: {TXT_MUTED}; margin-top: 2px; }}

    /* legacy sched-row/sched-time/sched-empty kept for safety — unused in grid */
    .sched-row {{ display: flex; align-items: stretch; gap: 10px; margin-bottom: 5px; }}
    .sched-time {{
        width: 72px; flex-shrink: 0; font-size: 0.78rem; font-weight: 500;
        color: {TXT_MUTED}; padding-top: 10px; text-align: right; padding-right: 8px;
    }}
    .sched-empty {{
        flex: 1; border-radius: 6px; padding: 10px 14px;
        background: transparent; border: 1px dashed {BORDER_LITE}; color: #3F3F46; font-size: 0.8rem;
    }}

    .load-bar-bg {{ background: {BORDER}; border-radius: 3px; height: 5px; margin: 5px 0; }}
    .load-bar-fill {{ height: 5px; border-radius: 3px; }}

    /* ── Weekly calendar grid ── */
    .cal-grid {{
        width: 100%; border-collapse: collapse; table-layout: fixed;
        font-family: inherit; margin-top: 8px;
    }}
    .cal-grid th, .cal-grid td {{
        border: 1px solid {BORDER}; padding: 0; vertical-align: top;
    }}
    .cal-header {{
        background: {BG_CARD}; padding: 8px 6px; text-align: center;
        font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em;
        text-transform: uppercase; color: {TXT_SECONDARY};
    }}
    .cal-time {{
        background: {BG_CARD}; padding: 10px 8px; text-align: right;
        font-size: 0.72rem; font-weight: 600; color: {TXT_MUTED};
        white-space: nowrap; width: 68px; vertical-align: top;
    }}
    .cal-cell {{
        background: {BG_BASE}; padding: 5px; min-height: 80px;
        vertical-align: top;
    }}
    .cal-cell-empty {{
        background: {BG_BASE}; padding: 5px; min-height: 80px;
    }}
    .cal-course {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 5px;
        padding: 6px 8px; margin-bottom: 4px; font-size: 0.78rem;
    }}
    .cal-course:last-child {{ margin-bottom: 0; }}
    .cal-course.locked {{
        background: #1C1C2A !important;
        border-left: 3px solid {ACCENT} !important;
    }}
    .cal-cid {{ font-weight: 700; font-size: 0.75rem; color: {TXT_ACCENT}; }}
    .cal-cname {{ color: {TXT_PRIMARY}; font-size: 0.75rem; margin-top: 1px;
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }}
    .cal-detail {{ color: {TXT_MUTED}; font-size: 0.7rem; margin-top: 2px; }}

    .table-header {{
        font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.06em; color: {TXT_MUTED};
        padding-bottom: 6px; border-bottom: 1px solid {BORDER}; margin-bottom: 6px;
    }}

    /* Welcome card */
    .welcome-card {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 10px;
        padding: 20px 24px; margin-bottom: 8px; cursor: pointer;
        transition: all 0.15s ease;
    }}
    .welcome-card:hover {{ background: {BG_HOVER}; border-color: {ACCENT}; }}
    .welcome-card .wc-name {{ font-weight: 600; font-size: 0.95rem; color: {TXT_PRIMARY}; }}
    .welcome-card .wc-desc {{ font-size: 0.82rem; color: {TXT_MUTED}; margin-top: 4px; }}
    .welcome-card .wc-stats {{ font-size: 0.75rem; color: {TXT_MUTED}; margin-top: 8px; }}
    .welcome-card .wc-stat-item {{
        display: inline-block; background: {BG_HOVER}; border: 1px solid {BORDER};
        border-radius: 4px; padding: 2px 8px; margin-right: 6px; font-size: 0.73rem;
    }}

    /* Faculty card */
    .faculty-card {{
        background: {BG_CARD}; border: 1px solid {BORDER}; border-radius: 8px;
        padding: 16px 20px; margin-bottom: 8px;
    }}
    .faculty-card .fc-name {{ font-weight: 600; font-size: 0.92rem; color: {TXT_PRIMARY}; }}
    .faculty-card .fc-role {{ font-size: 0.78rem; color: {TXT_MUTED}; }}
    .faculty-card .fc-notes {{ font-size: 0.78rem; color: {TXT_MUTED}; margin-top: 6px; line-height: 1.4; }}

    hr {{ border-color: {BORDER} !important; }}
    .stInfo, .stWarning, .stSuccess, .stError {{
        background: {BG_CARD} !important; border: 1px solid {BORDER} !important;
        color: {TXT_SECONDARY} !important;
    }}

    @media (max-width: 768px) {{
        .metric-box .num {{ font-size: 1.2rem; }}
        .course-card {{ padding: 10px 12px; }}
    }}
</style>
""", unsafe_allow_html=True)


# ─── Data Loading ────────────────────────────────────────────────────
@st.cache_data
def load_catalog():
    with open(PROJECT_ROOT / "data" / "course_catalog.json") as f:
        return json.load(f)

@st.cache_data
def load_professors():
    with open(PROJECT_ROOT / "data" / "professors.json") as f:
        return json.load(f)

@st.cache_data
def load_rooms():
    with open(PROJECT_ROOT / "data" / "rooms.json") as f:
        return json.load(f)

def load_templates():
    tmpl_dir = PROJECT_ROOT / "templates"
    tmpl_dir.mkdir(exist_ok=True)
    templates = {}
    for f in sorted(tmpl_dir.glob("*.json")):
        try:
            with open(f) as fh:
                data = json.load(fh)
                templates[f.stem] = data
        except (json.JSONDecodeError, KeyError):
            pass
    return templates

def save_template(name, offerings, prof_overrides=None, intended_quarter=None):
    tmpl_dir = PROJECT_ROOT / "templates"
    tmpl_dir.mkdir(exist_ok=True)
    data = {"name": name, "offerings": offerings}
    if prof_overrides:
        data["professor_overrides"] = prof_overrides
    if intended_quarter:
        data["intended_quarter"] = intended_quarter
    with open(tmpl_dir / f"{name.lower().replace(' ', '_')}.json", "w") as f:
        json.dump(data, f, indent=2)

def save_offerings(quarter, year, offerings_list):
    data = {"quarter": quarter, "year": year, "offerings": offerings_list}
    with open(PROJECT_ROOT / "data" / "quarterly_offerings.json", "w") as f:
        json.dump(data, f, indent=2)
    return data

def apply_professor_overrides(profs, overrides, quarter):
    """Apply template professor overrides to the live professors.json."""
    if not overrides:
        return
    for p in profs:
        ov = overrides.get(p["id"])
        if ov:
            if ov.get("available", True) and "max_classes" in ov and ov["max_classes"] > 0:
                p["max_classes"] = ov["max_classes"]
            if "time_preference" in ov:
                p["time_preference"] = ov["time_preference"]
            if "available" in ov and not ov["available"]:
                if quarter in p.get("available_quarters", []):
                    p["available_quarters"] = [q for q in p["available_quarters"] if q != quarter]
            elif "available" in ov and ov["available"]:
                if quarter not in p.get("available_quarters", []):
                    p.setdefault("available_quarters", []).append(quarter)

def save_professors_to_disk(profs):
    """Persist faculty changes back to professors.json."""
    with open(PROJECT_ROOT / "data" / "professors.json", "w") as f:
        json.dump(profs, f, indent=2)
    load_professors.clear()  # bust cache


# ─── Header ──────────────────────────────────────────────────────────
st.markdown(
    f'<div style="padding-bottom:1.1rem; margin-bottom:0.5rem; border-bottom:1px solid {BORDER};">'
    f'<div class="app-header">Course Scheduler</div>'
    f'<div class="app-sub">SCAD Atlanta &nbsp;&middot;&nbsp; Game Design &nbsp;&middot;&nbsp; Motion Media &nbsp;&middot;&nbsp; AI</div>'
    f'</div>',
    unsafe_allow_html=True,
)


# ─── Session State Init ───────────────────────────────────────────────
if "active_project" not in st.session_state:
    st.session_state["active_project"] = None


# ─── Load catalog data (always needed) ───────────────────────────────
catalog = load_catalog()
profs = load_professors()
rooms = load_rooms()

dept_courses = {}
for c in catalog:
    dept_courses.setdefault(c["department"], []).append(c)


# ─── Welcome / Template cards (home screen) ──────────────────────────
def show_welcome(home_quarter):
    """Render template quick-start cards for the home screen."""
    templates = load_templates()
    if not templates:
        st.info("No templates found. Use **Start Fresh** above to begin a new schedule.")
        return

    st.markdown(
        f'<div style="font-size:1rem; font-weight:600; color:{TXT_PRIMARY}; margin-bottom:4px;">'
        f'Pick a starting point</div>'
        f'<div style="font-size:0.85rem; color:{TXT_MUTED}; margin-bottom:16px;">'
        f'Load a template to get started, then tweak courses and faculty to fit this quarter.</div>',
        unsafe_allow_html=True,
    )

    tmpl_items = list(templates.items())
    if "welcome_order" not in st.session_state:
        order = list(range(len(tmpl_items)))
        random.shuffle(order)
        st.session_state["welcome_order"] = order

    for idx in st.session_state.get("welcome_order", range(len(tmpl_items))):
        if idx >= len(tmpl_items):
            continue
        key, tmpl = tmpl_items[idx]
        name = tmpl.get("name", key)
        desc = tmpl.get("description", "")
        offerings = tmpl.get("offerings", [])
        prof_ov = tmpl.get("professor_overrides", {})

        intended_q = tmpl.get("intended_quarter", "")
        n_courses = len(offerings)
        n_sections = sum(o.get("sections", 1) for o in offerings)
        n_must = sum(1 for o in offerings if o.get("priority") == "must_have")
        n_depts = len(set(
            next((c["department"] for c in catalog if c["id"] == o["catalog_id"]), "?")
            for o in offerings
        ))
        unavailable = [pid.replace("prof_", "").replace("_", " ").title()
                       for pid, ov in prof_ov.items() if not ov.get("available", True)]

        chips = ""
        if intended_q:
            chips += f'<span class="wc-stat-item" style="color:{ACCENT}; border-color:{ACCENT}40;">{intended_q.title()}</span>'
        chips += (
            f'<span class="wc-stat-item">{n_courses} courses</span>'
            f'<span class="wc-stat-item">{n_sections} sections</span>'
            f'<span class="wc-stat-item">{n_must} must-have</span>'
            f'<span class="wc-stat-item">{n_depts} depts</span>'
        )
        if unavailable:
            chips += f'<span class="wc-stat-item" style="color:{ACCENT_AMBER};">{", ".join(unavailable)} unavailable</span>'

        col_info, col_btn = st.columns([6, 1])
        with col_info:
            st.markdown(
                f'<div class="welcome-card">'
                f'  <div class="wc-name">{name}</div>'
                f'  <div class="wc-desc">{desc}</div>'
                f'  <div class="wc-stats">{chips}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )
        with col_btn:
            st.markdown('<div style="height:20px;"></div>', unsafe_allow_html=True)
            if st.button("Load", key=f"welcome_{key}", use_container_width=True):
                tmpl_quarter = intended_q if intended_q else home_quarter
                st.session_state["active_project"] = {
                    "quarter": tmpl_quarter,
                    "year": 2026,
                    "offerings": [{k: v for k, v in o.items()} for o in offerings],
                    "prof_overrides": prof_ov,
                }
                if "welcome_order" in st.session_state:
                    del st.session_state["welcome_order"]
                if "results" in st.session_state:
                    del st.session_state["results"]
                st.rerun()


# ─── Screen Routing ───────────────────────────────────────────────────
active_project = st.session_state.get("active_project")

# ══════════════════════════════════════════════════════════════════════
# SCREEN 1 — Home / Directory
# ══════════════════════════════════════════════════════════════════════
if active_project is None:

    # Sidebar: minimal
    with st.sidebar:
        st.markdown(
            f'<div style="font-size:0.78rem; color:{TXT_MUTED}; margin-top:0.5rem;">v2.2 · Phase 2</div>',
            unsafe_allow_html=True,
        )

    # ── Start from Full Catalog ───────────────────────────────────────
    st.markdown(f'<div class="section-label">New Schedule</div>', unsafe_allow_html=True)

    sf_col1, sf_col2, sf_col3 = st.columns([2, 1, 1])
    with sf_col1:
        new_quarter = st.selectbox(
            "Quarter", config.VALID_QUARTERS, index=0, label_visibility="collapsed"
        )
    with sf_col2:
        new_year = st.number_input(
            "Year", min_value=2024, max_value=2030, value=2026, label_visibility="collapsed"
        )
    with sf_col3:
        st.markdown('<div style="height:4px;"></div>', unsafe_allow_html=True)
        if st.button("Start from Full Catalog", type="primary", use_container_width=True):
            # Find a template matching the selected quarter to use as defaults
            templates = load_templates()
            matching_tmpl = next(
                (t for t in templates.values()
                 if t.get("intended_quarter", "").lower() == new_quarter.lower()),
                None,
            )
            if matching_tmpl:
                # Use the template's offerings as the pre-selected set
                offerings = list(matching_tmpl.get("offerings", []))
            else:
                # No matching template — add all catalog courses with sensible defaults
                offerings = [
                    {
                        "catalog_id": c["id"],
                        "priority": "should_have",
                        "sections": 1,
                        "override_enrollment_cap": None,
                        "override_room_type": None,
                        "override_preferred_professors": None,
                        "notes": "",
                    }
                    for c in catalog
                ]
            st.session_state["active_project"] = {
                "quarter": new_quarter,
                "year": int(new_year),
                "offerings": offerings,
                "prof_overrides": {},
            }
            if "results" in st.session_state:
                del st.session_state["results"]
            st.rerun()

    # "Start empty" escape hatch for power users
    st.markdown('<div style="height:2px;"></div>', unsafe_allow_html=True)
    if st.button(
        "Or start with empty offerings",
        type="tertiary",
        help="Create a blank schedule and add courses manually from the catalog.",
    ):
        st.session_state["active_project"] = {
            "quarter": new_quarter,
            "year": int(new_year),
            "offerings": [],
            "prof_overrides": {},
        }
        if "results" in st.session_state:
            del st.session_state["results"]
        st.rerun()

    # ── Start from Template ──────────────────────────────────────────
    st.markdown(f'<div class="section-label">Start from Template</div>', unsafe_allow_html=True)
    show_welcome(new_quarter)


# ══════════════════════════════════════════════════════════════════════
# SCREEN 2 — Active Workspace
# ══════════════════════════════════════════════════════════════════════
else:
    quarter = active_project["quarter"]
    year = active_project["year"]

    # ── Sidebar ──────────────────────────────────────────────────────
    with st.sidebar:

        if st.button("< Back to Directory", use_container_width=True):
            st.session_state["active_project"] = None
            if "results" in st.session_state:
                del st.session_state["results"]
            st.rerun()

        st.markdown(
            f'<div class="section-label">Current Quarter</div>',
            unsafe_allow_html=True,
        )
        st.markdown(
            f'<div style="font-size:0.92rem; font-weight:600; color:{TXT_PRIMARY}; margin-bottom:2px;">'
            f'{quarter.title()} {year}</div>',
            unsafe_allow_html=True,
        )

        st.markdown(f'<div class="section-label">Save Current Work</div>', unsafe_allow_html=True)
        tmpl_name = st.text_input(
            "Template name", placeholder="e.g. fall_2026_v2", label_visibility="collapsed"
        )
        if tmpl_name and st.button("Save as Template", use_container_width=True):
            offerings_now = active_project["offerings"]
            if offerings_now:
                prof_ov = active_project.get("prof_overrides", {})
                save_template(tmpl_name, offerings_now, prof_ov, quarter)
                st.success(f"Saved: {tmpl_name}")
            else:
                st.warning("Add courses first.")

        st.markdown(f'<div class="section-label">Faculty</div>', unsafe_allow_html=True)
        profs_sidebar = load_professors()
        _sb_ov = active_project.get("prof_overrides", {})
        if _sb_ov:
            apply_professor_overrides(profs_sidebar, _sb_ov, quarter)
        for p in profs_sidebar:
            available = quarter in p.get("available_quarters", [])
            dot_color = ACCENT_GREEN if available else ACCENT_RED
            txt_color = TXT_SECONDARY if available else TXT_MUTED
            role = " (Chair)" if p.get("is_chair") else ""
            max_c = p.get("max_classes", config.STANDARD_MAX)
            st.markdown(
                f'<div style="font-size:0.82rem; color:{txt_color}; margin-bottom:3px;">'
                f'<span style="color:{dot_color};">{"●" if available else "○"}</span> '
                f'{p["name"]}{role} — {max_c} max</div>',
                unsafe_allow_html=True,
            )

    # ── Tabs ─────────────────────────────────────────────────────────
    tab_select, tab_preview, tab_faculty, tab_schedule = st.tabs([
        "Select Courses", "Current Offerings", "Faculty", "Generate & Preview"
    ])

    # ── Tab 1: Course Selection ───────────────────────────────────────
    with tab_select:
        offerings = active_project["offerings"]
        selected_ids = {o["catalog_id"] for o in offerings}
        n_added = len(selected_ids)

        if not offerings:
            st.markdown(
                f'<div style="font-size:0.88rem; color:{TXT_MUTED}; margin-bottom:1rem;">'
                f'Add courses from the catalog below.</div>',
                unsafe_allow_html=True,
            )

        col_search, col_dept, col_level, col_status = st.columns([3, 2, 1, 1])
        with col_search:
            search = st.text_input("Search", placeholder="Course ID or name...", label_visibility="collapsed")
        with col_dept:
            dept_filter = st.multiselect(
                "Department", list(DEPT_LABELS.keys()),
                format_func=lambda x: DEPT_LABELS[x],
                default=list(DEPT_LABELS.keys()),
                label_visibility="collapsed",
            )
        with col_level:
            grad_filter = st.selectbox("Level", ["All", "UG", "Grad"], label_visibility="collapsed")
        with col_status:
            status_options = [f"Added ({n_added})", "Not Added", "All"]
            status_filter = st.selectbox("Status", status_options, index=0, label_visibility="collapsed")

        # ── Quick Add custom course (SCAD Serve, SCAD Pro, etc.) ─────────
        with st.expander("➕  Quick Add — SCAD Serve / SCAD Pro / one-off course"):
            st.markdown(
                f'<div style="font-size:0.84rem; color:{TXT_MUTED}; margin-bottom:12px;">'
                f'For courses that change every quarter and aren\'t in the standard catalog — '
                f'SCAD Serve, SCAD Pro, special topics, visiting faculty sections. '
                f'These are saved to the catalog as <strong style="color:{TXT_SECONDARY};">custom</strong> '
                f'entries so the solver can assign them a room and time slot.</div>',
                unsafe_allow_html=True,
            )

            _QUICK_ROOM_TYPES = [
                ("lecture_flex",   "Lecture/Zoom Room  — no PCs, Zoom-friendly (SCAD Serve, SCAD Pro)"),
                ("large_game_lab", "Room 156 – Game Lab  — 10 PCs, studio/senior space"),
                ("pc_lab",         "PC Lab  — full game dev software"),
                ("flex_studio",    "Design Studio  — no fixed PCs, bring-your-own"),
                ("mac_lab",        "Mac Lab  — motion media"),
            ]
            _QUICK_ROOM_KEYS   = [k for k, _ in _QUICK_ROOM_TYPES]
            _QUICK_ROOM_LABELS = [v for _, v in _QUICK_ROOM_TYPES]

            qa_c1, qa_c2 = st.columns(2)
            with qa_c1:
                qa_id   = st.text_input("Course ID",   placeholder="e.g. SERVE_F26, SCADPRO_001", key="qa_id")
                qa_name = st.text_input("Course Name", placeholder="e.g. SCAD Serve: Game Dept", key="qa_name")
                qa_dept = st.selectbox("Department", ["game", "motion_media", "ai"],
                                       format_func=lambda x: DEPT_LABELS[x], key="qa_dept")
                qa_grad = st.checkbox("Graduate course", key="qa_grad")
            with qa_c2:
                qa_room_idx = st.selectbox("Room Type", range(len(_QUICK_ROOM_TYPES)),
                                           format_func=lambda i: _QUICK_ROOM_LABELS[i], key="qa_room")
                qa_room_type = _QUICK_ROOM_KEYS[qa_room_idx]
                qa_priority  = st.selectbox("Priority", ["must_have", "should_have", "could_have"],
                                            format_func=lambda x: PRIORITY_LABELS[x], key="qa_pri")
                qa_sections  = st.number_input("Sections", min_value=1, max_value=4, value=1, key="qa_sec")
                qa_cap       = st.number_input("Enrollment Cap", min_value=1, max_value=30, value=20, key="qa_cap")

            qa_profs_raw = load_professors()
            qa_prof_opts = ["(none)"] + [
                p["id"] for p in qa_profs_raw if quarter in p.get("available_quarters", [])
            ]
            qa_prof_labels = {
                p["id"]: p["name"] for p in qa_profs_raw
            }
            qa_prof = st.selectbox(
                "Preferred Professor (optional)",
                qa_prof_opts,
                format_func=lambda x: qa_prof_labels.get(x, x) if x != "(none)" else "(none)",
                key="qa_prof",
            )
            qa_notes = st.text_input("Notes (optional)", placeholder="e.g. Fall 2026 section", key="qa_notes")

            if st.button("Add to Offerings", type="primary", key="qa_submit"):
                _cid   = qa_id.strip().upper().replace(" ", "_")
                _cname = qa_name.strip()
                _errs  = []
                if not _cid:
                    _errs.append("Course ID is required.")
                if not _cname:
                    _errs.append("Course Name is required.")
                if any(o["catalog_id"] == _cid for o in active_project["offerings"]):
                    _errs.append(f"'{_cid}' is already in this quarter's offerings.")

                if _errs:
                    for _e in _errs:
                        st.error(_e)
                else:
                    # Write to catalog if not already there
                    _catalog_raw = load_catalog()
                    _catalog_ids = {c["id"] for c in _catalog_raw}
                    if _cid not in _catalog_ids:
                        _new_course = {
                            "id":                  _cid,
                            "name":                _cname,
                            "department":          qa_dept,
                            "is_graduate":         qa_grad,
                            "credits":             3,
                            "required_room_type":  qa_room_type,
                            "specialization_tags": [],
                            "preferred_professors":[],
                            "enrollment_cap":      int(qa_cap),
                            "teaching_order":      9999,
                            "prerequisites":       [],
                            "description":         f"Custom course: {_cname}",
                            "source":              "manual",
                            "custom":              True,
                        }
                        _catalog_raw.append(_new_course)
                        with open(PROJECT_ROOT / "data" / "course_catalog.json", "w", encoding="utf-8") as _f:
                            json.dump(_catalog_raw, _f, indent=2, ensure_ascii=False)
                        load_catalog.clear()

                    # Add to session-state offerings
                    _prof_override = None
                    if qa_prof and qa_prof != "(none)":
                        _prof_override = [qa_prof]
                    active_project["offerings"].append({
                        "catalog_id":                  _cid,
                        "priority":                    qa_priority,
                        "sections":                    int(qa_sections),
                        "override_enrollment_cap":     int(qa_cap),
                        "override_room_type":          qa_room_type,
                        "override_preferred_professors": _prof_override,
                        "notes":                       qa_notes.strip() or None,
                        "custom":                      True,
                    })
                    st.success(f"Added **{_cid}** — {_cname}")
                    st.rerun()

        # ── Paste-Import from spreadsheet ────────────────────────────────
        with st.expander("📋  Paste from Spreadsheet — bulk import courses"):
            st.markdown(
                f'<div style="font-size:0.84rem; color:{TXT_MUTED}; margin-bottom:12px;">'
                f'Copy rows from Google Sheets or Excel and paste below. '
                f'The importer looks for columns like <strong style="color:{TXT_SECONDARY};">Course ID</strong>, '
                f'<strong style="color:{TXT_SECONDARY};">Course Name</strong>, '
                f'<strong style="color:{TXT_SECONDARY};">Room</strong>, '
                f'<strong style="color:{TXT_SECONDARY};">Professor</strong>, '
                f'<strong style="color:{TXT_SECONDARY};">Day/Time</strong>. '
                f'Column order doesn\'t matter — it auto-detects. Tab-separated (from spreadsheets) '
                f'or comma-separated both work.</div>',
                unsafe_allow_html=True,
            )

            paste_data = st.text_area(
                "Paste rows here",
                height=120,
                placeholder="GAME 425\tUnreal Networking\tRoom 263\tTue/Thu 8:00AM\tLindsay\nSERVE_F26\tSCAD Serve\tRoom 156\tMon/Wed 2:00PM\t...",
                key="paste_import",
                label_visibility="collapsed",
            )

            paste_room_default = st.selectbox(
                "Default room type (if not detected)",
                range(len(_QUICK_ROOM_TYPES)),
                format_func=lambda i: _QUICK_ROOM_LABELS[i],
                index=2,  # pc_lab default
                key="paste_room_default",
            )

            if paste_data and st.button("Parse & Preview", key="paste_parse"):
                import csv
                import io
                import re

                _lines = paste_data.strip().split("\n")
                # Detect delimiter
                _delim = "\t" if "\t" in paste_data else ","
                _reader = csv.reader(io.StringIO(paste_data.strip()), delimiter=_delim)
                _rows = list(_reader)

                if not _rows:
                    st.warning("No data found.")
                else:
                    # Try to detect header row
                    _header = [h.strip().lower().replace(" ", "_") for h in _rows[0]]
                    _COURSE_ID_HINTS = {"course_id", "id", "course", "course_code", "code", "crn", "catalog_id", "class"}
                    _NAME_HINTS = {"name", "course_name", "title", "description", "class_name"}
                    _ROOM_HINTS = {"room", "room_name", "location", "building", "room_number"}
                    _PROF_HINTS = {"professor", "prof", "instructor", "faculty", "teacher"}
                    _TIME_HINTS = {"time", "day_time", "schedule", "day/time", "days", "meeting", "day"}
                    _SECTION_HINTS = {"section", "sec", "sections"}

                    def _find_col(hints):
                        for i, h in enumerate(_header):
                            if h in hints or any(hint in h for hint in hints):
                                return i
                        return None

                    _id_col = _find_col(_COURSE_ID_HINTS)
                    _name_col = _find_col(_NAME_HINTS)
                    _room_col = _find_col(_ROOM_HINTS)
                    _prof_col = _find_col(_PROF_HINTS)
                    _time_col = _find_col(_TIME_HINTS)
                    _sec_col = _find_col(_SECTION_HINTS)

                    # If header detected, skip it; otherwise treat all rows as data
                    _has_header = _id_col is not None or _name_col is not None
                    _data_rows = _rows[1:] if _has_header else _rows

                    # If no header, assume: col0=ID, col1=Name, col2+=optional
                    if _id_col is None:
                        _id_col = 0
                    if _name_col is None:
                        _name_col = 1 if len(_rows[0]) > 1 else None

                    # Room number detection
                    _ROOM_MAP = {
                        "156": "large_game_lab",
                        "259": "pc_lab",
                        "260": "mac_lab",
                        "261": "pc_lab",
                        "263": "pc_lab",
                    }

                    def _detect_room(val):
                        if not val:
                            return _QUICK_ROOM_KEYS[paste_room_default]
                        val_clean = val.strip()
                        # Look for room numbers
                        nums = re.findall(r'\d{3}', val_clean)
                        for n in nums:
                            if n in _ROOM_MAP:
                                return _ROOM_MAP[n]
                        val_lower = val_clean.lower()
                        if "mac" in val_lower:
                            return "mac_lab"
                        if "zoom" in val_lower or "lecture" in val_lower or "flex" in val_lower:
                            return "lecture_flex"
                        if "studio" in val_lower or "design" in val_lower:
                            return "flex_studio"
                        if "156" in val_lower or "game lab" in val_lower:
                            return "large_game_lab"
                        return _QUICK_ROOM_KEYS[paste_room_default]

                    # Parse rows
                    _parsed = []
                    _existing_ids = {o["catalog_id"] for o in active_project["offerings"]}
                    for row in _data_rows:
                        if not row or not any(cell.strip() for cell in row):
                            continue
                        _cid = row[_id_col].strip().upper().replace(" ", "_").replace("-", "_") if _id_col is not None and _id_col < len(row) else ""
                        _cname = row[_name_col].strip() if _name_col is not None and _name_col < len(row) else _cid
                        _room_raw = row[_room_col].strip() if _room_col is not None and _room_col < len(row) else ""
                        _room_type = _detect_room(_room_raw)
                        _prof_raw = row[_prof_col].strip() if _prof_col is not None and _prof_col < len(row) else ""
                        _sec_raw = row[_sec_col].strip() if _sec_col is not None and _sec_col < len(row) else "1"
                        try:
                            _secs = int(_sec_raw)
                        except ValueError:
                            _secs = 1

                        if _cid:
                            _dup = _cid in _existing_ids
                            _parsed.append({
                                "id": _cid,
                                "name": _cname or _cid,
                                "room_type": _room_type,
                                "room_raw": _room_raw,
                                "prof_raw": _prof_raw,
                                "sections": max(1, _secs),
                                "duplicate": _dup,
                            })

                    if not _parsed:
                        st.warning("Couldn't parse any course rows from the pasted data.")
                    else:
                        st.session_state["_paste_parsed"] = _parsed
                        st.markdown(
                            f'<div style="font-size:0.85rem; font-weight:600; color:{TXT_PRIMARY}; '
                            f'margin:12px 0 8px 0;">Preview — {len(_parsed)} courses detected</div>',
                            unsafe_allow_html=True,
                        )
                        for _p in _parsed:
                            _dup_tag = ' <span style="color:{};">already added</span>'.format(ACCENT_AMBER) if _p["duplicate"] else ""
                            _room_label = next((l for k, l in _QUICK_ROOM_TYPES if k == _p["room_type"]), _p["room_type"])
                            _prof_bit = " · " + _p["prof_raw"] if _p.get("prof_raw") else ""
                            _preview_html = (
                                '<div style="font-size:0.84rem; color:{}; margin-bottom:4px;">'
                                '<span style="color:{}; font-weight:600;">{}</span> — '
                                '{} · <span style="color:{};">{}</span>{}{}</div>'
                            ).format(
                                TXT_SECONDARY, TXT_ACCENT, _p["id"],
                                _p["name"], TXT_MUTED, _room_label, _prof_bit, _dup_tag,
                            )
                            st.markdown(_preview_html, unsafe_allow_html=True)

            # Import button (only if we have parsed data)
            if "_paste_parsed" in st.session_state and st.session_state["_paste_parsed"]:
                _parsed = st.session_state["_paste_parsed"]
                _new_count = sum(1 for p in _parsed if not p["duplicate"])
                if _new_count > 0 and st.button(f"Import {_new_count} new courses", type="primary", key="paste_import_go"):
                    _catalog_raw = load_catalog()
                    _catalog_ids = {c["id"] for c in _catalog_raw}
                    _added = 0

                    for _p in _parsed:
                        if _p["duplicate"]:
                            continue
                        _cid = _p["id"]
                        # Add to catalog if not already there
                        if _cid not in _catalog_ids:
                            _catalog_raw.append({
                                "id":                  _cid,
                                "name":                _p["name"],
                                "department":          "game",
                                "is_graduate":         False,
                                "credits":             3,
                                "required_room_type":  _p["room_type"],
                                "specialization_tags": [],
                                "preferred_professors":[],
                                "enrollment_cap":      20,
                                "teaching_order":      9999,
                                "prerequisites":       [],
                                "description":         f"Imported: {_p['name']}",
                                "source":              "paste_import",
                                "custom":              True,
                            })
                            _catalog_ids.add(_cid)

                        active_project["offerings"].append({
                            "catalog_id":              _cid,
                            "priority":                "must_have",
                            "sections":                _p["sections"],
                            "override_room_type":      _p["room_type"],
                            "override_enrollment_cap": None,
                            "override_preferred_professors": None,
                            "notes":                   _p.get("prof_raw") or None,
                            "custom":                  True,
                        })
                        _added += 1

                    with open(PROJECT_ROOT / "data" / "course_catalog.json", "w", encoding="utf-8") as _f:
                        json.dump(_catalog_raw, _f, indent=2, ensure_ascii=False)
                    load_catalog.clear()
                    del st.session_state["_paste_parsed"]
                    st.success(f"Imported {_added} courses into this quarter's offerings.")
                    st.rerun()

        # ── Catalog course list ───────────────────────────────────────────
        for dept in dept_filter:
            courses = dept_courses.get(dept, [])
            filtered = courses

            if search:
                s = search.lower()
                filtered = [c for c in filtered if s in c["id"].lower() or s in c["name"].lower()]

            if grad_filter == "UG":
                filtered = [c for c in filtered if not c["is_graduate"]]
            elif grad_filter == "Grad":
                filtered = [c for c in filtered if c["is_graduate"]]

            if status_filter.startswith("Added"):
                filtered = [c for c in filtered if c["id"] in selected_ids]
            elif status_filter == "Not Added":
                filtered = [c for c in filtered if c["id"] not in selected_ids]

            if not filtered:
                continue

            dot_color = DEPT_DOT[dept]
            st.markdown(
                f'<div class="section-label">'
                f'<span class="dept-dot" style="background:{dot_color};"></span>'
                f'{DEPT_LABELS[dept]} — {len(filtered)} courses</div>',
                unsafe_allow_html=True,
            )

            for c in filtered:
                already = c["id"] in selected_ids
                grad_tag = f'<span class="cc-grad">GRAD</span>' if c["is_graduate"] else ""
                suggested = ", ".join(
                    p.replace("prof_", "").replace("_", " ").title()
                    for p in c.get("preferred_professors", [])[:3]
                )
                desc_escaped = html.escape(c.get("description", ""))

                card_html = (
                    f'<div class="course-tooltip-wrap">'
                    f'<div class="course-card"><div class="cc-top">'
                    f'<span class="dept-dot" style="background:{dot_color};"></span>'
                    f'<span class="cc-id">{c["id"]}</span>'
                    f'<span class="cc-title">{c["name"]}</span>{grad_tag}'
                    f'</div>'
                )
                if suggested:
                    card_html += f'<div class="cc-suggested">Suggested: {suggested}</div>'
                card_html += f'</div>'
                if desc_escaped:
                    card_html += f'<div class="course-tooltip">{desc_escaped}</div>'
                card_html += '</div>'

                col_card, col_btn = st.columns([7, 1])
                with col_card:
                    st.markdown(card_html, unsafe_allow_html=True)
                with col_btn:
                    st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)
                    if already:
                        if status_filter.startswith("Added"):
                            if st.button("Remove", key=f"rm_sel_{c['id']}", use_container_width=True):
                                active_project["offerings"] = [
                                    o for o in active_project["offerings"]
                                    if o["catalog_id"] != c["id"]
                                ]
                                st.rerun()
                        else:
                            st.button("Added", key=f"add_{c['id']}", disabled=True, use_container_width=True)
                    else:
                        if st.button("Add", key=f"add_{c['id']}", use_container_width=True):
                            active_project["offerings"].append({
                                "catalog_id": c["id"],
                                "priority": "must_have",
                                "sections": 1,
                                "override_enrollment_cap": None,
                                "override_room_type": None,
                                "override_preferred_professors": None,
                                "notes": None,
                            })
                            st.rerun()

    # ── Tab 2: Current Offerings ──────────────────────────────────────
    with tab_preview:
        offerings = active_project["offerings"]

        if not offerings:
            st.info("No courses selected yet. Use the **Select Courses** tab to add courses.")
        else:
            total_sections = sum(o.get("sections", 1) for o in offerings)
            must = sum(1 for o in offerings if o["priority"] == "must_have")
            should = sum(1 for o in offerings if o["priority"] == "should_have")
            could = sum(1 for o in offerings if o["priority"] == "could_have")

            c1, c2, c3, c4 = st.columns(4)
            for col, num, lbl in [
                (c1, len(offerings), "Courses"),
                (c2, total_sections, "Sections"),
                (c3, must, "Must Have"),
                (c4, should + could, "Should / Could"),
            ]:
                with col:
                    st.markdown(
                        f'<div class="metric-box"><div class="num">{num}</div><div class="lbl">{lbl}</div></div>',
                        unsafe_allow_html=True,
                    )

            st.markdown("")

            h1, h2, h3, h4 = st.columns([5, 2, 1, 0.6])
            with h1:
                st.markdown('<div class="table-header">Course</div>', unsafe_allow_html=True)
            with h2:
                st.markdown('<div class="table-header">Priority</div>', unsafe_allow_html=True)
            with h3:
                st.markdown('<div class="table-header">Sec</div>', unsafe_allow_html=True)
            with h4:
                st.markdown('<div class="table-header"></div>', unsafe_allow_html=True)

            catalog_lookup = {c["id"]: c for c in catalog}
            to_remove = []

            for idx, o in enumerate(offerings):
                cid = o["catalog_id"]
                course = catalog_lookup.get(cid, {})
                dept = course.get("department", "game")
                name = course.get("name", cid)
                grad = f'<span class="cc-grad">G</span>' if course.get("is_graduate") else ""
                dot_color = DEPT_DOT.get(dept, "#666")

                r1, r2, r3, r4 = st.columns([5, 2, 1, 0.6])

                with r1:
                    desc_escaped = html.escape(course.get("description", ""))
                    tooltip_html = (
                        f'<div class="course-tooltip">{desc_escaped}</div>'
                        if desc_escaped else ""
                    )
                    custom_badge = (
                        f'<span class="cc-grad" style="color:{ACCENT_AMBER}; border-color:{ACCENT_AMBER}40;">custom</span>'
                        if o.get("custom") else ""
                    )
                    st.markdown(
                        f'<div class="course-tooltip-wrap">'
                        f'<div style="padding:6px 0;">'
                        f'<span class="dept-dot" style="background:{dot_color};"></span>'
                        f'<span class="cc-id">{cid}</span> '
                        f'<span style="color:{TXT_SECONDARY}; font-size:0.85rem;">{name}</span> '
                        f'{grad}{custom_badge}</div>'
                        f'{tooltip_html}</div>',
                        unsafe_allow_html=True,
                    )

                with r2:
                    new_pri = st.selectbox(
                        "pri", ["must_have", "should_have", "could_have"],
                        format_func=lambda x: PRIORITY_LABELS[x],
                        index=["must_have", "should_have", "could_have"].index(o.get("priority", "must_have")),
                        key=f"pri_{idx}",
                        label_visibility="collapsed",
                    )
                    active_project["offerings"][idx]["priority"] = new_pri

                with r3:
                    new_sec = st.number_input(
                        "sec", min_value=1, max_value=4,
                        value=o.get("sections", 1),
                        key=f"sec_{idx}",
                        label_visibility="collapsed",
                    )
                    active_project["offerings"][idx]["sections"] = new_sec

                with r4:
                    if st.button("x", key=f"rm_{idx}", use_container_width=True):
                        to_remove.append(idx)

            if to_remove:
                for idx in sorted(to_remove, reverse=True):
                    active_project["offerings"].pop(idx)
                st.rerun()

    # ── Tab 3: Faculty Preferences ────────────────────────────────────
    with tab_faculty:
        st.markdown(
            f'<span style="font-weight:600; color:{TXT_PRIMARY};">{quarter.title()} {year}</span>'
            f'<span style="color:{TXT_MUTED};"> — Toggle availability, set max load and time preferences. '
            f'Saved into templates automatically.</span>',
            unsafe_allow_html=True,
        )
        st.markdown("")

        faculty = load_professors()

        prof_overrides = active_project.get("prof_overrides", {})
        if prof_overrides:
            apply_professor_overrides(faculty, prof