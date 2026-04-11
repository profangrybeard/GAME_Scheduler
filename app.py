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
APP_VERSION = "1.5.3"

st.sidebar.code(f"v{APP_VERSION}")

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
        padding: 0px 10px !important; border-radius: 6px !important;
        transition: all 0.15s ease !important; min-height: 28px !important; height: 28px !important;
        line-height: 1.6 !important; margin-top: 4px !important;
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
    f'<div style="display:flex; justify-content:space-between; align-items:flex-start; padding:1rem; margin-bottom:1rem; border:2px solid {ACCENT}; border-radius:10px; background:{BG_CARD};">'
    f'<div>'
    f'  <div class="app-header">Course Scheduler</div>'
    f'  <div class="app-sub">SCAD Atlanta &nbsp;&middot;&nbsp; Game Design &nbsp;&middot;&nbsp; Motion Media &nbsp;&middot;&nbsp; AI</div>'
    f'</div>'
    f'<div style="background:{ACCENT}; color:#FFF; padding:4px 12px; border-radius:20px; font-weight:700; font-size:0.8rem;">'
    f'  v{APP_VERSION}'
    f'</div>'
    f'</div>',
    unsafe_allow_html=True,
)


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
# SCREEN 2 — Active Workspace (Draft Room)
# ══════════════════════════════════════════════════════════════════════
else:
    quarter = active_project["quarter"]
    year = active_project["year"]

    # ── 3-Column Workspace Layout ────────────────────────────────────
    col_scout, col_board, col_roster = st.columns([1.2, 3.5, 1.3])

    # ══════════════════════════════════════════════════════════════════
    # COLUMN 1: SEARCH (Catalog)
    # ══════════════════════════════════════════════════════════════════
    with col_scout:
        # Mini Header
        c_back, c_ver = st.columns([3, 2])
        with c_back:
            if st.button("← Directory", use_container_width=True, key="back_btn"):
                st.session_state["active_project"] = None
                st.rerun()
        with c_ver:
            st.markdown(f'<div style="font-size:0.65rem; color:{TXT_MUTED}; text-align:right; padding-top:8px;">v{APP_VERSION}</div>', unsafe_allow_html=True)

        st.markdown(f'<div class="section-label" style="margin-top:0.5rem;">Search</div>', unsafe_allow_html=True)
        
        offerings = active_project["offerings"]
        selected_ids = {o["catalog_id"] for o in offerings}
        n_added = len(selected_ids)

        search = st.text_input("Search", placeholder="Course ID...", label_visibility="collapsed", key="scout_search")
        
        dept_filter = st.multiselect(
            "Dept", list(DEPT_LABELS.keys()),
            format_func=lambda x: DEPT_LABELS[x],
            default=["game"],
            key="scout_dept"
        )
        
        # Catalog course list
        for dept in dept_filter:
            courses = dept_courses.get(dept, [])
            filtered = courses
            if search:
                s = search.lower()
                filtered = [c for c in filtered if s in c["id"].lower() or s in c["name"].lower()]

            if not filtered: continue

            dot_color = DEPT_DOT.get(dept, "#666")
            st.markdown(f'<div style="font-size:0.65rem; font-weight:700; color:{TXT_MUTED}; margin-top:10px; border-bottom:1px solid {BORDER_LITE};">{DEPT_LABELS[dept].upper()}</div>', unsafe_allow_html=True)

            for c in filtered:
                already = c["id"] in selected_ids

                with st.container():
                    c1, c2 = st.columns([6, 1])
                    with c1:
                        # Course label — click to preview
                        id_color = TXT_MUTED if already else TXT_ACCENT
                        name_color = TXT_MUTED if already else TXT_PRIMARY
                        if st.button(f"{c['id']}  {c['name']}", key=f"preview_{c['id']}", use_container_width=True, help="Preview"):
                            st.session_state["inspected_course"] = c
                            st.rerun()
                    with c2:
                        if already:
                            if st.button("×", key=f"rm_scout_{c['id']}", help="Remove from draft"):
                                active_project["offerings"] = [o for o in active_project["offerings"] if o["catalog_id"] != c["id"]]
                                add_log("DROP", f"Removed {c['id']} from draft")
                                st.rerun()
                        else:
                            if st.button("+", key=f"add_scout_{c['id']}", help="Add to draft"):
                                active_project["offerings"].append({
                                    "catalog_id": c["id"], "priority": "must_have", "sections": 1,
                                    "override_enrollment_cap": None, "override_room_type": None,
                                    "override_preferred_professors": None, "notes": None,
                                })
                                add_log("DRAFT", f"Drafted {c['id']} to the Bench")
                                st.rerun()

        # ── CLASS PREVIEW ──
        st.markdown(f'<div class="section-label" style="margin-top:1.5rem;">Class Preview</div>', unsafe_allow_html=True)
        inspect = st.session_state.get("inspected_course")
        if inspect:
            _desc = html.escape(inspect.get("description", "No description available."))
            _room = inspect.get("required_room_type", "Any").replace("_", " ").title()
            _profs = inspect.get("preferred_professors", [])
            _prof_str = ", ".join(p.replace("prof_", "").replace("_", " ").title() for p in _profs[:3]) if _profs else "—"
            _grad = '<span style="font-size:0.65rem; background:#2A2A30; border:1px solid #333; border-radius:3px; padding:1px 5px; margin-left:6px; color:#9CA3AF;">GRAD</span>' if inspect.get("is_graduate") else ""
            st.markdown(
                f'<div style="background:{BG_CARD}; border:1px solid {ACCENT}40; border-radius:8px; padding:12px;">'
                f'<div style="font-size:0.82rem; font-weight:700; color:{TXT_ACCENT};">{inspect["id"]}{_grad}</div>'
                f'<div style="font-size:0.82rem; font-weight:500; color:{TXT_PRIMARY}; margin-bottom:6px;">{html.escape(inspect["name"])}</div>'
                f'<div style="font-size:0.73rem; color:{TXT_MUTED}; line-height:1.5; max-height:4.5em; overflow:hidden;">{_desc}</div>'
                f'<div style="margin-top:8px; font-size:0.7rem; color:{TXT_MUTED}; line-height:1.6;">'
                f'<b>Room:</b> {_room}<br>'
                f'<b>Faculty:</b> {_prof_str}'
                f'</div>'
                f'</div>',
                unsafe_allow_html=True
            )
        else:
            st.markdown(f'<div style="font-size:0.75rem; color:{TXT_MUTED}; font-style:italic;">Click a course to preview.</div>', unsafe_allow_html=True)

    # ══════════════════════════════════════════════════════════════════
    # COLUMN 2: 10 WEEKS (Draft & Calendar)
    # ══════════════════════════════════════════════════════════════════
    with col_board:
        # Header with Save/Load
        b1, b2, b3 = st.columns([4, 2, 1.5])
        with b1:
            st.markdown(f'<div class="section-label">10 Weeks ({quarter.title()} {year})</div>', unsafe_allow_html=True)
        with b2:
            tmpl_name = st.text_input("Template name", placeholder="Save as...", label_visibility="collapsed", key="board_save")
        with b3:
            if st.button("Save", use_container_width=True):
                if active_project["offerings"]:
                    save_template(tmpl_name or f"{quarter}_{year}", active_project["offerings"], active_project.get("prof_overrides"), quarter)
                    st.success("Saved")
                else: st.warning("Empty")

        offerings = active_project["offerings"]
        
        if not offerings:
            st.info("Your draft is empty. Add courses from Search on the left.")
        else:
            # Metrics
            total_sections = sum(o.get("sections", 1) for o in offerings)
            m1, m2, m3 = st.columns(3)
            with m1: st.markdown(f'<div class="metric-box" style="padding:10px;"><div class="num" style="font-size:1.2rem;">{len(offerings)}</div><div class="lbl">Courses</div></div>', unsafe_allow_html=True)
            with m2: st.markdown(f'<div class="metric-box" style="padding:10px;"><div class="num" style="font-size:1.2rem;">{total_sections}</div><div class="lbl">Sections</div></div>', unsafe_allow_html=True)
            with m3:
                if st.button("Generate Remainder", type="primary", use_container_width=True):
                    # Solver trigger placeholder
                    pass

            st.markdown("")
            
            # Draft List / Bench
            catalog_lookup = {c["id"]: c for c in catalog}

            # Build pinned course lookup for calendar grid
            DG_LABELS = {1: "MW", 2: "TTh"}
            pinned_map = {}  # {(day_group, time_slot): [(idx, offering, course), ...]}
            for _i, _o in enumerate(offerings):
                _pin = _o.get("pinned")
                if _pin:
                    _key = (_pin["day_group"], _pin["time_slot"])
                    pinned_map.setdefault(_key, []).append((_i, _o, catalog_lookup.get(_o["catalog_id"], {})))

            def has_pin_conflict(target_dg, target_ts, placing_idx):
                """Check if placing course's prof already occupies this slot."""
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

            # Pre-filter available professors for the dropdown
            available_profs = [p for p in load_professors() if active_project.get("prof_overrides", {}).get(p["id"], {}).get("available", True)]
            prof_options = ["Auto-Draft"] + [p["id"] for p in available_profs]
            prof_labels = {p["id"]: p["name"] for p in available_profs}
            prof_labels["Auto-Draft"] = "Auto-Draft"

            for idx, o in enumerate(offerings):
                cid = o["catalog_id"]
                course = catalog_lookup.get(cid, {})
                dept = course.get("department", "game")
                dot_color = DEPT_DOT.get(dept, "#666")
                
                with st.container():
                    # Row 1: Course Info and Delete
                    r1_c1, r1_c2 = st.columns([10, 1])
                    with r1_c1:
                        st.markdown(
                            f'<div style="padding:2px 0;">'
                            f'<span class="dept-dot" style="background:{dot_color};"></span>'
                            f'<span class="cc-id">{cid}</span> '
                            f'<span style="color:{TXT_SECONDARY}; font-size:0.85rem;">{course.get("name", cid)}</span></div>',
                            unsafe_allow_html=True
                        )
                    with r1_c2:
                        if st.button("×", key=f"board_rm_{idx}", help="Remove from draft"):
                            active_project["offerings"].pop(idx)
                            st.rerun()

                    # Row 2: Controls (Priority, Sections, Professor, Place)
                    r2_c1, r2_c2, r2_c3, r2_c4 = st.columns([1.5, 1, 3, 1], gap="small")
                    with r2_c1:
                        new_pri = st.selectbox("pri", list(PRIORITY_LABELS.keys()), format_func=lambda x: PRIORITY_LABELS[x], index=list(PRIORITY_LABELS.keys()).index(o.get("priority", "must_have")), key=f"board_pri_{idx}", label_visibility="collapsed")
                        active_project["offerings"][idx]["priority"] = new_pri
                    with r2_c2:
                        new_sec = st.number_input("sec", min_value=1, max_value=4, value=o.get("sections", 1), key=f"board_sec_{idx}", label_visibility="collapsed")
                        active_project["offerings"][idx]["sections"] = new_sec
                    with r2_c3:
                        # Professor assignment
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
                    
                    with r2_c4:
                        pin = o.get("pinned")
                        if pin:
                            # Pinned — show lock label + unpin
                            dg_lbl = DG_LABELS[pin["day_group"]]
                            st.markdown(f'<div style="font-size:0.7rem; color:{ACCENT}; font-weight:600; padding-top:6px;">🔒 {dg_lbl} {pin["time_slot"]}</div>', unsafe_allow_html=True)
                            if st.button("×", key=f"unpin_{idx}", help="Unpin"):
                                active_project["offerings"][idx]["pinned"] = None
                                add_log("UNPIN", f"Unpinned {cid}")
                                st.rerun()
                        else:
                            # Not pinned — show place button
                            is_placing = st.session_state.get("placing_offering_idx") == idx
                            btn_label = "📍" if not is_placing else "⌛"
                            if st.button(btn_label, key=f"place_btn_{idx}", help="Place on Calendar"):
                                if is_placing:
                                    st.session_state["placing_offering_idx"] = None
                                else:
                                    st.session_state["placing_offering_idx"] = idx
                                st.rerun()

                st.markdown(f'<div style="margin-bottom:12px; border-bottom:1px solid {BORDER_LITE};"></div>', unsafe_allow_html=True)

            # ── Weekly Schedule Grid ──────────────────────────────────
            st.markdown(f'<div class="section-label" style="margin-top:1rem;">Weekly Schedule</div>', unsafe_allow_html=True)

            placing_idx = st.session_state.get("placing_offering_idx")
            placing_cid = None
            if placing_idx is not None and placing_idx < len(offerings):
                placing_cid = offerings[placing_idx]["catalog_id"]
                st.markdown(
                    f'<div style="font-size:0.78rem; color:{ACCENT}; margin-bottom:8px;">'
                    f'Placing <b>{placing_cid}</b> — click a slot below</div>',
                    unsafe_allow_html=True,
                )

            # Header row
            gh1, gh2, gh3 = st.columns([1, 3, 3])
            with gh1:
                st.markdown(f'<div style="font-size:0.7rem; color:{TXT_MUTED}; text-align:right; padding:6px 0;">TIME</div>', unsafe_allow_html=True)
            with gh2:
                st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">MW</div>', unsafe_allow_html=True)
            with gh3:
                st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">TTh</div>', unsafe_allow_html=True)

            # Grid rows — one per time slot
            for ts in config.TIME_SLOTS:
                gc1, gc2, gc3 = st.columns([1, 3, 3])

                # Time label
                with gc1:
                    st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_MUTED}; text-align:right; padding:10px 4px 10px 0;">{ts}</div>', unsafe_allow_html=True)

                # Day group cells
                for dg, col in [(1, gc2), (2, gc3)]:
                    with col:
                        cell_key = (dg, ts)
                        pinned_here = pinned_map.get(cell_key, [])

                        if pinned_here:
                            # Render pinned courses
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
                        elif placing_idx is not None and placing_idx < len(offerings):
                            # Placing mode — show clickable slot or conflict
                            conflict = has_pin_conflict(dg, ts, placing_idx)
                            if conflict:
                                st.markdown(
                                    f'<div style="padding:10px; border:1px dashed {BORDER_LITE}; border-radius:6px; text-align:center; color:#3F3F46; font-size:0.7rem;">conflict</div>',
                                    unsafe_allow_html=True,
                                )
                            else:
                                dg_label = DG_LABELS[dg]
                                if st.button(f"{dg_label} {ts}", key=f"pin_{dg}_{ts}", use_container_width=True):
                                    offerings[placing_idx]["pinned"] = {"day_group": dg, "time_slot": ts}
                                    add_log("PIN", f"Pinned {placing_cid} to {dg_label} {ts}")
                                    st.session_state["placing_offering_idx"] = None
                                    st.rerun()
                        else:
                            # Empty cell
                            st.markdown(
                                f'<div style="padding:10px; border:1px dashed {BORDER_LITE}; border-radius:6px; min-height:20px;"></div>',
                                unsafe_allow_html=True,
                            )

    # ══════════════════════════════════════════════════════════════════
    # COLUMN 3: THE ROSTER (Faculty)
    # ══════════════════════════════════════════════════════════════════
    with col_roster:
        st.markdown(f'<div class="section-label">The Roster (Faculty)</div>', unsafe_allow_html=True)
        
        faculty = load_professors()
        prof_overrides = active_project.get("prof_overrides", {})
        if prof_overrides:
            apply_professor_overrides(faculty, prof_overrides, quarter)

        for p in faculty:
            pid = p["id"]
            available = quarter in p.get("available_quarters", [])
            dot_color = DEPT_DOT.get(p.get("home_department", "game"), "#666")
            
            # Faculty Card
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
                
                st.markdown(f'<div style="margin-bottom:8px; border-bottom:1px solid {BORDER_LITE};"></div>', unsafe_allow_html=True)

        # ── THE DRAFT TICKER (Log) ──
        st.markdown(f'<div class="section-label" style="margin-top:1.5rem;">Draft Ticker</div>', unsafe_allow_html=True)

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
