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
from datetime import datetime
from pathlib import Path

import streamlit as st

# ─── Version ────────────────────────────────────────────────────────
APP_VERSION = "1.8.0"

# ─── Session State Init ───────────────────────────────────────────────
if "active_project" not in st.session_state:
    st.session_state["active_project"] = None
if "draft_log" not in st.session_state:
    st.session_state["draft_log"] = []

def add_log(event_type, message):
    now = datetime.now().strftime("%H:%M:%S")
    st.session_state["draft_log"].insert(0, {"time": now, "type": event_type, "msg": message})
    # Keep last 15 items
    if len(st.session_state["draft_log"]) > 15:
        st.session_state["draft_log"] = st.session_state["draft_log"][:15]

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

DEPT_DOT    = {"game": "#60A5FA", "motion_media": "#A78BFA", "ai": "#FBBF24", "ixds": "#34D399", "iact": "#F472B6", "digi": "#FB923C", "adbr": "#E879F9"}
DEPT_LABELS = {"game": "Game Design", "motion_media": "Motion Media", "ai": "AI", "ixds": "Interactive Design", "iact": "Interaction Design", "digi": "Digital Communication", "adbr": "Advertising & Branding"}
PRIORITY_LABELS = {"must_have": "Must", "should_have": "Should", "could_have": "Could", "nice_to_have": "Nice"}
TIME_PREF_LABELS = {"morning": "Morning", "afternoon": "Afternoon", "afternoon_evening": "Afternoon / Evening"}

