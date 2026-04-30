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
import streamlit.components.v1 as components

# ─── Version ────────────────────────────────────────────────────────
APP_VERSION = "2.6.1"

# ─── Session State Init ───────────────────────────────────────────────
if "active_project" not in st.session_state:
    st.session_state["active_project"] = None
if "draft_log" not in st.session_state:
    st.session_state["draft_log"] = []
if "locked_assignments" not in st.session_state:
    st.session_state["locked_assignments"] = []

def add_log(event_type, message):
    now = datetime.now().strftime("%H:%M:%S")
    st.session_state["draft_log"].insert(0, {"time": now, "type": event_type, "msg": message})
    # Keep last 15 items
    if len(st.session_state["draft_log"]) > 15:
        st.session_state["draft_log"] = st.session_state["draft_log"][:15]

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

# Bootstrap the per-session scratchpad from the committed default if missing.
# quarterly_offerings.json is gitignored and rewritten by save_offerings().
_offerings_live = PROJECT_ROOT / "data" / "quarterly_offerings.json"
_offerings_default = PROJECT_ROOT / "data" / "quarterly_offerings.default.json"
if not _offerings_live.exists() and _offerings_default.exists():
    import shutil
    shutil.copyfile(_offerings_default, _offerings_live)

import config
from solver.scheduler import run_schedule
from export.excel_writer import write_excel
from export.excel_reader import (
    MalformedState,
    MarkerMismatch,
    MissingStateSheet,
    SchemaVersionUnsupported,
    StateReadError,
    read_draft_state,
    validate_against_local_data,
)

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

# ─── Professor Avatars ──────────────────────────────────────────────
# Distinct colors per professor for quick visual identification on cards.
PROF_COLORS = {
    "prof_allen":    "#3B82F6",  # blue
    "prof_lindsey":  "#A78BFA",  # purple
    "prof_dodson":   "#14B8A6",  # teal
    "prof_avenali":  "#F59E0B",  # amber
    "prof_spencer":  "#10B981",  # green
    "prof_maloney":  "#EF4444",  # red
    "prof_imperato": "#F97316",  # orange
}

def _prof_initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()

def _prof_portrait_path(prof_id: str | None):
    """Return Path to uploaded portrait for this prof, or None."""
    if not prof_id:
        return None
    portraits_dir = PROJECT_ROOT / "data" / "portraits"
    if not portraits_dir.exists():
        return None
    for ext in ("png", "jpg", "jpeg", "webp"):
        p = portraits_dir / f"{prof_id}.{ext}"
        if p.exists():
            return p
    return None

@st.cache_data
def _portrait_data_url(path_str: str, mtime: float) -> str:
    """Cache-friendly base64 data URL for a portrait. mtime busts cache on update."""
    import base64, mimetypes
    from pathlib import Path as _P
    p = _P(path_str)
    mime = mimetypes.guess_type(str(p))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"