# ─── Page Config ─────────────────────────────────────────────────────
st.set_page_config(
    page_title="Course Scheduler",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Global CSS ──────────────────────────────────────────────────────
CSS_TEMPLATE = """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .stApp {{
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: {BG_BASE};
        color: {TXT_PRIMARY};
    }}
    .block-container {{ padding-top: 3rem; max-width: 1400px; }}
    /* Hide Deploy + hamburger, keep sidebar expand arrow */
    [data-testid="stToolbarActions"] {{ display: none !important; }}
    [data-testid="stAppDeployButton"] {{ display: none !important; }}
    [data-testid="stMainMenu"] {{ display: none !important; }}
    [data-testid="stSidebarCollapseButton"] {{ visibility: visible !important; }}

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
        padding: 4px 10px !important; border-radius: 6px !important;
        transition: all 0.15s ease !important; min-height: 28px !important;
        line-height: 1.4 !important; margin-top: 2px !important;
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
        min-height: 32px !important; height: 32px !important; padding: 0 8px !important;
    }}
    .stSelectbox > div > div > div {{ padding-bottom: 0 !important; padding-top: 0 !important; }}

    div[data-testid="stToggle"] {{ padding-top: 2px; }}

    /* ── Multiselect Tags (Absolute Neutralization) ── */
    div[data-baseweb="tag"], div[role="button"][aria-label*="Remove"] {{
        background-color: {BG_HOVER} !important;
        border: 1px solid {BORDER} !important;
        color: {TXT_SECONDARY} !important;
    }}
    div[data-baseweb="tag"] span, div[data-baseweb="tag"] div, .stMultiSelect span {{
        color: {TXT_SECONDARY} !important;
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
"""
st.markdown(CSS_TEMPLATE.format(
    BG_BASE=BG_BASE, BG_CARD=BG_CARD, BG_HOVER=BG_HOVER, BG_SIDEBAR=BG_SIDEBAR,
    BORDER=BORDER, BORDER_LITE=BORDER_LITE,
    TXT_PRIMARY=TXT_PRIMARY, TXT_SECONDARY=TXT_SECONDARY, TXT_MUTED=TXT_MUTED, TXT_ACCENT=TXT_ACCENT,
    ACCENT=ACCENT, ACCENT_GREEN=ACCENT_GREEN, ACCENT_AMBER=ACCENT_AMBER, ACCENT_RED=ACCENT_RED
), unsafe_allow_html=True)

# ─── Sidebar Branding ───────────────────────────────────────────────
st.sidebar.markdown(
    f'<div style="font-weight:700; font-size:1.1rem; color:{TXT_PRIMARY}; letter-spacing:-0.02em;">Course Scheduler</div>'
    f'<div style="font-size:0.65rem; color:{TXT_MUTED}; margin-bottom:1rem;">SCAD Atlanta &middot; v{APP_VERSION}</div>',
    unsafe_allow_html=True,
)

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

    # ── Start Fresh ──────────────────────────────────────────────────
    st.markdown(f'<div class="section-label">Start Fresh</div>', unsafe_allow_html=True)

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
        if st.button("Create New Schedule", type="primary", use_container_width=True):
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

    # ── Sidebar: workspace controls ─────────────────────────────────
    with st.sidebar:
        if st.button("← Directory", use_container_width=True, key="back_btn"):
            st.session_state["active_project"] = None
            st.rerun()

        st.markdown(f'<div class="section-label" style="margin-top:0.5rem;">{quarter.title()} {year}</div>', unsafe_allow_html=True)

        # Save template
        sb1, sb2 = st.columns([3, 1])
        with sb1:
            tmpl_name = st.text_input("Template name", placeholder="Save as...", label_visibility="collapsed", key="board_save")
        with sb2:
            if st.button("Save", use_container_width=True):
                if active_project["offerings"]:
                    save_template(tmpl_name or f"{quarter}_{year}", active_project["offerings"], active_project.get("prof_overrides"), quarter)
                    st.success("Saved")
                else: st.warning("Empty")

        # Metrics
        offerings_sb = active_project["offerings"]
        total_sections_sb = sum(o.get("sections", 1) for o in offerings_sb)
        st.markdown(
            f'<div style="font-size:0.82rem; color:{TXT_PRIMARY}; margin:8px 0;">'
            f'<b>{len(offerings_sb)}</b> <span style="color:{TXT_MUTED};">courses</span> &middot; '
            f'<b>{total_sections_sb}</b> <span style="color:{TXT_MUTED};">sections</span></div>',
            unsafe_allow_html=True,
        )
        # Roster (collapsible)
        with st.expander("Roster", expanded=False):
            faculty = load_professors()
            prof_overrides = active_project.get("prof_overrides", {})
            if prof_overrides:
                apply_professor_overrides(faculty, prof_overrides, quarter)

            for p in faculty:
                pid = p["id"]
                available = quarter in p.get("available_quarters", [])
                dot_color = DEPT_DOT.get(p.get("home_department", "game"), "#666")

                with st.container():
                    f_c1, f_c2 = st.columns([1, 4])
                    with f_c1:
                        new_avail = st.toggle("avail", value=available, key=f"roster_avail_{pid}", label_visibility="collapsed")
                    with f_c2:
                        st.markdown(
                            f'<div style="padding-top:2px;">'
                            f'<span class="dept-dot" style="background:{dot_color if new_avail else "#333"};"></span>'
                            f'<span style="font-weight:600; font-size:0.85rem; color:{TXT_PRIMARY if new_avail else TXT_MUTED};">{p["name"]}</span>'
                            f'</div>',
                            unsafe_allow_html=True
                        )

                    if new_avail:
                        m_col, t_col = st.columns([1, 2])
                        with m_col:
                            new_max = st.number_input("Max", 1, 6, p.get("max_classes", 4), key=f"roster_max_{pid}", label_visibility="collapsed")
                        with t_col:
                            time_opts = list(TIME_PREF_LABELS.keys())
                            new_time = st.selectbox("Time", time_opts, format_func=lambda x: TIME_PREF_LABELS[x], index=time_opts.index(p.get("time_preference", "morning")), key=f"roster_time_{pid}", label_visibility="collapsed")
                    else:
                        new_max = p.get("max_classes", 4)
                        new_time = p.get("time_preference", "morning")

                    if "prof_overrides" not in active_project: active_project["prof_overrides"] = {}
                    active_project["prof_overrides"][pid] = {"max_classes": new_max, "time_preference": new_time, "available": new_avail}

                    st.markdown(f'<div style="margin-bottom:4px; border-bottom:1px solid {BORDER_LITE};"></div>', unsafe_allow_html=True)

        # Draft Ticker
        st.markdown(f'<div class="section-label" style="margin-top:1rem;">Draft Ticker</div>', unsafe_allow_html=True)
        log = st.session_state.get("draft_log", [])
        if log:
            EVENT_COLORS = {"DRAFT": ACCENT, "DROP": ACCENT_RED, "ASSIGN": ACCENT_GREEN, "AUTO": ACCENT_AMBER, "PIN": TXT_ACCENT}
            for entry in log:
                ev_color = EVENT_COLORS.get(entry["type"], TXT_MUTED)
                st.markdown(
                    f'<div style="font-size:0.75rem; color:{TXT_MUTED}; padding:3px 0; border-bottom:1px solid {BORDER_LITE};">'
                    f'<span style="color:{ev_color}; font-weight:600;">{entry["type"]}</span> '
                    f'{html.escape(entry["msg"])} '
                    f'<span style="color:#3F3F46; font-size:0.65rem;">{entry["time"]}</span>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
        else:
            st.markdown(f'<div style="font-size:0.75rem; color:{TXT_MUTED}; font-style:italic;">No activity yet.</div>', unsafe_allow_html=True)

    # ── Data setup (shared by calendar + draft cards) ─────────────
    offerings = active_project["offerings"]
    catalog_lookup = {c["id"]: c for c in catalog}
    selected_ids = {o["catalog_id"] for o in offerings}

    DG_LABELS = {1: "MW", 2: "TTh"}
    pinned_map = {}
    for _i, _o in enumerate(offerings):
        _pin = _o.get("pinned")
        if _pin:
            _key = (_pin["day_group"], _pin["time_slot"])
            pinned_map.setdefault(_key, []).append((_i, _o, catalog_lookup.get(_o["catalog_id"], {})))

    def has_pin_conflict(target_dg, target_ts, placing_idx):
        placing_o = offerings[placing_idx]
        p_profs = placing_o.get("override_preferred_professors") or []
        if not p_profs:
            return False
        for _i, _o in enumerate(offerings):
            if _i == placing_idx:
                continue
            _pin = _o.get("pinned")
            if _pin and _pin["day_group"] == target_dg and _pin["time_slot"] == target_ts:
                o_profs = _o.get("override_preferred_professors") or []
                if o_profs and o_profs[0] == p_profs[0]:
                    return True
        return False

    available_profs = [p for p in load_professors() if active_project.get("prof_overrides", {}).get(p["id"], {}).get("available", True)]
    prof_options = ["Auto-Draft"] + [p["id"] for p in available_profs]
    prof_labels = {p["id"]: p["name"] for p in available_profs}
    prof_labels["Auto-Draft"] = "Auto-Draft"

    # ══════════════════════════════════════════════════════════════════
    # CALENDAR GRID (full-width, sticky at top)
    # ══════════════════════════════════════════════════════════════════
    # Ghost pin pulse + sticky calendar CSS (single style block to keep nth-child stable)
    has_unpinned = any(not o.get("pinned") for o in offerings) if offerings else False
    st.markdown(
        f'<style>'
        f'  @keyframes ghost-pulse {{ 0%, 100% {{ opacity: 0.12; }} 50% {{ opacity: 0.25; }} }}'
        f'  .ghost-pin {{ text-align:center; padding:8px; border:1px dashed {BORDER_LITE}; border-radius:6px; min-height:20px; font-size:0.8rem; color:#3F3F46; }}'
        f'  .ghost-pin.pulse {{ animation: ghost-pulse 3s ease-in-out infinite; }}'
        f'  /* Vertically center buttons within course rows, but top-align main columns */'
        f'  [data-testid="stColumn"] [data-testid="stHorizontalBlock"] {{ align-items: center !important; }}'
        f'  /* Freeze calendar row */'
        f'  [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > [data-testid="stLayoutWrapper"]:nth-child(3) {{'
        f'    position: sticky !important; top: 48px !important; z-index: 50 !important;'
        f'    background: {BG_BASE} !important; padding-bottom: 8px;'
        f'    border-bottom: 1px solid {BORDER};'
        f'  }}'
        f'</style>',
        unsafe_allow_html=True,
    )

    cal_container = st.container()
    with cal_container:
        col_preview, col_cal = st.columns([2, 4])

        # ── SEARCH + CLASS PREVIEW (left of calendar, frozen) ────
        with col_preview:
            # Search
            search = st.text_input("Search", placeholder="Course ID or name...", label_visibility="collapsed", key="scout_search")

            # Department toggles (compact popover)
            if "active_depts" not in st.session_state:
                st.session_state["active_depts"] = ["game"]
            with st.popover("Depts", use_container_width=True):
                for dk, dl in DEPT_LABELS.items():
                    dot = DEPT_DOT.get(dk, "#666")
                    is_on = dk in st.session_state["active_depts"]
                    if st.checkbox(dl, value=is_on, key=f"dept_tog_{dk}"):
                        if dk not in st.session_state["active_depts"]:
                            st.session_state["active_depts"].append(dk)
                    else:
                        if dk in st.session_state["active_depts"]:
                            st.session_state["active_depts"].remove(dk)
            dept_filter = st.session_state["active_depts"]

            # Active dept dots
            if dept_filter:
                dots_html = " ".join(f'<span class="dept-dot" style="background:{DEPT_DOT.get(d, "#666")}; width:6px; height:6px;"></span>' for d in dept_filter)
                st.markdown(f'<div style="margin:-8px 0 4px 0;">{dots_html}</div>', unsafe_allow_html=True)

            # Class Preview card (fixed height, no overflow)
            inspect = st.session_state.get("inspected_course")
            if inspect:
                _desc = html.escape(inspect.get("description", "No description available."))
                _room = inspect.get("required_room_type", "Any").replace("_", " ").title()
                _profs = inspect.get("preferred_professors", [])
                _prof_str = ", ".join(p.replace("prof_", "").replace("_", " ").title() for p in _profs[:2]) if _profs else "—"
                _grad = f'<span style="font-size:0.55rem; background:{BG_HOVER}; border:1px solid {BORDER}; border-radius:3px; padding:0px 4px; margin-left:4px; color:{TXT_MUTED};">GRAD</span>' if inspect.get("is_graduate") else ""
                _dept = inspect.get("department", "game")
                _dot = DEPT_DOT.get(_dept, "#666")
                st.markdown(
                    f'<div style="background:{BG_CARD}; border:1px solid {ACCENT}40; border-radius:8px; padding:10px; max-height:180px; overflow:hidden;">'
                    f'<div style="font-size:0.7rem; font-weight:700; color:{TXT_ACCENT};">'
                    f'<span class="dept-dot" style="background:{_dot};"></span>{inspect["id"]}{_grad}</div>'
                    f'<div style="font-size:0.75rem; font-weight:500; color:{TXT_PRIMARY}; margin:2px 0 4px 0;">{html.escape(inspect["name"])}</div>'
                    f'<div style="font-size:0.65rem; color:{TXT_MUTED}; line-height:1.4; max-height:2.8em; overflow:hidden;">{_desc}</div>'
                    f'<div style="margin-top:4px; font-size:0.62rem; color:{TXT_MUTED};">'
                    f'{_room} &middot; {_prof_str}'
                    f'</div>'
                    f'</div>',
                    unsafe_allow_html=True
                )
            else:
                st.markdown(
                    f'<div style="background:{BG_CARD}; border:1px solid {BORDER}; border-radius:8px; padding:10px;'
                    f' text-align:center; max-height:180px;">'
                    f'<div style="font-size:1.2rem; opacity:0.12; margin-bottom:2px;">📋</div>'
                    f'<div style="font-size:0.68rem; color:{TXT_MUTED};">Click a course to preview</div>'
                    f'</div>',
                    unsafe_allow_html=True
                )

        # ── CALENDAR GRID (right) ────────────────────────────────
        with col_cal:
            solver_results = st.session_state.get("solver_results")
            has_results = solver_results is not None

            # ── Generate button + mode selector ──────────────────
            if has_results:
                # Mode selector + stats
                mode_idx = {"affinity_first": 0, "time_pref_first": 1, "balanced": 2}
                current_mode = st.session_state.get("solver_mode", "balanced")
                mode_data = solver_results["modes"][mode_idx[current_mode]]

                gc_m1, gc_m2, gc_m3, gc_stat = st.columns([1, 1, 1, 2])
                with gc_m1:
                    if st.button("Affinity", use_container_width=True, type="primary" if current_mode == "affinity_first" else "secondary"):
                        st.session_state["solver_mode"] = "affinity_first"
                        st.rerun()
                with gc_m2:
                    if st.button("Time Pref", use_container_width=True, type="primary" if current_mode == "time_pref_first" else "secondary"):
                        st.session_state["solver_mode"] = "time_pref_first"
                        st.rerun()
                with gc_m3:
                    if st.button("Balanced", use_container_width=True, type="primary" if current_mode == "balanced" else "secondary"):
                        st.session_state["solver_mode"] = "balanced"
                        st.rerun()
                with gc_stat:
                    n_placed = len(mode_data["schedule"])
                    n_unsched = len(mode_data["unscheduled"])
                    status = mode_data["status"].upper()
                    score = mode_data.get("objective", "—")
                    stat_color = ACCENT_GREEN if status == "OPTIMAL" else ACCENT_AMBER
                    st.markdown(
                        f'<div style="font-size:0.68rem; color:{stat_color}; text-align:right; padding:4px 0;">'
                        f'{status} &middot; {n_placed} placed &middot; {n_unsched} dropped &middot; score {score}</div>',
                        unsafe_allow_html=True,
                    )

                # Build solver schedule lookup
                solve_map = {}  # {(day_group, time_slot): [assignment_dicts]}
                for a in mode_data["schedule"]:
                    key = (a["day_group"], a["time_slot"])
                    solve_map.setdefault(key, []).append(a)

            else:
                # Pre-generate: show placing status + generate button
                placing_idx = st.session_state.get("placing_offering_idx")
                placing_cid = None
                if placing_idx is not None and offerings and placing_idx < len(offerings):
                    placing_cid = offerings[placing_idx]["catalog_id"]
                    st.markdown(
                        f'<div style="font-size:0.78rem; color:{ACCENT}; margin-bottom:4px;">'
                        f'Placing <b>{placing_cid}</b> — click a slot</div>',
                        unsafe_allow_html=True,
                    )

                if offerings:
                    if st.button("Generate Schedule", type="primary", use_container_width=True, key="gen_btn"):
                        save_offerings(quarter, year, offerings)
                        save_professors_to_disk(load_professors())
                        with st.spinner("Solving 3 schedules..."):
                            results = run_schedule(quarter)
                        st.session_state["solver_results"] = results
                        st.session_state["solver_mode"] = "balanced"
                        add_log("SOLVE", f"Generated — {len(results['modes'])} options")
                        st.rerun()
                else:
                    st.markdown(f'<div style="height:22px;"></div>', unsafe_allow_html=True)

            # ── Grid header ──────────────────────────────────────
            hc1, hc2, hc3 = st.columns([0.6, 3, 3])
            with hc1:
                st.markdown(f'<div style="font-size:0.65rem; color:{TXT_MUTED}; padding:6px 0;"></div>', unsafe_allow_html=True)
            with hc2:
                st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">MW</div>', unsafe_allow_html=True)
            with hc3:
                st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">TTh</div>', unsafe_allow_html=True)

            # ── Grid rows ────────────────────────────────────────
            for ts in config.TIME_SLOTS:
                tc1, tc2, tc3 = st.columns([0.6, 3, 3])
                with tc1:
                    st.markdown(f'<div style="font-size:0.68rem; font-weight:600; color:{TXT_MUTED}; text-align:right; padding:10px 2px 10px 0;">{ts}</div>', unsafe_allow_html=True)

                for dg, col in [(1, tc2), (2, tc3)]:
                    with col:
                        cell_key = (dg, ts)
                        total_rooms = len(rooms)

                        if has_results:
                            # ── POST-GENERATE: show solver assignments ──
                            solved_here = solve_map.get(cell_key, [])
                            if solved_here:
                                for a in solved_here:
                                    _dept = a.get("department", "game")
                                    _dot = DEPT_DOT.get(_dept, "#666")
                                    # Color by affinity: 0-1 green, 2 amber, 3+ red
                                    _aff = a.get("affinity_level", 3)
                                    _aff_color = ACCENT_GREEN if _aff <= 1 else (ACCENT_AMBER if _aff == 2 else ACCENT_RED)
                                    _room_short = a.get("room_name", "").split("–")[0].strip() if a.get("room_name") else ""
                                    st.markdown(
                                        f'<div class="cal-course locked" style="border-left-color:{_aff_color};">'
                                        f'<div class="cal-cid"><span class="dept-dot" style="background:{_dot};"></span>{a["catalog_id"]}</div>'
                                        f'<div class="cal-detail">{a["prof_name"]} &middot; {_room_short}</div>'
                                        f'</div>',
                                        unsafe_allow_html=True,
                                    )
                                # Capacity
                                n_here = len(solved_here)
                                cap_color = ACCENT_AMBER if n_here >= total_rooms else TXT_MUTED
                                st.markdown(f'<div style="font-size:0.6rem; color:{cap_color}; text-align:right; padding:1px 4px;">{n_here}/{total_rooms}</div>', unsafe_allow_html=True)
                            else:
                                st.markdown(f'<div class="ghost-pin"></div>', unsafe_allow_html=True)

                        else:
                            # ── PRE-GENERATE: show pinned courses + placement ──
                            pinned_here = pinned_map.get(cell_key, [])
                            n_pinned = len(pinned_here)
                            over_cap = n_pinned > total_rooms

                            if pinned_here:
                                for _pi, _po, _pc in pinned_here:
                                    _dept = _pc.get("department", "game")
                                    _dot = DEPT_DOT.get(_dept, "#666")
                                    _prof_list = _po.get("override_preferred_professors") or []
                                    _prof_name = prof_labels.get(_prof_list[0], _prof_list[0]) if _prof_list else "Auto"
                                    st.markdown(
                                        f'<div class="cal-course locked">'
                                        f'<div class="cal-cid"><span class="dept-dot" style="background:{_dot};"></span>{_po["catalog_id"]}</div>'
                                        f'<div class="cal-detail">{_prof_name}</div>'
                                        f'</div>',
                                        unsafe_allow_html=True,
                                    )

                            if n_pinned > 0:
                                cap_color = ACCENT_RED if over_cap else (ACCENT_AMBER if n_pinned >= total_rooms else TXT_MUTED)
                                warn = " !" if over_cap else ""
                                st.markdown(f'<div style="font-size:0.6rem; color:{cap_color}; text-align:right; padding:1px 4px;">{n_pinned}/{total_rooms}{warn}</div>', unsafe_allow_html=True)

                            if not has_results and placing_idx is not None and offerings and placing_idx < len(offerings):
                                conflict = has_pin_conflict(dg, ts, placing_idx)
                                if conflict:
                                    if not pinned_here:
                                        st.markdown(f'<div style="padding:8px; border:1px dashed {BORDER_LITE}; border-radius:6px; text-align:center; color:#3F3F46; font-size:0.7rem;">conflict</div>', unsafe_allow_html=True)
                                else:
                                    dg_label = DG_LABELS[dg]
                                    if st.button(f"+ {dg_label} {ts}", key=f"pin_{dg}_{ts}", use_container_width=True):
                                        offerings[placing_idx]["pinned"] = {"day_group": dg, "time_slot": ts}
                                        add_log("PIN", f"Pinned {placing_cid} to {dg_label} {ts}")
                                        st.session_state["placing_offering_idx"] = None
                                        st.rerun()
                            elif not pinned_here and not has_results:
                                pulse_class = "pulse" if has_unpinned else ""
                                ghost = "📍" if has_unpinned else ""
                                st.markdown(f'<div class="ghost-pin {pulse_class}">{ghost}</div>', unsafe_allow_html=True)

            # ── Unscheduled warnings ─────────────────────────────
            if has_results:
                unsched = mode_data.get("unscheduled", [])
                if unsched:
                    st.markdown(f'<div style="margin-top:8px; font-size:0.72rem; color:{ACCENT_AMBER}; font-weight:600;">Unscheduled ({len(unsched)})</div>', unsafe_allow_html=True)
                    for u in unsched:
                        st.markdown(f'<div style="font-size:0.68rem; color:{TXT_MUTED}; padding:1px 0;">{u["catalog_id"]} ({u["priority"]})</div>', unsafe_allow_html=True)


    # ══════════════════════════════════════════════════════════════════
    # COURSE LIST (left) + DRAFT CARDS (right) — scroll together
    # ══════════════════════════════════════════════════════════════════
    col_list, col_draft = st.columns([2, 4])
    with col_list:
        for dept in dept_filter:
            courses = dept_courses.get(dept, [])
            filtered = courses
            if search:
                s = search.lower()
                filtered = [c for c in filtered if s in c["id"].lower() or s in c["name"].lower()]

            if not filtered: continue

            dot_color = DEPT_DOT.get(dept, "#666")
            st.markdown(f'<div style="font-size:0.65rem; font-weight:700; color:{TXT_MUTED}; margin-top:10px; border-bottom:1px solid {BORDER_LITE};">{DEPT_LABELS[dept].upper()}</div>', unsafe_allow_html=True)

            inspected_id = (st.session_state.get("inspected_course") or {}).get("id")

            for c in filtered:
                already = c["id"] in selected_ids
                is_inspected = c["id"] == inspected_id
                rc1, rc2 = st.columns([4, 1])
                with rc1:
                    if st.button(
                        f"{c['id']}  {c['name']}", key=f"preview_{c['id']}",
                        use_container_width=True, type="primary" if is_inspected else "secondary"
                    ):
                        st.session_state["inspected_course"] = c
                        st.rerun()
                with rc2:
                    if already:
                        if st.button("DROP", key=f"rm_scout_{c['id']}", use_container_width=True, type="primary"):
                            active_project["offerings"] = [o for o in active_project["offerings"] if o["catalog_id"] != c["id"]]
                            add_log("DROP", f"Removed {c['id']} from draft")
                            st.rerun()
                    else:
                        if st.button("ADD", key=f"add_scout_{c['id']}", use_container_width=True):
                            active_project["offerings"].append({
                                "catalog_id": c["id"], "priority": "must_have", "sections": 1,
                                "override_enrollment_cap": None, "override_room_type": None,
                                "override_preferred_professors": None, "notes": None,
                            })
                            add_log("DRAFT", f"Drafted {c['id']} to the Bench")
                            st.rerun()

    # ── DRAFT CARDS (right column) ───────────────────────────────
    with col_draft:
        if offerings:
            st.markdown(f'<div class="section-label" style="margin-top:0;">Draft Cards ({len(offerings)})</div>', unsafe_allow_html=True)

            for idx, o in enumerate(offerings):
                cid = o["catalog_id"]
                course = catalog_lookup.get(cid, {})
                _dept = course.get("department", "game")
                _dot = DEPT_DOT.get(_dept, "#666")

                rc_name, rc_pri, rc_sec, rc_prof, rc_pin, rc_rm = st.columns([3, 1, 0.7, 2, 1, 0.5], gap="small")
                with rc_name:
                    st.markdown(
                        f'<div style="padding:4px 0; font-size:0.8rem; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">'
                        f'<span class="dept-dot" style="background:{_dot};"></span>'
                        f'<span class="cc-id">{cid}</span> '
                        f'<span style="color:{TXT_SECONDARY};">{course.get("name", cid)}</span></div>',
                        unsafe_allow_html=True
                    )
                with rc_rm:
                    if st.button("×", key=f"board_rm_{idx}", help="Remove"):
                        active_project["offerings"].pop(idx)
                        st.rerun()
                with rc_pri:
                    new_pri = st.selectbox("pri", list(PRIORITY_LABELS.keys()), format_func=lambda x: PRIORITY_LABELS[x], index=list(PRIORITY_LABELS.keys()).index(o.get("priority", "must_have")), key=f"board_pri_{idx}", label_visibility="collapsed")
                    active_project["offerings"][idx]["priority"] = new_pri
                with rc_sec:
                    new_sec = st.number_input("sec", min_value=1, max_value=4, value=o.get("sections", 1), key=f"board_sec_{idx}", label_visibility="collapsed")
                    active_project["offerings"][idx]["sections"] = new_sec
                with rc_prof:
                    current_prof_list = o.get("override_preferred_professors")
                    current_prof = current_prof_list[0] if current_prof_list else "Auto-Draft"
                    if current_prof not in prof_options:
                        current_prof = "Auto-Draft"
                    new_prof = st.selectbox(
                        "prof", prof_options,
                        format_func=lambda x: prof_labels[x],
                        index=prof_options.index(current_prof),
                        key=f"board_prof_{idx}",
                        label_visibility="collapsed"
                    )
                    if new_prof != current_prof:
                        if new_prof == "Auto-Draft":
                            active_project["offerings"][idx]["override_preferred_professors"] = None
                            add_log("AUTO", f"Reverted {cid} to Auto-Draft")
                        else:
                            active_project["offerings"][idx]["override_preferred_professors"] = [new_prof]
                            add_log("ASSIGN", f"Assigned {prof_labels[new_prof]} to {cid}")
                        st.rerun()
                with rc_pin:
                    pin = o.get("pinned")
                    if pin:
                        dg_lbl = DG_LABELS[pin["day_group"]]
                        st.markdown(f'<div style="font-size:0.7rem; color:{ACCENT}; font-weight:600; padding-top:6px;">🔒 {dg_lbl} {pin["time_slot"]}</div>', unsafe_allow_html=True)
                        if st.button("×", key=f"unpin_{idx}", help="Unpin"):
                            active_project["offerings"][idx]["pinned"] = None
                            add_log("UNPIN", f"Unpinned {cid}")
                            st.rerun()
                    else:
                        is_placing = st.session_state.get("placing_offering_idx") == idx
                        btn_label = "📍" if not is_placing else "⌛"
                        if st.button(btn_label, key=f"place_btn_{idx}", help="Place on Calendar"):
                            if is_placing:
                                st.session_state["placing_offering_idx"] = None
                            else:
                                st.session_state["placing_offering_idx"] = idx
                            st.rerun()