def prof_avatar_html(prof_id: str | None, prof_name: str | None = None, size: int = 18) -> str:
    """Return HTML for a professor avatar square.
    - If a portrait image exists at data/portraits/<prof_id>.*, use that.
    - Otherwise, render a colored initials square.
    - Auto-draft (no prof) renders a neutral silhouette placeholder.
    """
    if not prof_id or prof_id == "Auto-Draft":
        return (
            f'<span style="display:inline-flex;align-items:center;justify-content:center;'
            f'width:{size}px;height:{size}px;border-radius:4px;'
            f'background:{BG_HOVER};border:1px dashed {BORDER};'
            f'color:{TXT_MUTED};font-size:{max(10, size-6)}px;line-height:1;'
            f'vertical-align:middle;flex-shrink:0;" title="Auto-Draft">'
            f'<svg width="{max(10, size-6)}" height="{max(10, size-6)}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
            f'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></span>'
        )
    # Photo portrait if uploaded
    portrait_path = _prof_portrait_path(prof_id)
    if portrait_path:
        data_url = _portrait_data_url(str(portrait_path), portrait_path.stat().st_mtime)
        return (
            f'<img src="{data_url}" alt="{prof_name or prof_id}" title="{prof_name or prof_id}" '
            f'style="width:{size}px;height:{size}px;border-radius:{max(4, size//6)}px;'
            f'object-fit:cover;flex-shrink:0;vertical-align:middle;" />'
        )
    # Initials fallback
    color = PROF_COLORS.get(prof_id, "#6B7280")
    initials = _prof_initials(prof_name or prof_id)
    return (
        f'<span style="display:inline-flex;align-items:center;justify-content:center;'
        f'width:{size}px;height:{size}px;border-radius:{max(4, size//6)}px;background:{color};'
        f'color:#FFF;font-size:{max(9, int(size*0.42))}px;font-weight:700;line-height:1;'
        f'vertical-align:middle;flex-shrink:0;letter-spacing:-0.02em;" '
        f'title="{prof_name or prof_id}">{initials}</span>'
    )

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
    .block-container {{ padding-top: 1.5rem; max-width: 1400px; }}
    /* Hide Deploy + hamburger, keep sidebar expand arrow */
    [data-testid="stToolbarActions"] {{ display: none !important; }}
    [data-testid="stAppDeployButton"] {{ display: none !important; }}
    [data-testid="stMainMenu"] {{ display: none !important; }}
    [data-testid="stSidebarCollapseButton"] {{ visibility: visible !important; }}

    /* Hide Streamlit's stock "200MB per file • XLSX" hint — our own labels
       already say what the uploader accepts, and the size limit is meaningless
       for tiny schedule exports. */
    [data-testid="stFileUploaderDropzoneInstructions"] {{ display: none !important; }}

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

    /* ── Badges ── */
    .badge-row {{ display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }}
    .badge {{
        display: inline-block; font-size: 0.68rem; font-weight: 600;
        padding: 2px 8px; border-radius: 10px; line-height: 1.4;
        white-space: nowrap;
    }}
    .badge-must {{ background: {ACCENT}33; color: {ACCENT}; border: 1px solid {ACCENT}55; }}
    .badge-should {{ background: {ACCENT_AMBER}22; color: {ACCENT_AMBER}; border: 1px solid {ACCENT_AMBER}44; }}
    .badge-could {{ background: {TXT_MUTED}22; color: {TXT_MUTED}; border: 1px solid {TXT_MUTED}44; }}
    .badge-nice {{ background: {TXT_MUTED}11; color: {TXT_MUTED}; border: 1px solid {TXT_MUTED}33; }}
    .badge-sec {{ background: {ACCENT_GREEN}22; color: {ACCENT_GREEN}; border: 1px solid {ACCENT_GREEN}44; }}
    .badge-prof {{ background: {TXT_SECONDARY}18; color: {TXT_SECONDARY}; border: 1px solid {BORDER}; }}
    .badge-lock {{ background: {ACCENT}22; color: {ACCENT}; border: 1px solid {ACCENT}44; }}
    .badge-lock-gold {{ background: {ACCENT_AMBER}22; color: {ACCENT_AMBER}; border: 1px solid {ACCENT_AMBER}44; }}
    /* Gold lock indicator in expander labels */
    [data-testid="stExpander"] summary code {{
        background: {ACCENT_AMBER}22 !important; color: {ACCENT_AMBER} !important;
        border: 1px solid {ACCENT_AMBER}44; border-radius: 10px;
        padding: 1px 8px !important; font-size: 0.7rem !important;
        font-family: inherit !important;
    }}
    .badge-room {{ background: {ACCENT_AMBER}15; color: {TXT_MUTED}; border: 1px solid {BORDER}; }}

    /* ── Spacers ── */
    .gs-spacer-xs {{ height: 4px; }}
    .gs-spacer-lg {{ height: 20px; }}

    /* Desktop-only gate: show overlay on small screens */
    @media (max-width: 1024px) {{
        .stApp::before {{
            content: "This app is designed for laptop screens (1440\00d7 900+). Please use a MacBook or similar display.";
            position: fixed; inset: 0; z-index: 99999;
            display: flex; align-items: center; justify-content: center;
            background: {BG_BASE}; color: {TXT_SECONDARY};
            font-size: 1.1rem; font-weight: 500; text-align: center;
            padding: 2rem; font-family: 'Inter', sans-serif;
        }}
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

def _strip_unserializable_results(results):
    """JSON-safe copy of solver_results for embedding in the hidden _state sheet.

    The solver's per-mode `data` field carries CP-SAT decision-variable
    objects and tuple-keyed lookup indexes (`vars_by_cs_dg_ts`,
    `vars_by_prof_dg_ts`, …) that aren't JSON-encodable. Drop the whole
    `data` dict per mode — the visible-sheet writer still receives the
    full results via its first arg, and the post-reload export path
    is defensive about missing `data` (see _write_summary).
    """
    if not results:
        return results
    return {
        **results,
        "modes": [
            {k: v for k, v in m.items() if k != "data"}
            for m in results.get("modes", [])
        ],
    }


@st.cache_data(show_spinner="Generating Excel…")
def _build_excel_bytes(_results: dict, sig: str) -> tuple[bytes, str]:
    # Underscore on `_results` skips Streamlit's hasher (deep dict is slow).
    # `sig` is the real cache key — see _export_signature for what it captures.
    # The hidden _state sheet lets the export be re-uploaded later as a draft;
    # composing it here means a single cache entry covers both the XLSX bytes
    # and the embedded roundtrip state.
    import tempfile, datetime as _dt
    try:
        with open(PROJECT_ROOT / "data" / "quarterly_offerings.json") as f:
            live = json.load(f)
    except FileNotFoundError:
        live = {"quarter": None, "year": None, "offerings": []}
    from export.excel_writer import DATA_SCHEMA_VERSION
    draft_state = {
        "schema_version": DATA_SCHEMA_VERSION,
        "exported_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "quarter": live.get("quarter"),
        "year": live.get("year"),
        "offerings": live.get("offerings", []),
        "locked_assignments": st.session_state.get("locked_assignments", []),
        "solver_mode": st.session_state.get("solver_mode", "balanced"),
        # Include the last solver output so reload lands on a populated
        # calendar instead of forcing an immediate re-solve. Optional in
        # the schema — readers tolerate its absence (Slice 2 era files).
        # Strip the per-mode `data` field — CP-SAT artifacts aren't JSON.
        "solver_results": _strip_unserializable_results(_results),
    }
    with tempfile.TemporaryDirectory() as tmp_dir:
        excel_path = write_excel(
            _results, tmp_dir, draft_state=draft_state, backup_root=PROJECT_ROOT,
        )
        return excel_path.read_bytes(), excel_path.name


def _export_signature(results) -> str:
    """Cache-key signature for _build_excel_bytes — captures everything that
    affects the XLSX bytes (solver-results identity + the disk/session inputs
    that shape the embedded draft state). Without the lock + mtime parts,
    locking a slot between solve and export would serve a stale XLSX."""
    import hashlib
    try:
        ofs_mtime = (PROJECT_ROOT / "data" / "quarterly_offerings.json").stat().st_mtime_ns
    except FileNotFoundError:
        ofs_mtime = 0
    locks_str = json.dumps(st.session_state.get("locked_assignments", []), sort_keys=True)
    locks_hash = hashlib.md5(locks_str.encode()).hexdigest()[:12]
    mode = st.session_state.get("solver_mode", "balanced")
    return f"{id(results)}-{ofs_mtime}-{locks_hash}-{mode}"

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
    # Preserve room_blackouts when present on disk — the legacy Streamlit edit
    # flow doesn't surface blackouts (chair authors them in the React workspace),
    # so a Streamlit-side save would otherwise clobber the field. Read once,
    # carry forward.
    path = PROJECT_ROOT / "data" / "quarterly_offerings.json"
    existing_blackouts = []
    try:
        with open(path) as f:
            prior = json.load(f)
        existing_blackouts = prior.get("room_blackouts", []) or []
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    data = {
        "quarter": quarter,
        "year": year,
        "offerings": offerings_list,
        "room_blackouts": existing_blackouts,
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return data


# ─── XLSX reload helpers (Slice 3) ───────────────────────────────────
def _show_xlsx_read_error(e: StateReadError) -> None:
    """Render targeted user copy for each typed reader exception."""
    if isinstance(e, MissingStateSheet):
        st.error(
            "This Excel was exported before draft-reload was supported, "
            "or isn't a Scheduler export."
        )
    elif isinstance(e, MarkerMismatch):
        st.error("This Excel doesn't look like a GAME Scheduler export.")
    elif isinstance(e, SchemaVersionUnsupported):
        st.error(
            f"This Excel was exported by a newer Scheduler "
            f"(state v{e.found}, this build supports v{e.supported}). "
            f"Update the app and try again."
        )
    elif isinstance(e, MalformedState):
        st.error(f"Draft state is corrupted: {e}")
    else:
        st.error(f"Could not read Excel: {e}")


def _hydrate_from_draft_state(state: dict, source_filename: str, warnings: list[str]) -> None:
    """Apply parsed + validated draft state to session and disk.

    After this call, the next rerun lands in the workspace with the loaded
    draft. solver_results is cleared — user clicks Generate to repopulate
    the calendar (we don't store solver outputs in the XLSX, just inputs).
    """
    quarter = state["quarter"]
    year    = int(state["year"])
    offerings = state["offerings"]

    st.session_state["active_project"] = {
        "quarter": quarter,
        "year": year,
        "offerings": offerings,
        "prof_overrides": {},
    }
    st.session_state["locked_assignments"] = state.get("locked_assignments", [])
    st.session_state["solver_mode"] = state.get("solver_mode", "balanced")

    # Drop transient UI/state that would otherwise leak between drafts.
    for k in ("results", "welcome_order", "placing_offering_idx"):
        st.session_state.pop(k, None)

    # Restore the last computed schedule so the calendar populates immediately —
    # but only if reference validation didn't drop anything. Any drops would
    # orphan schedule entries against offerings/profs/rooms we just removed,
    # so clear results and let the user re-solve from a clean slate.
    embedded_results = state.get("solver_results")
    if embedded_results and not warnings:
        st.session_state["solver_results"] = embedded_results
    else:
        st.session_state.pop("solver_results", None)

    # React workspace's initial-state load reads the on-disk JSON; persist now.
    save_offerings(quarter, year, offerings)

    st.session_state["reload_warnings"] = warnings
    st.session_state["reload_source"]   = source_filename
    add_log("RELOAD", f"Loaded draft from {source_filename}")

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
            st.markdown('<div class="gs-spacer-lg"></div>', unsafe_allow_html=True)
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
        st.markdown('<div class="gs-spacer-xs"></div>', unsafe_allow_html=True)
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

    # ── Resume from Excel ────────────────────────────────────────────
    st.markdown(f'<div class="section-label">Resume from Excel</div>', unsafe_allow_html=True)
    welcome_xlsx = st.file_uploader(
        "Upload a previously exported schedule (.xlsx) to continue editing where you left off.",
        type=["xlsx"],
        key="welcome_xlsx_upload",
    )
    if welcome_xlsx is not None:
        # file_id changes per upload; gate processing so a rerun doesn't re-run.
        fid = welcome_xlsx.file_id
        if st.session_state.get("_welcome_xlsx_processed_id") != fid:
            st.session_state["_welcome_xlsx_processed_id"] = fid
            try:
                _state = read_draft_state(welcome_xlsx.read())
                _cleaned, _warnings = validate_against_local_data(
                    _state,
                    catalog_ids={c["id"] for c in catalog},
                    prof_ids={p["id"] for p in profs},
                    room_ids={r["id"] for r in rooms},
                )
                _hydrate_from_draft_state(_cleaned, welcome_xlsx.name, _warnings)
                st.rerun()
            except StateReadError as _e:
                _show_xlsx_read_error(_e)

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

        # Placing notification (sidebar warning + persistent edge strip)
        if st.session_state.get("placing_offering_idx") is not None:
            _pi_sb = st.session_state["placing_offering_idx"]
            if _pi_sb < len(active_project["offerings"]):
                _pi_cid = active_project["offerings"][_pi_sb]["catalog_id"]
                st.warning(f"Locking **{_pi_cid}** — go to **Schedule** tab and click a time slot.")

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

        # Reload from Excel — confirms before replacing the active draft
        with st.expander("Reload from Excel"):
            sb_xlsx = st.file_uploader(
                "Replace this draft with one from an exported .xlsx.",
                type=["xlsx"],
                key="sidebar_xlsx_upload",
            )
            if sb_xlsx is not None:
                _sb_fid = sb_xlsx.file_id
                if st.session_state.get("_sidebar_xlsx_processed_id") != _sb_fid:
                    st.session_state["_sidebar_xlsx_processed_id"] = _sb_fid
                    try:
                        _sb_state = read_draft_state(sb_xlsx.read())
                        # Stash for confirmation step — don't hydrate yet.
                        st.session_state["_sidebar_xlsx_pending_state"] = _sb_state
                        st.session_state["_sidebar_xlsx_pending_name"]  = sb_xlsx.name
                    except StateReadError as _sb_e:
                        _show_xlsx_read_error(_sb_e)
                        st.session_state.pop("_sidebar_xlsx_pending_state", None)
                        st.session_state.pop("_sidebar_xlsx_pending_name", None)

            _pending = st.session_state.get("_sidebar_xlsx_pending_state")
            if _pending:
                _pending_name = st.session_state.get("_sidebar_xlsx_pending_name", "uploaded file")
                st.warning(f"Replace **{quarter.title()} {year}** draft with `{_pending_name}`?")
                _cb1, _cb2 = st.columns(2)
                with _cb1:
                    if st.button("Replace", type="primary", key="sb_xlsx_confirm", use_container_width=True):
                        _cleaned_sb, _warn_sb = validate_against_local_data(
                            _pending,
                            catalog_ids={c["id"] for c in catalog},
                            prof_ids={p["id"] for p in profs},
                            room_ids={r["id"] for r in rooms},
                        )
                        _hydrate_from_draft_state(_cleaned_sb, _pending_name, _warn_sb)
                        st.session_state.pop("_sidebar_xlsx_pending_state", None)
                        st.session_state.pop("_sidebar_xlsx_pending_name", None)
                        st.rerun()
                with _cb2:
                    if st.button("Cancel", key="sb_xlsx_cancel", use_container_width=True):
                        st.session_state.pop("_sidebar_xlsx_pending_state", None)
                        st.session_state.pop("_sidebar_xlsx_pending_name", None)
                        st.rerun()

        # Metrics strip
        offerings_sb = active_project["offerings"]
        total_sections_sb = sum(o.get("sections", 1) for o in offerings_sb)
        n_locked_sb = sum(1 for o in offerings_sb if o.get("locked"))
        lock_str = f' &middot; <span style="color:{ACCENT_AMBER};">&#128274; {n_locked_sb}</span>' if n_locked_sb else ""
        st.markdown(
            f'<div style="font-size:0.82rem; color:{TXT_PRIMARY}; margin:8px 0;">'
            f'<b>{len(offerings_sb)}</b> <span style="color:{TXT_MUTED};">courses</span> &middot; '
            f'<b>{total_sections_sb}</b> <span style="color:{TXT_MUTED};">sections</span>{lock_str}</div>',
            unsafe_allow_html=True,
        )

        # Roster
        faculty = load_professors()
        prof_overrides = active_project.get("prof_overrides", {})
        if prof_overrides:
            apply_professor_overrides(faculty, prof_overrides, quarter)
        n_avail = sum(1 for p in faculty if quarter in p.get("available_quarters", []))
        with st.expander(f"Roster  —  {n_avail} available", expanded=False):
            for p in faculty:
                pid = p["id"]
                available = quarter in p.get("available_quarters", [])
                dot_color = DEPT_DOT.get(p.get("home_department", "game"), "#666")

                with st.container():
                    f_c1, f_c2, f_c3, f_c4 = st.columns([1, 1.5, 4, 1])
                    with f_c1:
                        new_avail = st.toggle("avail", value=available, key=f"roster_avail_{pid}", label_visibility="collapsed")
                    with f_c2:
                        _avatar_size = 40 if new_avail else 32
                        st.markdown(
                            f'<div style="padding-top:2px;">{prof_avatar_html(pid, p["name"], size=_avatar_size)}</div>',
                            unsafe_allow_html=True,
                        )
                    with f_c3:
                        st.markdown(
                            f'<div style="padding-top:6px;">'
                            f'<span style="font-weight:600; font-size:0.85rem; color:{TXT_PRIMARY if new_avail else TXT_MUTED};">{p["name"]}</span>'
                            f'</div>',
                            unsafe_allow_html=True,
                        )
                    with f_c4:
                        with st.popover("📷", use_container_width=True):
                            st.markdown(f"**Portrait: {p['name']}**")
                            _current_portrait = _prof_portrait_path(pid)
                            if _current_portrait:
                                _cur_url = _portrait_data_url(str(_current_portrait), _current_portrait.stat().st_mtime)
                                st.markdown(
                                    f'<img src="{_cur_url}" style="width:96px;height:96px;border-radius:8px;object-fit:cover;" />',
                                    unsafe_allow_html=True,
                                )
                                if st.button("Remove", key=f"portrait_rm_{pid}", use_container_width=True):
                                    _current_portrait.unlink()
                                    st.cache_data.clear()
                                    st.rerun()
                            _uploaded = st.file_uploader(
                                "Upload new portrait",
                                type=["png", "jpg", "jpeg", "webp"],
                                key=f"portrait_up_{pid}",
                                label_visibility="collapsed",
                            )
                            if _uploaded is not None:
                                _ext = _uploaded.name.rsplit(".", 1)[-1].lower()
                                _pdir = PROJECT_ROOT / "data" / "portraits"
                                _pdir.mkdir(parents=True, exist_ok=True)
                                # Remove any existing portrait (different ext) for this prof
                                for _e in ("png", "jpg", "jpeg", "webp"):
                                    _existing = _pdir / f"{pid}.{_e}"
                                    if _existing.exists():
                                        _existing.unlink()
                                (_pdir / f"{pid}.{_ext}").write_bytes(_uploaded.getvalue())
                                st.cache_data.clear()
                                st.rerun()

                    # Derive default max from solver tier: chair→2, overload→5, standard→4
                    _solver_max = config.CHAIR_MAX if p.get("is_chair") else (config.OVERLOAD_MAX if p.get("can_overload") else config.STANDARD_MAX)
                    _default_max = p.get("max_classes", _solver_max)

                    if new_avail:
                        m_col, t_col = st.columns([1, 2])
                        with m_col:
                            new_max = st.number_input("Max", 1, 6, _default_max, key=f"roster_max_{pid}", label_visibility="collapsed")
                        with t_col:
                            time_opts = list(TIME_PREF_LABELS.keys())
                            new_time = st.selectbox("Time", time_opts, format_func=lambda x: TIME_PREF_LABELS[x], index=time_opts.index(p.get("time_preference", "morning")), key=f"roster_time_{pid}", label_visibility="collapsed")
                    else:
                        new_max = _default_max
                        new_time = p.get("time_preference", "morning")

                    if "prof_overrides" not in active_project: active_project["prof_overrides"] = {}
                    active_project["prof_overrides"][pid] = {"max_classes": new_max, "time_preference": new_time, "available": new_avail}

                    st.markdown(f'<div style="margin-bottom:4px; border-bottom:1px solid {BORDER_LITE};"></div>', unsafe_allow_html=True)

        # Draft Ticker
        log = st.session_state.get("draft_log", [])
        ticker_count = f"  —  {len(log)}" if log else ""
        with st.expander(f"Draft Ticker{ticker_count}", expanded=bool(log)):
            if log:
                EVENT_COLORS = {"DRAFT": ACCENT, "DROP": ACCENT_RED, "ASSIGN": ACCENT_GREEN, "AUTO": ACCENT_AMBER, "PIN": TXT_ACCENT, "SOLVE": ACCENT_GREEN, "LOCK": ACCENT_AMBER, "UNLOCK": TXT_MUTED}
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
                st.caption("No activity yet.")

    # ── Reload warnings (top of workspace, after a Resume from Excel) ─
    _reload_warnings = st.session_state.get("reload_warnings")
    if _reload_warnings:
        for _w in _reload_warnings:
            st.warning(_w)
        _reload_src = st.session_state.get("reload_source")
        _dc1, _dc2 = st.columns([6, 1])
        with _dc1:
            if _reload_src:
                st.caption(f"Loaded from `{_reload_src}`")
        with _dc2:
            if st.button("Dismiss", key="dismiss_reload_warnings", use_container_width=True):
                st.session_state.pop("reload_warnings", None)
                st.session_state.pop("reload_source", None)
                st.rerun()

    # ── Data setup (shared by calendar + draft cards) ─────────────
    offerings = active_project["offerings"]
    catalog_lookup = {c["id"]: c for c in catalog}
    selected_ids = {o["catalog_id"] for o in offerings}

    DG_LABELS = {1: "MW", 2: "TTh", 3: "F"}
    locked_map = {}
    for _i, _o in enumerate(offerings):
        _lock = _o.get("locked")
        if _lock:
            _key = (_lock["day_group"], _lock["time_slot"])
            locked_map.setdefault(_key, []).append((_i, _o, catalog_lookup.get(_o["catalog_id"], {})))

    def has_lock_conflict(target_dg, target_ts, placing_idx):
        placing_o = offerings[placing_idx]
        p_profs = placing_o.get("override_preferred_professors") or []
        if not p_profs:
            return False
        for _i, _o in enumerate(offerings):
            if _i == placing_idx:
                continue
            _lock = _o.get("locked")
            if _lock and _lock["day_group"] == target_dg and _lock["time_slot"] == target_ts:
                o_profs = _o.get("override_preferred_professors") or []
                if o_profs and o_profs[0] == p_profs[0]:
                    return True
        return False

    available_profs = [p for p in load_professors() if active_project.get("prof_overrides", {}).get(p["id"], {}).get("available", True)]
    prof_options = ["Auto-Draft"] + [p["id"] for p in available_profs]
    prof_labels = {p["id"]: p["name"] for p in available_profs}
    prof_labels["Auto-Draft"] = "Auto-Draft"

    # ══════════════════════════════════════════════════════════════════
    # CSS (ghost pin animation, button alignment, sticky, mobile)
    # ══════════════════════════════════════════════════════════════════
    has_unlocked = any(not o.get("locked") for o in offerings) if offerings else False
    st.markdown(
        f'<style>'
        f'  @keyframes ghost-pulse {{ 0%, 100% {{ opacity: 0.12; }} 50% {{ opacity: 0.25; }} }}'
        f'  .ghost-slot {{ text-align:center; padding:8px; border:1px dashed {BORDER_LITE}; border-radius:6px; min-height:20px; font-size:0.8rem; color:#3F3F46; }}'
        f'  .ghost-slot.pulse {{ animation: ghost-pulse 3s ease-in-out infinite; }}'
        f'  [data-testid="stColumn"] [data-testid="stHorizontalBlock"] {{ align-items: center !important; }}'
        f'  /* Sticky context bar + tab bar */'
        f'  [data-testid="stMainBlockContainer"],'
        f'  [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] {{'
        f'    overflow: visible !important;'
        f'  }}'
        f'  [data-testid="stMainBlockContainer"] > [data-testid="stVerticalBlock"] > [data-testid="stLayoutWrapper"]:nth-child(3) {{'
        f'    position: sticky !important; top: 0 !important; z-index: 51 !important;'
        f'    background: {BG_BASE} !important; padding: 8px 0 4px 0;'
        f'    border-bottom: 1px solid {BORDER};'
        f'  }}'
        f'  [data-baseweb="tab-list"] {{ position: relative !important; }}'
        f'  [data-testid="stTabs"] > div > div:first-child {{'
        f'    position: sticky !important; top: 48px !important; z-index: 50 !important;'
        f'    background: {BG_BASE} !important;'
        f'    border-bottom: 1px solid {BORDER} !important;'
        f'    padding-bottom: 2px;'
        f'  }}'
        f'  /* No mobile layout — desktop only (see CLAUDE.md Rule 1) */'
        f'</style>',
        unsafe_allow_html=True,
    )

    # ── Placing indicator (collapsed sidebar strip + auto-switch to Schedule)
    _placing_just_started = st.session_state.pop("_placing_just_started", False)
    if st.session_state.get("placing_offering_idx") is not None:
        _pi_edge = st.session_state["placing_offering_idx"]
        if _pi_edge < len(offerings):
            st.html(
                f'<div style="position:fixed; left:6px; top:80px; z-index:999; '
                f'font-size:1rem; color:{ACCENT_AMBER}; filter:drop-shadow(0 0 4px {ACCENT_AMBER}66);">'
                f'&#128274;</div>'
            )
            st.markdown(
                f'<style>'
                f'@keyframes tab-nudge {{ 0%,100% {{ color: inherit; }} 50% {{ color: {ACCENT_AMBER}; }} }}'
                f'[data-baseweb="tab"]:nth-child(3) {{ animation: tab-nudge 2s ease-in-out 2; }}'
                f'</style>',
                unsafe_allow_html=True,
            )
            if _placing_just_started:
                components.html(
                    '<script>setTimeout(function(){'
                    'try{window.parent.document.querySelectorAll("[data-baseweb=tab]")[2].click()}catch(e){}'
                    '},150);</script>',
                    height=0,
                )

    # ══════════════════════════════════════════════════════════════════
    # CONTEXT BAR (always visible above tabs)
    # ══════════════════════════════════════════════════════════════════
    # Compute pending locks early so Generate button can show amber glow
    _solver_results_early = st.session_state.get("solver_results")
    _pending_now = 0
    if _solver_results_early and st.session_state.get("locked_assignments"):
        _sr_mode_idx = {"cover_first": 0, "time_pref_first": 1, "balanced": 2}.get(st.session_state.get("solver_mode", "balanced"), 2)
        _sr_schedule = _solver_results_early["modes"][_sr_mode_idx]["schedule"]
        _solved_map = {sa["cs_key"]: sa for sa in _sr_schedule}
        for _la in st.session_state["locked_assignments"]:
            _sa = _solved_map.get(_la["cs_key"])
            if not _sa:
                _pending_now += 1
                continue
            if (_la["day_group"] != _sa["day_group"] or _la["time_slot"] != _sa["time_slot"]
                    or _la["prof_id"] != _sa["prof_id"] or _la["room_id"] != _sa["room_id"]):
                _pending_now += 1
    st.session_state["_pending_count"] = _pending_now

    # Inject amber glow onto Generate Schedule button when pending changes exist
    if _pending_now > 0:
        components.html(
            f'<style>@keyframes gen-pulse {{'
            f'  0%,100% {{ box-shadow: 0 0 0 2px {ACCENT_AMBER}, 0 0 8px {ACCENT_AMBER}88; }}'
            f'  50%     {{ box-shadow: 0 0 0 2px {ACCENT_AMBER}, 0 0 20px {ACCENT_AMBER}; }}'
            f'}}</style>'
            f'<script>'
            f'(function() {{'
            f'  const apply = () => {{'
            f'    const doc = window.parent.document;'
            f'    const btns = doc.querySelectorAll("button");'
            f'    for (const b of btns) {{'
            f'      if (b.textContent.trim() === "Generate Schedule") {{'
            f'        b.style.boxShadow = "0 0 0 2px {ACCENT_AMBER}, 0 0 14px {ACCENT_AMBER}66";'
            f'        b.style.borderColor = "{ACCENT_AMBER}";'
            f'        b.style.animation = "gen-pulse 2s ease-in-out infinite";'
            f'      }}'
            f'    }}'
            f'  }};'
            f'  apply();'
            f'  setTimeout(apply, 200);'
            f'  setTimeout(apply, 600);'
            f'}})();'
            f'</script>',
            height=0,
        )

    total_sections = sum(o.get("sections", 1) for o in offerings)
    ctx1, ctx2, ctx3 = st.columns([2, 2, 2])
    with ctx1:
        st.markdown(f'<div style="font-size:0.85rem; color:{TXT_PRIMARY}; padding:6px 0; font-weight:600;">{quarter.title()} {year}</div>', unsafe_allow_html=True)
    with ctx2:
        st.markdown(f'<div style="font-size:0.78rem; color:{TXT_MUTED}; padding:8px 0;">{len(offerings)} courses &middot; {total_sections} sections</div>', unsafe_allow_html=True)
    with ctx3:
        if offerings:
            if st.button("Generate Schedule", type="primary", use_container_width=True, key="gen_btn"):
                save_offerings(quarter, year, offerings)
                save_professors_to_disk(load_professors())
                locked = st.session_state.get("locked_assignments") or None
                # Convert UI slot-locks to solver pin constraints
                slot_locks = []
                for _o in offerings:
                    _lk = _o.get("locked")
                    if _lk:
                        slot_locks.append({
                            "cs_key": f"{_o['catalog_id']}__0",
                            "day_group": _lk["day_group"],
                            "time_slot": _lk["time_slot"],
                        })
                pinned = slot_locks or None
                with st.spinner("Solving 3 schedules..."):
                    results = run_schedule(quarter, locked=locked, pinned=pinned)
                st.session_state["solver_results"] = results
                st.session_state["solver_mode"] = "balanced"
                n_full_locked = len(locked) if locked else 0
                n_slot_locked = len(slot_locks)
                n_total_locked = n_full_locked + n_slot_locked
                lock_msg = f" ({n_total_locked} locked)" if n_total_locked else ""
                add_log("SOLVE", f"Generated — {len(results['modes'])} options{lock_msg}")
                st.rerun()

    # ══════════════════════════════════════════════════════════════════
    # TABS: Courses | Schedule | Catalog
    # ══════════════════════════════════════════════════════════════════
    # Schedule tab state indicator
    #   State 0: empty        — no offerings yet
    #   State 1: ready        — offerings exist, not yet generated
    #   State 2: generating   — handled inline by st.spinner during solve
    #   State 3: fresh        — generated, no pending changes
    #   State 4: stale        — generated, pending changes (needs regenerate)
    if not offerings:
        _sched_label = "Schedule"
    elif not st.session_state.get("solver_results"):
        _sched_label = "Schedule ◌"
    elif _pending_now > 0:
        _sched_label = "Schedule ⚠"
    else:
        _sched_label = "Schedule ✓"

    tab_catalog, tab_courses, tab_schedule = st.tabs(["Catalog", "Courses", _sched_label])

    # Tab persistence — remember which tab the user was on across reruns
    components.html(
        """
        <script>
        (function() {
          const doc = window.parent.document;
          const STORAGE_KEY = 'gameSchedulerActiveTab';

          function getTabs() {
            return Array.from(doc.querySelectorAll('[data-baseweb="tab"]'));
          }

          function saveActive() {
            const tabs = getTabs();
            const activeIdx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
            if (activeIdx >= 0) {
              sessionStorage.setItem(STORAGE_KEY, activeIdx.toString());
            }
          }

          function restore() {
            const tabs = getTabs();
            if (tabs.length === 0) return;
            const saved = parseInt(sessionStorage.getItem(STORAGE_KEY) || '0');
            if (saved < 0 || saved >= tabs.length) return;
            const activeIdx = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
            if (activeIdx !== saved) {
              tabs[saved].click();
            }
          }

          // Save when user clicks any tab
          doc.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-baseweb="tab"]');
            if (tab) setTimeout(saveActive, 30);
          }, true);

          // Clean up any previous observer from earlier rerun
          if (window.parent.__gsTabObserver) {
            try { window.parent.__gsTabObserver.disconnect(); } catch(e) {}
          }

          // Watch for DOM changes (Streamlit reruns) and restore the tab
          let debounce = null;
          const observer = new MutationObserver(() => {
            clearTimeout(debounce);
            debounce = setTimeout(restore, 50);
          });
          observer.observe(doc.body, { childList: true, subtree: true });
          window.parent.__gsTabObserver = observer;

          // Initial restore after small delay to let DOM settle
          setTimeout(restore, 100);
          setTimeout(restore, 400);
        })();
        </script>
        """,
        height=0,
    )

    # ── TAB 1: COURSES ───────────────────────────────────────────
    with tab_courses:
        # Quick-add search bar
        _qa_search = st.text_input("Add a course", placeholder="Search catalog to add...", label_visibility="collapsed", key="courses_quick_add")
        if _qa_search and len(_qa_search) >= 2:
            _qa_s = _qa_search.lower()
            _qa_matches = [c for c in catalog if (_qa_s in c["id"].lower() or _qa_s in c["name"].lower()) and c["id"] not in selected_ids]
            if _qa_matches:
                for _qc in _qa_matches[:5]:
                    _qa_dept = _qc.get("department", "game")
                    _qa_dot = DEPT_DOT.get(_qa_dept, "#666")
                    _qa1, _qa2 = st.columns([5, 1])
                    with _qa1:
                        st.markdown(
                            f'<div style="font-size:0.82rem; padding:4px 0;">'
                            f'<span class="dept-dot" style="background:{_qa_dot};"></span>'
                            f'<span style="color:{TXT_ACCENT}; font-weight:600;">{_qc["id"]}</span> '
                            f'<span style="color:{TXT_SECONDARY};">{_qc["name"]}</span></div>',
                            unsafe_allow_html=True,
                        )
                    with _qa2:
                        if st.button("ADD", key=f"qa_add_{_qc['id']}", use_container_width=True):
                            active_project["offerings"].append({"catalog_id": _qc["id"], "priority": "must_have", "sections": 1, "override_enrollment_cap": None, "override_preferred_professors": None, "notes": None})
                            add_log("DRAFT", f"Added {_qc['id']}")
                            st.rerun()
                if len(_qa_matches) > 5:
                    st.caption(f"+{len(_qa_matches) - 5} more — refine your search")
            else:
                st.caption("No matching courses (or already added)")

        # Check if we should auto-expand a specific offering (from Schedule Edit button)
        _auto_expand_idx = st.session_state.get("expand_offering_idx")

        if offerings:
            # Styles for the portrait that will be moved into each expander's summary via JS.
            st.markdown(
                """
                <style>
                /* Only Courses tab expanders get the portrait-reserved space. */
                [data-testid="stExpander"] summary:has([data-course-portrait-marker]) {
                    position: relative !important;
                    padding-right: 72px !important;
                    min-height: 72px;
                }
                .course-hdr-portrait, .course-hdr-initials, .course-hdr-auto {
                    position: absolute;
                    right: 14px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 48px;
                    height: 62px;
                    border-radius: 6px;
                    z-index: 2;
                    pointer-events: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                }
                .course-hdr-portrait { object-fit: cover; border: 1px solid rgba(255,255,255,0.08); }
                .course-hdr-initials { color: #FFF; font-weight: 700; font-size: 1.1rem; letter-spacing: -0.02em; }
                .course-hdr-auto { background: #222228; border: 1px dashed #2A2A30; color: #6B7280; }
                </style>
                """,
                unsafe_allow_html=True,
            )
            # JS: after each rerun, move each portrait placeholder into its next-sibling expander's summary.
            components.html(
                """
                <script>
                (function() {
                  const doc = window.parent.document;
                  const moveOnce = () => {
                    const orphans = doc.querySelectorAll('[data-course-portrait-marker]:not([data-cp-moved])');
                    orphans.forEach(mk => {
                      let el = mk.closest('[data-testid="stElementContainer"], [data-testid="element-container"]') || mk.parentElement;
                      let sibling = el && el.nextElementSibling;
                      while (sibling) {
                        const summary = sibling.querySelector('[data-testid="stExpander"] summary');
                        if (summary) {
                          summary.appendChild(mk);
                          mk.setAttribute('data-cp-moved', '1');
                          break;
                        }
                        sibling = sibling.nextElementSibling;
                      }
                    });
                  };
                  moveOnce();
                  // Watch for DOM changes and reapply — handles Streamlit reruns.
                  if (window.parent.__gsPortraitObserver) {
                    try { window.parent.__gsPortraitObserver.disconnect(); } catch(e) {}
                  }
                  let debounce = null;
                  const obs = new MutationObserver(() => {
                    clearTimeout(debounce);
                    debounce = setTimeout(moveOnce, 40);
                  });
                  obs.observe(doc.body, { childList: true, subtree: true });
                  window.parent.__gsPortraitObserver = obs;
                })();
                </script>
                """,
                height=0,
            )
            _course_cols = st.columns(2)
            for idx, o in enumerate(offerings):
                cid = o["catalog_id"]
                course = catalog_lookup.get(cid, {})
                _dept = course.get("department", "game")
                _dot = DEPT_DOT.get(_dept, "#666")
                _pri = o.get("priority", "must_have")
                _pri_label = PRIORITY_LABELS.get(_pri, "Must")
                _pri_class = {"must_have": "badge-must", "should_have": "badge-should", "could_have": "badge-could", "nice_to_have": "badge-nice"}.get(_pri, "badge-could")
                _prof_list = o.get("override_preferred_professors") or []
                _prof_id_for_badge = _prof_list[0] if _prof_list else None
                _prof_display = prof_labels.get(_prof_list[0], _prof_list[0]) if _prof_list else "Auto"
                _prof_avatar = prof_avatar_html(_prof_id_for_badge, _prof_display, size=16)
                _sec_count = o.get("sections", 1)
                _lock = o.get("locked")
                _req_equip = course.get("required_equipment") or []
                _room_label = ", ".join(t.replace("_", " ") for t in _req_equip) if _req_equip else "Any room"

                # Badges HTML
                _badges = f'<span class="badge {_pri_class}">{_pri_label}</span>'
                _badges += f'<span class="badge badge-sec">{_sec_count} sec</span>'
                _badges += f'<span class="badge badge-prof" style="display:inline-flex;align-items:center;">{_prof_avatar}{html.escape(_prof_display)}</span>'
                _badges += f'<span class="badge badge-room">{_room_label}</span>'
                if _lock:
                    _badges += f'<span class="badge badge-lock-gold">🔒 {DG_LABELS[_lock["day_group"]]} {_lock["time_slot"]}</span>'

                # Build always-visible status pills for the expander label (native Streamlit colored badges)
                _pri_badge_color = {"must_have": "violet", "should_have": "orange", "could_have": "gray", "nice_to_have": "gray"}.get(_pri, "gray")
                _prof_badge_color = {"prof_allen": "blue", "prof_lindsey": "violet", "prof_dodson": "green", "prof_avenali": "orange", "prof_spencer": "primary", "prof_maloney": "red", "prof_imperato": "rainbow"}.get(_prof_id_for_badge, "gray")
                _prof_code_for_label = _prof_initials(_prof_display) if _prof_list else "Auto"
                _label_parts = [f":{_pri_badge_color}-badge[{_pri_label}]", f":{_prof_badge_color}-badge[{_prof_code_for_label}]"]
                if _sec_count > 1:
                    _label_parts.append(f":green-badge[{_sec_count} sec]")
                if _lock:
                    _label_parts.append(f":orange-badge[🔒 {DG_LABELS[_lock['day_group']]} {_lock['time_slot']}]")
                _label_suffix = "  " + "  ".join(_label_parts)
                _expander_label = f"{cid}  {course.get('name', cid)}{_label_suffix}"
                _should_expand = (_auto_expand_idx == idx)
                # Build the portrait overlay HTML for the expander header (moved in via JS)
                if not _prof_id_for_badge:
                    _hdr_portrait_html = (
                        '<div class="course-hdr-auto" data-course-portrait-marker>'
                        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
                        '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>'
                    )
                else:
                    _hdr_portrait_path = _prof_portrait_path(_prof_id_for_badge)
                    if _hdr_portrait_path:
                        _hdr_data_url = _portrait_data_url(str(_hdr_portrait_path), _hdr_portrait_path.stat().st_mtime)
                        _hdr_portrait_html = f'<img class="course-hdr-portrait" data-course-portrait-marker src="{_hdr_data_url}" alt="{_prof_display}" />'
                    else:
                        _hdr_bg = PROF_COLORS.get(_prof_id_for_badge, "#6B7280")
                        _hdr_initials = _prof_initials(_prof_display)
                        _hdr_portrait_html = f'<div class="course-hdr-initials" data-course-portrait-marker style="background:{_hdr_bg};">{_hdr_initials}</div>'

                _target_col = _course_cols[idx % 2]
                with _target_col:
                    st.markdown('<div class="course-card-col">', unsafe_allow_html=True)
                    st.markdown(_hdr_portrait_html, unsafe_allow_html=True)
                    with st.expander(_expander_label, expanded=_should_expand):
                        # Inside body: show larger portrait prominently on the right
                        _exp_portrait = prof_avatar_html(_prof_id_for_badge, _prof_display, size=72)
                        st.markdown(
                            f'<div style="display:flex;align-items:flex-start;gap:12px;">'
                            f'<div class="badge-row" style="flex:1;">{_badges}</div>'
                            f'{_exp_portrait}'
                            f'</div>',
                            unsafe_allow_html=True,
                        )

                        # Row 1: Day/Time (primary action)
                        lock = o.get("locked")
                        if lock:
                            lt1, lt2 = st.columns([3, 1])
                            with lt1:
                                dg_opts = list(DG_LABELS.keys())
                                dg_val = st.selectbox("Days", dg_opts, format_func=lambda x: DG_LABELS[x], index=dg_opts.index(lock["day_group"]), key=f"board_dg_{idx}")
                                ts_val = st.selectbox("Time", config.TIME_SLOTS, index=config.TIME_SLOTS.index(lock["time_slot"]), key=f"board_ts_{idx}")
                                active_project["offerings"][idx]["locked"] = {"day_group": dg_val, "time_slot": ts_val}
                            with lt2:
                                st.markdown('<div class="gs-spacer-lg"></div>', unsafe_allow_html=True)
                                if st.button("Unlock", key=f"unlock_{idx}", use_container_width=True):
                                    active_project["offerings"][idx]["locked"] = None
                                    add_log("UNLOCK", f"Unlocked {cid}")
                                    st.rerun()
                        else:
                            is_placing = st.session_state.get("placing_offering_idx") == idx
                            btn_label = "Cancel" if is_placing else "Lock to Slot"
                            if st.button(btn_label, key=f"place_btn_{idx}", use_container_width=True):
                                if is_placing:
                                    st.session_state["placing_offering_idx"] = None
                                else:
                                    st.session_state["placing_offering_idx"] = idx
                                    st.session_state["_placing_just_started"] = True
                                    # Clear solver results so Schedule tab shows slot-picking grid
                                    if "solver_results" in st.session_state:
                                        del st.session_state["solver_results"]
                                st.rerun()

                        # Row 2: Professor + Room
                        p1, p2 = st.columns(2)
                        with p1:
                            current_prof_list = o.get("override_preferred_professors")
                            current_prof = current_prof_list[0] if current_prof_list else "Auto-Draft"
                            if current_prof not in prof_options:
                                current_prof = "Auto-Draft"
                            new_prof = st.selectbox("Professor", prof_options, format_func=lambda x: prof_labels[x], index=prof_options.index(current_prof), key=f"board_prof_{idx}")
                            if new_prof != current_prof:
                                if new_prof == "Auto-Draft":
                                    active_project["offerings"][idx]["override_preferred_professors"] = None
                                    add_log("AUTO", f"Reverted {cid} to Auto-Draft")
                                else:
                                    active_project["offerings"][idx]["override_preferred_professors"] = [new_prof]
                                    add_log("ASSIGN", f"Assigned {prof_labels[new_prof]} to {cid}")
                                st.rerun()
                        with p2:
                            _req_equip_list = course.get("required_equipment") or []
                            _req_equip_txt = ", ".join(t.replace("_", " ") for t in _req_equip_list) if _req_equip_list else "— any room —"
                            st.text_input("Required equipment", value=_req_equip_txt, disabled=True, key=f"board_equip_{idx}")

                        # Row 3: Priority + Sections
                        s1, s2 = st.columns(2)
                        with s1:
                            new_pri = st.selectbox("Priority", list(PRIORITY_LABELS.keys()), format_func=lambda x: PRIORITY_LABELS[x], index=list(PRIORITY_LABELS.keys()).index(o.get("priority", "must_have")), key=f"board_pri_{idx}")
                            active_project["offerings"][idx]["priority"] = new_pri
                        with s2:
                            new_sec = st.number_input("Sections", min_value=1, max_value=4, value=o.get("sections", 1), key=f"board_sec_{idx}")
                            active_project["offerings"][idx]["sections"] = new_sec

                        # Row 3: Notes + Remove
                        notes = st.text_area("Notes", value=o.get("notes") or "", key=f"board_notes_{idx}", height=60)
                        active_project["offerings"][idx]["notes"] = notes if notes else None

                        if st.button("Remove from Draft", key=f"board_rm_{idx}", use_container_width=True):
                            active_project["offerings"].pop(idx)
                            add_log("DROP", f"Removed {cid}")
                            st.rerun()

        else:
            st.markdown(f'<div style="text-align:center; color:{TXT_MUTED}; padding:3rem; font-size:0.85rem;">No courses yet. Use the <b>Catalog</b> tab to add courses.</div>', unsafe_allow_html=True)

    # ── TAB 2: SCHEDULE ──────────────────────────────────────────
    with tab_schedule:
        solver_results = st.session_state.get("solver_results")
        has_results = solver_results is not None
        locked_set = {a["cs_key"] for a in st.session_state.get("locked_assignments", [])}
        # Also include offering-level slot locks
        for _o in offerings:
            _lk = _o.get("locked")
            if _lk:
                locked_set.add(f"{_o['catalog_id']}__0")

        if has_results:
            mode_idx = {"cover_first": 0, "time_pref_first": 1, "balanced": 2}
            current_mode = st.session_state.get("solver_mode", "balanced")
            mode_data = solver_results["modes"][mode_idx[current_mode]]

            gc_m1, gc_m2, gc_m3, gc_exp = st.columns([1, 1, 1, 1])
            with gc_m1:
                if st.button("Cover", use_container_width=True, type="primary" if current_mode == "cover_first" else "secondary"):
                    st.session_state["solver_mode"] = "cover_first"; st.rerun()
            with gc_m2:
                if st.button("Time Pref", use_container_width=True, type="primary" if current_mode == "time_pref_first" else "secondary"):
                    st.session_state["solver_mode"] = "time_pref_first"; st.rerun()
            with gc_m3:
                if st.button("Balanced", use_container_width=True, type="primary" if current_mode == "balanced" else "secondary"):
                    st.session_state["solver_mode"] = "balanced"; st.rerun()
            with gc_exp:
                xlsx_bytes, xlsx_name = _build_excel_bytes(
                    solver_results, _export_signature(solver_results)
                )
                st.download_button(
                    "Export Excel",
                    xlsx_bytes,
                    file_name=xlsx_name,
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    use_container_width=True,
                    on_click=lambda: st.toast("Excel downloaded"),
                )

            # Lock All / Unlock All buttons
            _la_c1, _la_c2, _la_spacer = st.columns([1, 1, 5])
            with _la_c1:
                if st.button("🔒 Lock All", use_container_width=True, key="lock_all_btn"):
                    existing = {la["cs_key"] for la in st.session_state["locked_assignments"]}
                    added = 0
                    for _a in mode_data["schedule"]:
                        if _a["cs_key"] in existing:
                            continue
                        st.session_state["locked_assignments"].append({
                            "cs_key": _a["cs_key"],
                            "prof_id": _a["prof_id"],
                            "room_id": _a["room_id"],
                            "day_group": _a["day_group"],
                            "time_slot": _a["time_slot"],
                        })
                        added += 1
                    add_log("LOCK", f"Locked All (+{added})")
                    st.rerun()
            with _la_c2:
                if st.button("🔓 Unlock All", use_container_width=True, key="unlock_all_btn"):
                    n = len(st.session_state["locked_assignments"])
                    st.session_state["locked_assignments"] = []
                    add_log("UNLOCK", f"Unlocked All ({n})")
                    st.rerun()

            # Status line
            n_placed = len(mode_data["schedule"]); n_unsched = len(mode_data["unscheduled"])
            n_locked = len(locked_set)
            status = mode_data["status"].upper(); score = mode_data.get("objective", "—")
            stat_color = ACCENT_GREEN if status == "OPTIMAL" else ACCENT_AMBER
            # Count pending locks — ones whose stored values don't match current solver assignment
            _solved_by_cs = {sa["cs_key"]: sa for sa in mode_data["schedule"]}
            _n_pending = 0
            for _la in st.session_state.get("locked_assignments", []):
                _sa = _solved_by_cs.get(_la["cs_key"])
                if not _sa:
                    _n_pending += 1
                    continue
                if (_la["day_group"] != _sa["day_group"] or _la["time_slot"] != _sa["time_slot"]
                        or _la["prof_id"] != _sa["prof_id"] or _la["room_id"] != _sa["room_id"]):
                    _n_pending += 1
            st.session_state["_pending_count"] = _n_pending
            lock_str = f" · {n_locked} locked" if n_locked else ""
            pending_str = f" · {_n_pending} pending" if _n_pending else ""
            st.markdown(f'<div style="font-size:0.68rem; color:{stat_color}; text-align:right; padding:2px 0 4px 0;">{status} · {n_placed} placed · {n_unsched} dropped · score {score}{lock_str}<span style="color:{ACCENT_AMBER};">{pending_str}</span></div>', unsafe_allow_html=True)

            solve_map = {}
            for a in mode_data["schedule"]:
                key = (a["day_group"], a["time_slot"]); solve_map.setdefault(key, []).append(a)
        else:
            placing_idx = st.session_state.get("placing_offering_idx")
            placing_cid = None
            if placing_idx is not None and offerings and placing_idx < len(offerings):
                placing_cid = offerings[placing_idx]["catalog_id"]
                st.markdown(f'<div style="font-size:0.78rem; color:{ACCENT}; margin-bottom:4px;">Locking <b>{placing_cid}</b> — click a slot</div>', unsafe_allow_html=True)

        # Grid header
        hc1, hc2, hc3 = st.columns([0.6, 3, 3])
        with hc1: st.markdown(f'<div style="padding:6px 0;"></div>', unsafe_allow_html=True)
        with hc2: st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">MW</div>', unsafe_allow_html=True)
        with hc3: st.markdown(f'<div style="font-size:0.72rem; font-weight:600; color:{TXT_SECONDARY}; text-align:center; padding:6px 0; background:{BG_CARD}; border:1px solid {BORDER}; border-radius:4px;">TTh</div>', unsafe_allow_html=True)

        # Grid rows
        for ts in config.TIME_SLOTS:
            tc1, tc2, tc3 = st.columns([0.6, 3, 3])
            with tc1: st.markdown(f'<div style="font-size:0.68rem; font-weight:600; color:{TXT_MUTED}; text-align:right; padding:10px 2px 10px 0;">{ts}</div>', unsafe_allow_html=True)

            for dg, col in [(1, tc2), (2, tc3)]:
                with col:
                    cell_key = (dg, ts); total_rooms = len(rooms)

                    if has_results:
                        solved_here = solve_map.get(cell_key, [])
                        if solved_here:
                            for a in solved_here:
                                _dept = a.get("department", "game"); _dot = DEPT_DOT.get(_dept, "#666")
                                _aff = a.get("affinity_level", 3)
                                _aff_color = ACCENT_GREEN if _aff <= 1 else (ACCENT_AMBER if _aff == 2 else ACCENT_RED)
                                _room_short = a.get("room_name", "").split("–")[0].strip() if a.get("room_name") else ""
                                _is_locked = a["cs_key"] in locked_set
                                _lock_icon = "🔒 " if _is_locked else ""
                                _lock_class = "locked" if _is_locked else ""
                                _aff_labels = {0: "Picked", 1: "Good fit", 2: "Available"}
                                _aff_label = _aff_labels.get(_aff, "—")
                                _tp = a.get("time_pref", "unknown")
                                _tp_colors = {"preferred": ACCENT_GREEN, "acceptable": ACCENT_AMBER, "not_preferred": ACCENT_RED}
                                _tp_short = {"preferred": "Pref time", "acceptable": "OK time", "not_preferred": "Off hours"}
                                _tp_color = _tp_colors.get(_tp, TXT_MUTED)
                                _tp_label = _tp_short.get(_tp, "—")
                                # Check if this course has a pending lock (stored lock doesn't match solver's assignment)
                                _my_lock = next((la for la in st.session_state.get("locked_assignments", []) if la["cs_key"] == a["cs_key"]), None)
                                _is_pending = False
                                _pending_lines = []
                                if _my_lock:
                                    if _my_lock["day_group"] != a["day_group"] or _my_lock["time_slot"] != a["time_slot"]:
                                        _is_pending = True
                                        _pending_lines.append(f'{DG_LABELS[_my_lock["day_group"]]} {_my_lock["time_slot"]}')
                                    if _my_lock["prof_id"] != a["prof_id"]:
                                        _is_pending = True
                                        _pending_name = prof_labels.get(_my_lock["prof_id"], _my_lock["prof_id"])
                                        _pending_lines.append(_pending_name)
                                    if _my_lock["room_id"] != a["room_id"]:
                                        _is_pending = True
                                        _rm = next((r for r in rooms if r["id"] == _my_lock["room_id"]), None)
                                        _rm_name = _rm["name"].split("–")[0].strip() if _rm else _my_lock["room_id"]
                                        _pending_lines.append(_rm_name)
                                _border_color = ACCENT_AMBER if _is_pending else _aff_color
                                _pending_html = ""
                                if _is_pending:
                                    _pending_html = (
                                        f'<div class="cal-detail" style="color:{ACCENT_AMBER}; font-weight:600; margin-top:2px;">'
                                        f'⚠ Pending → {" · ".join(_pending_lines)}</div>'
                                    )
                                _card_extra_style = f"background:#2A1F0A;" if _is_pending else ""
                                st.markdown(
                                    f'<div class="cal-course {_lock_class}" style="border-left-color:{_border_color};{_card_extra_style}display:flex;gap:8px;align-items:flex-start;">'
                                    f'<div style="flex:1;min-width:0;">'
                                    f'<div class="cal-cid"><span class="dept-dot" style="background:{_dot};"></span>{_lock_icon}{a["catalog_id"]}</div>'
                                    f'<div class="cal-cname">{a["course_name"]}</div>'
                                    f'<div class="cal-detail">{a["prof_name"]} · {_room_short}'
                                    f' · <span style="color:{_aff_color};">{_aff_label}</span>'
                                    f' · <span style="color:{_tp_color};">{_tp_label}</span></div>'
                                    f'{_pending_html}'
                                    f'</div>'
                                    f'{prof_avatar_html(a.get("prof_id"), a.get("prof_name"), size=38)}'
                                    f'</div>',
                                    unsafe_allow_html=True,
                                )
                                # Lock/Unlock + Edit popover
                                _btn1, _btn2 = st.columns(2)
                                with _btn1:
                                    if _is_locked:
                                        if st.button("🔓 Unlock", key=f"lock_{a['cs_key']}_{dg}_{ts}", use_container_width=True, type="primary"):
                                            st.session_state["locked_assignments"] = [la for la in st.session_state["locked_assignments"] if la["cs_key"] != a["cs_key"]]
                                            for _oi, _oo in enumerate(offerings):
                                                if _oo["catalog_id"] == a["catalog_id"] and _oo.get("locked"):
                                                    offerings[_oi]["locked"] = None
                                            add_log("UNLOCK", f"Unlocked {a['catalog_id']}")
                                            st.rerun()
                                    else:
                                        if st.button("Lock", key=f"lock_{a['cs_key']}_{dg}_{ts}", use_container_width=True):
                                            st.session_state["locked_assignments"].append({
                                                "cs_key": a["cs_key"], "prof_id": a["prof_id"],
                                                "room_id": a["room_id"], "day_group": a["day_group"],
                                                "time_slot": a["time_slot"],
                                            })
                                            add_log("LOCK", f"Locked {a['catalog_id']} → {DG_LABELS[a['day_group']]} {a['time_slot']} ({a['prof_name']})")
                                            st.rerun()
                                with _btn2:
                                    _edit_idx = next((i for i, o in enumerate(offerings) if o["catalog_id"] == a["catalog_id"]), None)
                                    if _edit_idx is not None:
                                        _eo = offerings[_edit_idx]
                                        with st.popover("Edit", use_container_width=True):
                                            # Priority
                                            _ep_pri = st.selectbox("Priority", list(PRIORITY_LABELS.keys()), format_func=lambda x: PRIORITY_LABELS[x], index=list(PRIORITY_LABELS.keys()).index(_eo.get("priority", "must_have")), key=f"ep_pri_{a['cs_key']}_{dg}_{ts}")
                                            # Professor
                                            _ep_prof_list = _eo.get("override_preferred_professors")
                                            _ep_prof_default = _ep_prof_list[0] if _ep_prof_list else a["prof_id"]
                                            if _ep_prof_default not in prof_options:
                                                _ep_prof_default = "Auto-Draft"
                                            _ep_new_prof = st.selectbox("Professor", prof_options, format_func=lambda x: prof_labels[x], index=prof_options.index(_ep_prof_default), key=f"ep_prof_{a['cs_key']}_{dg}_{ts}")
                                            # Required equipment (read-only summary; chairs author on the course card)
                                            _ep_req_equip = catalog_lookup.get(a["catalog_id"], {}).get("required_equipment") or []
                                            _ep_req_txt = ", ".join(t.replace("_", " ") for t in _ep_req_equip) if _ep_req_equip else "— any room —"
                                            st.text_input("Required equipment", value=_ep_req_txt, disabled=True, key=f"ep_equip_{a['cs_key']}_{dg}_{ts}")
                                            # Day / Time — pure selectboxes, no auto-commit
                                            _ep_dt1, _ep_dt2 = st.columns(2)
                                            with _ep_dt1:
                                                _ep_dg_opts = list(DG_LABELS.keys())
                                                _ep_new_dg = st.selectbox("Day", _ep_dg_opts, format_func=lambda x: DG_LABELS[x], index=_ep_dg_opts.index(a["day_group"]), key=f"ep_dg_{a['cs_key']}_{dg}_{ts}")
                                            with _ep_dt2:
                                                _ep_ts_opts = config.TIME_SLOTS
                                                _ep_new_ts = st.selectbox("Time", _ep_ts_opts, index=_ep_ts_opts.index(a["time_slot"]) if a["time_slot"] in _ep_ts_opts else 0, key=f"ep_ts_{a['cs_key']}_{dg}_{ts}")
                                            # SINGLE COMMIT BUTTON — locks all popover changes
                                            _ep_lock_label = "🔒 Lock this class" if not _is_locked else "🔒 Update lock"
                                            if st.button(_ep_lock_label, key=f"ep_lock_{a['cs_key']}_{dg}_{ts}", use_container_width=True, type="primary"):
                                                # Commit all popover values to the offering
                                                offerings[_edit_idx]["priority"] = _ep_pri
                                                if _ep_new_prof == "Auto-Draft":
                                                    offerings[_edit_idx]["override_preferred_professors"] = None
                                                else:
                                                    offerings[_edit_idx]["override_preferred_professors"] = [_ep_new_prof]
                                                # Determine which professor id to lock
                                                _lock_prof = _ep_new_prof if _ep_new_prof != "Auto-Draft" else a["prof_id"]
                                                # Remove any existing lock for this section, replace with new
                                                st.session_state["locked_assignments"] = [la for la in st.session_state["locked_assignments"] if la["cs_key"] != a["cs_key"]]
                                                st.session_state["locked_assignments"].append({
                                                    "cs_key": a["cs_key"],
                                                    "prof_id": _lock_prof,
                                                    "room_id": a["room_id"],
                                                    "day_group": _ep_new_dg,
                                                    "time_slot": _ep_new_ts,
                                                })
                                                _lock_name = prof_labels.get(_lock_prof, _lock_prof)
                                                add_log("LOCK", f"Locked {a['catalog_id']} → {DG_LABELS[_ep_new_dg]} {_ep_new_ts} ({_lock_name})")
                                                st.rerun()
                                            if st.button("Drop Course", key=f"ep_drop_{a['cs_key']}_{dg}_{ts}", use_container_width=True):
                                                active_project["offerings"].pop(_edit_idx)
                                                st.session_state["locked_assignments"] = [la for la in st.session_state["locked_assignments"] if la["cs_key"] != a["cs_key"]]
                                                st.session_state["solver_results"] = None
                                                add_log("DROP", f"Dropped {a['catalog_id']} from grid")
                                                st.rerun()
                            n_here = len(solved_here)
                            cap_color = ACCENT_AMBER if n_here >= total_rooms else TXT_MUTED
                            st.markdown(f'<div style="font-size:0.6rem; color:{cap_color}; text-align:right; padding:1px 4px;">{n_here}/{total_rooms}</div>', unsafe_allow_html=True)
                        else:
                            st.markdown(f'<div class="ghost-slot"></div>', unsafe_allow_html=True)
                    else:
                        locked_here = locked_map.get(cell_key, [])
                        n_locked_here = len(locked_here); over_cap = n_locked_here > total_rooms

                        if locked_here:
                            for _li, _lo, _lc in locked_here:
                                _dept = _lc.get("department", "game"); _dot = DEPT_DOT.get(_dept, "#666")
                                _prof_list = _lo.get("override_preferred_professors") or []
                                _prof_name = prof_labels.get(_prof_list[0], _prof_list[0]) if _prof_list else "Auto"
                                st.markdown(f'<div class="cal-course locked"><div class="cal-cid"><span class="dept-dot" style="background:{_dot};"></span>🔒 {_lo["catalog_id"]}</div><div class="cal-detail">{_prof_name}</div></div>', unsafe_allow_html=True)

                        if n_locked_here > 0:
                            cap_color = ACCENT_RED if over_cap else (ACCENT_AMBER if n_locked_here >= total_rooms else TXT_MUTED)
                            warn = " !" if over_cap else ""
                            st.markdown(f'<div style="font-size:0.6rem; color:{cap_color}; text-align:right; padding:1px 4px;">{n_locked_here}/{total_rooms}{warn}</div>', unsafe_allow_html=True)

                        if not has_results and placing_idx is not None and offerings and placing_idx < len(offerings):
                            conflict = has_lock_conflict(dg, ts, placing_idx)
                            if conflict:
                                if not locked_here:
                                    st.markdown(f'<div style="padding:8px; border:1px dashed {BORDER_LITE}; border-radius:6px; text-align:center; color:#3F3F46; font-size:0.7rem;">conflict</div>', unsafe_allow_html=True)
                            else:
                                dg_label = DG_LABELS[dg]
                                if st.button(f"🔒 {dg_label} {ts}", key=f"lock_slot_{dg}_{ts}", use_container_width=True):
                                    offerings[placing_idx]["locked"] = {"day_group": dg, "time_slot": ts}
                                    add_log("LOCK", f"Locked {placing_cid} to {dg_label} {ts}")
                                    st.session_state["placing_offering_idx"] = None
                        elif not locked_here and not has_results:
                            pulse_class = "pulse" if has_unlocked else ""
                            ghost = "🔒" if has_unlocked else ""
                            st.markdown(f'<div class="ghost-slot {pulse_class}">{ghost}</div>', unsafe_allow_html=True)

        # Dropped courses
        if has_results:
            unsched = mode_data.get("unscheduled", [])
            if unsched:
                pri_order = {"must_have": 0, "should_have": 1, "could_have": 2, "nice_to_have": 3}
                unsched_sorted = sorted(unsched, key=lambda u: pri_order.get(u["priority"], 9))
                pri_colors = {"must_have": ACCENT_RED, "should_have": ACCENT_AMBER, "could_have": TXT_MUTED, "nice_to_have": TXT_MUTED}
                st.markdown(f'<div style="margin-top:8px; font-size:0.75rem; color:{ACCENT_AMBER}; font-weight:600;">Dropped ({len(unsched)})</div>', unsafe_allow_html=True)

                _solver_data = mode_data.get("data", {})
                for u in unsched_sorted:
                    _cid = u["catalog_id"]; _course = catalog_lookup.get(_cid, {}); _name = _course.get("name", _cid)
                    _dept = _course.get("department", "game"); _dot = DEPT_DOT.get(_dept, "#666")
                    _pri = u["priority"]; _pri_label = PRIORITY_LABELS.get(_pri, _pri); _pri_color = pri_colors.get(_pri, TXT_MUTED)
                    _req_equip_u = _course.get("required_equipment") or []
                    _equip_label = ", ".join(t.replace("_", " ") for t in _req_equip_u) if _req_equip_u else "any room"

                    # Compute drop reason from solver data
                    _cs_key = u.get("cs_key", "")
                    _ep = _solver_data.get("eligible_profs", {}).get(_cs_key, [])
                    _er = _solver_data.get("eligible_rooms", {}).get(_cs_key, [])
                    if not _ep:
                        _drop_reason = "No eligible professor"
                    elif not _er:
                        _drop_reason = "No compatible room"
                    elif _pri in ("could_have", "nice_to_have"):
                        _drop_reason = "Lower priority — solver fit higher-ranked courses first"
                    elif _pri == "should_have":
                        _drop_reason = "Couldn't fit — slots or professors fully committed"
                    else:
                        _drop_reason = "Constraint conflict — all slot/prof/room combos blocked"

                    uc1, uc2, uc3 = st.columns([4, 1.5, 1])
                    with uc1: st.markdown(f'<div style="font-size:0.72rem; padding:3px 0;"><span class="dept-dot" style="background:{_dot};"></span><span style="color:{TXT_ACCENT}; font-weight:600;">{_cid}</span> <span style="color:{TXT_SECONDARY};">{_name}</span><br/><span style="font-size:0.65rem; color:{TXT_MUTED};">{_drop_reason}</span></div>', unsafe_allow_html=True)
                    with uc2: st.markdown(f'<div style="font-size:0.65rem; padding:5px 0;"><span style="color:{_pri_color}; font-weight:600;">{_pri_label}</span> <span style="color:{TXT_MUTED};">&middot; {_equip_label}</span></div>', unsafe_allow_html=True)
                    with uc3:
                        if st.button("Lock", key=f"force_lock_{_cid}_{u.get('section_idx',0)}", use_container_width=True):
                            for _oi, _oo in enumerate(offerings):
                                if _oo["catalog_id"] == _cid:
                                    st.session_state["placing_offering_idx"] = _oi
                                    st.session_state["solver_results"] = None
                                    add_log("OVERRIDE", f"Overriding solver — locking {_cid}")
                                    st.rerun(); break

    # ── TAB 3: CATALOG ───────────────────────────────────────────
    with tab_catalog:
        if "active_depts" not in st.session_state:
            st.session_state["active_depts"] = ["game"]
        with st.popover("Departments", use_container_width=True):
            for dk, dl in DEPT_LABELS.items():
                is_on = dk in st.session_state["active_depts"]
                if st.checkbox(dl, value=is_on, key=f"dept_tog_{dk}"):
                    if dk not in st.session_state["active_depts"]: st.session_state["active_depts"].append(dk)
                else:
                    if dk in st.session_state["active_depts"]: st.session_state["active_depts"].remove(dk)
        dept_filter = st.session_state["active_depts"]

        if dept_filter:
            dots_html = " ".join(f'<span class="dept-dot" style="background:{DEPT_DOT.get(d, "#666")}; width:6px; height:6px;"></span>' for d in dept_filter)
            st.markdown(f'<div style="margin:-8px 0 4px 0;">{dots_html}</div>', unsafe_allow_html=True)

        search = st.text_input("Search", placeholder="Course ID or name...", label_visibility="collapsed", key="scout_search")

        # Collect, paginate
        inspected_id = (st.session_state.get("inspected_course") or {}).get("id")
        _all_filtered = []
        for dept in dept_filter:
            courses = dept_courses.get(dept, [])
            filtered = courses
            if search:
                s = search.lower()
                filtered = [c for c in filtered if s in c["id"].lower() or s in c["name"].lower()]
            for c in filtered:
                _all_filtered.append((dept, c))

        PAGE_SIZE = 25
        cat_page = st.session_state.get("cat_page", 0)
        total_cat = len(_all_filtered)
        page_end = min((cat_page + 1) * PAGE_SIZE, total_cat)
        visible = _all_filtered[:page_end]

        prev_dept = None
        for dept, c in visible:
            if dept != prev_dept:
                st.markdown(f'<div style="font-size:0.65rem; font-weight:700; color:{TXT_MUTED}; margin-top:10px; border-bottom:1px solid {BORDER_LITE};">{DEPT_LABELS[dept].upper()}</div>', unsafe_allow_html=True)
                prev_dept = dept

            already = c["id"] in selected_ids
            is_inspected = c["id"] == inspected_id
            rc1, rc2 = st.columns([5, 1])
            with rc1:
                if st.button(f"{c['id']}  {c['name']}", key=f"preview_{c['id']}", use_container_width=True, type="primary" if is_inspected else "secondary"):
                    st.session_state["inspected_course"] = None if is_inspected else c
                    st.rerun()
            with rc2:
                if already:
                    if st.button("DROP", key=f"rm_scout_{c['id']}", use_container_width=True, type="primary"):
                        active_project["offerings"] = [o for o in active_project["offerings"] if o["catalog_id"] != c["id"]]
                        add_log("DROP", f"Removed {c['id']}"); st.rerun()
                else:
                    if st.button("ADD", key=f"add_scout_{c['id']}", use_container_width=True):
                        active_project["offerings"].append({"catalog_id": c["id"], "priority": "must_have", "sections": 1, "override_enrollment_cap": None, "override_preferred_professors": None, "notes": None})
                        add_log("DRAFT", f"Added {c['id']}"); st.rerun()

            # Inline preview below selected course
            if is_inspected:
                _desc = html.escape(c.get("description", "No description available."))
                _req_eq = c.get("required_equipment") or []
                _room = ", ".join(t.replace("_", " ").title() for t in _req_eq) if _req_eq else "Any"
                _profs = c.get("preferred_professors", [])
                _prof_str = ", ".join(p.replace("prof_", "").replace("_", " ").title() for p in _profs[:3]) if _profs else "—"
                _grad = f'<span style="font-size:0.55rem; background:{BG_HOVER}; border:1px solid {BORDER}; border-radius:3px; padding:1px 5px; margin-left:4px; color:{TXT_MUTED};">GRAD</span>' if c.get("is_graduate") else ""
                st.markdown(
                    f'<div style="background:{BG_CARD}; border:1px solid {ACCENT}40; border-left:3px solid {ACCENT}; border-radius:0 8px 8px 0; padding:10px 14px; margin:-4px 0 6px 20px;">'
                    f'<div style="font-size:0.72rem; color:{TXT_MUTED}; line-height:1.5;">{_desc}</div>'
                    f'<div style="margin-top:6px; font-size:0.68rem; color:{TXT_MUTED};">Room: {_room} &middot; Faculty: {_prof_str}{_grad}</div>'
                    f'</div>', unsafe_allow_html=True)

        if page_end < total_cat:
            if st.button(f"Show more ({total_cat - page_end} remaining)", key="cat_show_more", use_container_width=True):
                st.session_state["cat_page"] = cat_page + 1; st.rerun()
        elif total_cat == 0 and dept_filter:
            st.markdown(f'<div style="text-align:center; color:{TXT_MUTED}; padding:2rem; font-size:0.8rem;">No courses match your search.</div>', unsafe_allow_html=True)

    # Mobile bottom nav removed — desktop only (see CLAUDE.md Rule 1)
