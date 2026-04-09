"""Scrape the SCAD public catalog for GAME, ITGM, and MOME courses.

Usage:
    python -m ingest.catalog_scraper            # scrape live + write data/course_catalog.json
    python -m ingest.catalog_scraper --offline   # skip scraping, use fallback data only

The scraper hits catalog.scad.edu, parses course listings, then pipes
them through catalog_defaults.apply_defaults() to fill in scheduler
fields (department, room type, tags, preferred professors, etc.).

If the live scrape fails or returns no results for a prefix, the
scraper falls back to a built-in course list so the pipeline always
produces usable output.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from ingest.catalog_defaults import apply_defaults

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CATALOG_BASE = "https://catalog.scad.edu"
PREFIX_PAGES = {
    "GAME": "/courses/game/",
    "ITGM": "/courses/itgm/",
    "MOME": "/courses/mome/",
}
# Alternate URL patterns to try if the first doesn't work
ALT_PREFIX_PAGES = {
    "GAME": [
        "/preview_program.php?catoid=37&poid=7594",
        "/content.php?catoid=37&navoid=4108",
    ],
    "ITGM": [
        "/preview_program.php?catoid=37&poid=7608",
        "/content.php?catoid=37&navoid=4108",
    ],
    "MOME": [
        "/preview_program.php?catoid=37&poid=7620",
        "/content.php?catoid=37&navoid=4108",
    ],
}

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "course_catalog.json"

HEADERS = {
    "User-Agent": "SCAD-CourseScheduler/1.0 (academic tool)",
    "Accept": "text/html",
}

NOW_ISO = datetime.now(timezone.utc).isoformat()

# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------


def _fetch(url: str) -> str | None:
    """GET a URL, return text or None on failure."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"  [warn] Could not fetch {url}: {e}")
        return None


def _parse_courseleaf(soup: "BeautifulSoup", prefix: str) -> list[dict]:
    """Parse Courseleaf CMS format (catalog.scad.edu).

    Each course lives in a div.courseblock with child spans/divs:
      .detail-code        → "GAME 120"
      .detail-title       → "Introduction to ..."
      .detail-hours_html  → "(5 Credits)"
      .courseblockextra   → description paragraph(s)
      .detail-prereqs     → prerequisite text
    """
    blocks = soup.find_all("div", class_="courseblock")
    if not blocks:
        return []

    courses = []
    seen_ids = set()

    for block in blocks:
        code_el = block.find(class_="detail-code")
        if not code_el:
            continue
        code_text = code_el.get_text(strip=True)
        m = re.match(r"([A-Z]+)\s+(\d{3}[A-Z]?)", code_text, re.IGNORECASE)
        if not m or m.group(1).upper() != prefix:
            continue

        pfx = m.group(1).upper()
        num = m.group(2)
        course_id = f"{pfx}_{num}"
        if course_id in seen_ids:
            continue
        seen_ids.add(course_id)

        title_el = block.find(class_="detail-title")
        title = title_el.get_text(strip=True) if title_el else ""

        credits = 5  # SCAD default
        hours_el = block.find(class_="detail-hours_html")
        if hours_el:
            cr_m = re.search(r"(\d+)\s*[Cc]redit", hours_el.get_text())
            if cr_m:
                credits = int(cr_m.group(1))

        desc_el = block.find(class_="courseblockextra")
        desc = desc_el.get_text(separator=" ", strip=True) if desc_el else ""

        prereqs = []
        prereq_el = block.find(class_="detail-prereqs")
        if prereq_el:
            prereq_text = prereq_el.get_text(separator=" ", strip=True)
            prereq_text = prereq_text.replace("\xa0", " ")  # non-breaking spaces
            for pm in re.finditer(r"([A-Z]{3,4})\s+(\d{3})", prereq_text):
                prereqs.append(f"{pm.group(1)}_{pm.group(2)}")

        courses.append({
            "prefix": pfx,
            "number": num,
            "name": title,
            "credits": credits,
            "description": desc,
            "is_graduate": int(re.match(r"\d+", num).group()) >= 500,
            "prerequisites": prereqs,
            "last_scraped": NOW_ISO,
            "source": "scraped",
        })

    return courses


def _parse_regex_fallback(soup: "BeautifulSoup", prefix: str) -> list[dict]:
    """Regex fallback for non-Courseleaf pages.

    Scans all text-bearing elements for "PREFIX NNN - Title" patterns.
    """
    pattern = re.compile(
        rf"\b({prefix})\s+(\d{{3}}[A-Z]?)\s*[-\u2013\u2014:]\s*(.+)", re.IGNORECASE
    )
    candidates = []
    for tag in soup.find_all(["h2", "h3", "h4", "h5", "a", "td", "li", "p", "div", "span"]):
        text = tag.get_text(strip=True)
        m = pattern.search(text)
        if m:
            candidates.append((tag, m))

    seen_ids = set()
    courses = []
    for tag, m in candidates:
        pfx = m.group(1).upper()
        num = m.group(2)
        title = m.group(3).strip()
        title = re.sub(r"\s*\(\d+\s*credits?\)\s*$", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\s*\d+\s*credits?\s*$", "", title, flags=re.IGNORECASE)
        title = title.strip(" -:.")
        course_id = f"{pfx}_{num}"
        if course_id in seen_ids or not title:
            continue
        seen_ids.add(course_id)

        desc = ""
        for sib in tag.find_next_siblings(limit=3):
            sib_text = sib.get_text(strip=True)
            if sib_text and not pattern.search(sib_text) and len(sib_text) > 20:
                desc = sib_text
                break
        if not desc and tag.parent:
            for child in tag.parent.children:
                if child != tag and hasattr(child, "get_text"):
                    child_text = child.get_text(strip=True)
                    if child_text and not pattern.search(child_text) and len(child_text) > 20:
                        desc = child_text
                        break

        credits = 5
        cr_match = re.search(r"(\d+)\s*credits?", desc, re.IGNORECASE)
        if cr_match:
            credits = int(cr_match.group(1))

        prereqs = []
        prereq_match = re.search(r"[Pp]rerequisites?:\s*(.+?)(?:\.|$)", desc)
        if prereq_match:
            prereq_text = prereq_match.group(1).replace("\xa0", " ")
            for pm in re.finditer(r"([A-Z]{3,4})\s+(\d{3})", prereq_text):
                prereqs.append(f"{pm.group(1)}_{pm.group(2)}")

        courses.append({
            "prefix": pfx,
            "number": num,
            "name": title,
            "credits": credits,
            "description": desc,
            "is_graduate": int(re.match(r"\d+", num).group()) >= 500,
            "prerequisites": prereqs,
            "last_scraped": NOW_ISO,
            "source": "scraped",
        })

    return courses


def _parse_courses_from_html(html: str, prefix: str) -> list[dict]:
    """Extract courses from a catalog HTML page.

    Tries Courseleaf CMS format first (catalog.scad.edu), then falls
    back to regex scanning for non-Courseleaf pages.
    """
    soup = BeautifulSoup(html, "html.parser")
    courses = _parse_courseleaf(soup, prefix)
    if courses:
        return courses
    return _parse_regex_fallback(soup, prefix)


def scrape_prefix(prefix: str) -> list[dict]:
    """Scrape all courses for a given prefix, trying multiple URL patterns."""
    # Try primary URL
    primary_url = CATALOG_BASE + PREFIX_PAGES[prefix]
    print(f"  Trying {primary_url} ...")
    html = _fetch(primary_url)
    if html:
        courses = _parse_courses_from_html(html, prefix)
        if courses:
            return courses

    # Try alternate URLs
    for alt_path in ALT_PREFIX_PAGES.get(prefix, []):
        alt_url = CATALOG_BASE + alt_path
        print(f"  Trying alternate {alt_url} ...")
        html = _fetch(alt_url)
        if html:
            courses = _parse_courses_from_html(html, prefix)
            if courses:
                return courses

    return []


# ---------------------------------------------------------------------------
# Fallback course data (known SCAD courses from public catalog)
# ---------------------------------------------------------------------------

FALLBACK_COURSES = [
    # ---- GAME ----
    {"prefix": "GAME", "number": "100", "name": "Introduction to Game Development", "credits": 5, "is_graduate": False,
     "description": "Students are introduced to the fundamentals of game development, including game design principles, development pipelines, and collaborative workflows."},
    {"prefix": "GAME", "number": "200", "name": "Game Design", "credits": 5, "is_graduate": False,
     "description": "Students explore the principles and processes of game design, including mechanics, dynamics, aesthetics, gameplay prototyping, and iterative design."},
    {"prefix": "GAME", "number": "205", "name": "3-D Modeling for Games", "credits": 5, "is_graduate": False,
     "description": "Students learn 3D modeling techniques for game environments and props using Maya, including UV mapping, texturing, and asset optimization for real-time rendering."},
    {"prefix": "GAME", "number": "210", "name": "Game Scripting", "credits": 5, "is_graduate": False,
     "description": "Students learn programming and scripting fundamentals for game development, including C++ and C# scripting for gameplay systems."},
    {"prefix": "GAME", "number": "220", "name": "Level Design", "credits": 5, "is_graduate": False,
     "description": "Students develop skills in level design and environment layout for games, including spatial design, pacing, player flow, and implementation in Unreal Engine."},
    {"prefix": "GAME", "number": "235", "name": "Character Art for Games", "credits": 5, "is_graduate": False,
     "description": "Students create game-ready character models using ZBrush and Maya, including high-poly sculpting, retopology, UV mapping, texturing, and rigging."},
    {"prefix": "GAME", "number": "256", "name": "Game Mechanics", "credits": 5, "is_graduate": False,
     "description": "Students explore advanced game design concepts including game mechanics, game systems, balancing, game design documentation, and prototyping methodologies."},
    {"prefix": "GAME", "number": "300", "name": "Game Development Studio I", "credits": 5, "is_graduate": False,
     "description": "Students work in teams to develop a game project from concept through production, applying agile development practices, scrum methodology, and game development pipelines."},
    {"prefix": "GAME", "number": "310", "name": "Gameplay Engineering", "credits": 5, "is_graduate": False,
     "description": "Students develop advanced programming skills for gameplay systems including AI, physics, networking, and engine architecture using C++ and Unreal Engine."},
    {"prefix": "GAME", "number": "320", "name": "Environment Art for Games", "credits": 5, "is_graduate": False,
     "description": "Students create game environment art including modular assets, materials, lighting, and real-time rendering techniques in Unreal Engine."},
    {"prefix": "GAME", "number": "325", "name": "Technical Art for Games", "credits": 5, "is_graduate": False,
     "description": "Students learn technical art skills including shader creation, VFX, Blueprint visual scripting, material authoring, and pipeline tools for Unreal Engine."},
    {"prefix": "GAME", "number": "340", "name": "Game Development Studio II", "credits": 5, "is_graduate": False,
     "description": "Students continue collaborative game development with advanced production techniques, project management, and portfolio-quality deliverables."},
    {"prefix": "GAME", "number": "400", "name": "Game Development Studio III", "credits": 5, "is_graduate": False,
     "description": "Senior capstone game development studio where students produce a polished, shippable game project demonstrating mastery of game development."},
    {"prefix": "GAME", "number": "410", "name": "Advanced Game Design", "credits": 5, "is_graduate": False,
     "description": "Advanced exploration of game design theory, interactive storytelling, narrative design, quest design, and world building for complex game systems.",
     "notes": "Dodson priority for this course."},
    {"prefix": "GAME", "number": "490", "name": "Game Development Internship", "credits": 5, "is_graduate": False,
     "description": "Supervised professional internship in the game development industry."},
    {"prefix": "GAME", "number": "500", "name": "Game Development Foundations (Graduate)", "credits": 5, "is_graduate": True,
     "description": "Graduate-level introduction to game development covering design, art, and engineering fundamentals for students entering the M.F.A. program."},
    {"prefix": "GAME", "number": "510", "name": "Graduate Game Design", "credits": 5, "is_graduate": True,
     "description": "Graduate-level exploration of game design principles, systems thinking, and design methodology for complex interactive experiences.",
     "notes": "Dodson priority for graduate game design."},
    {"prefix": "GAME", "number": "700", "name": "Game Development M.F.A. Thesis", "credits": 5, "is_graduate": True,
     "description": "M.F.A. thesis project in game development demonstrating mastery of game development discipline."},

    # ---- ITGM ----
    {"prefix": "ITGM", "number": "100", "name": "Introduction to Interactive Design and Game Development", "credits": 5, "is_graduate": False,
     "description": "Students explore the foundations of interactive design and game development including digital media, interactive multimedia, and creative technology."},
    {"prefix": "ITGM", "number": "200", "name": "Interactive Design", "credits": 5, "is_graduate": False,
     "description": "Students develop skills in interaction design, interface design, UI design, information design, and user experience for digital media and games."},
    {"prefix": "ITGM", "number": "210", "name": "Digital Typography and Screen Design", "credits": 5, "is_graduate": False,
     "description": "Students explore digital typography, screen design, and layout principles for interactive media including branding and graphic design for games."},
    {"prefix": "ITGM", "number": "215", "name": "Storyboarding for Interactive Media", "credits": 5, "is_graduate": False,
     "description": "Students learn storyboarding techniques for games and interactive media, including visual storytelling, concept art, and pre-production planning."},
    {"prefix": "ITGM", "number": "220", "name": "Sound Design for Games and Interactive Media", "credits": 5, "is_graduate": False,
     "description": "Students explore sound design principles and audio implementation for games and interactive multimedia projects."},
    {"prefix": "ITGM", "number": "260", "name": "Electronics Prototyping", "credits": 5, "is_graduate": False,
     "description": "Students learn electronics prototyping for interactive installations and physical computing, including Arduino, sensors, and multimedia integration."},
    {"prefix": "ITGM", "number": "300", "name": "Advanced Interactive Design", "credits": 5, "is_graduate": False,
     "description": "Advanced interactive design studio exploring complex interaction design problems, creative coding, and interactive multimedia production."},
    {"prefix": "ITGM", "number": "310", "name": "Database Design for Interactive Media", "credits": 5, "is_graduate": False,
     "description": "Students learn database design and data-driven application development for interactive media and game systems."},
    {"prefix": "ITGM", "number": "500", "name": "Graduate Interactive Design", "credits": 5, "is_graduate": True,
     "description": "Graduate-level interactive design exploring advanced concepts in interactive multimedia, creative technology, and design research."},

    # ---- MOME ----
    {"prefix": "MOME", "number": "100", "name": "Introduction to Motion Media Design", "credits": 5, "is_graduate": False,
     "description": "Students explore the fundamentals of motion media design including motion graphics, animation, and time-based design using After Effects."},
    {"prefix": "MOME", "number": "200", "name": "Motion Graphics", "credits": 5, "is_graduate": False,
     "description": "Students develop skills in motion graphics and motion design, including 2D motion graphics, kinetic typography, and broadcast design using After Effects."},
    {"prefix": "MOME", "number": "210", "name": "3-D Motion Graphics", "credits": 5, "is_graduate": False,
     "description": "Students learn 3D motion graphics techniques using Cinema 4D, including modeling, animation, lighting, rendering, and compositing for motion design."},
    {"prefix": "MOME", "number": "220", "name": "Design for Motion", "credits": 5, "is_graduate": False,
     "description": "Students explore design principles for motion media including storyboarding, art direction, creative direction, branding, and visual storytelling."},
    {"prefix": "MOME", "number": "300", "name": "Motion Media Studio I", "credits": 5, "is_graduate": False,
     "description": "Studio course in motion media production including broadcast design, title sequences, commercial motion graphics, and client-based projects."},
    {"prefix": "MOME", "number": "310", "name": "Experimental Motion Media", "credits": 5, "is_graduate": False,
     "description": "Students explore experimental approaches to motion media including video installation, projection mapping, live cinema, and media art."},
    {"prefix": "MOME", "number": "320", "name": "Visual Effects and Compositing", "credits": 5, "is_graduate": False,
     "description": "Students learn visual effects and compositing techniques for motion media and film, including VFX pipelines and After Effects compositing."},
    {"prefix": "MOME", "number": "400", "name": "Motion Media Studio II", "credits": 5, "is_graduate": False,
     "description": "Advanced motion media studio focusing on portfolio-quality work, creative direction, art direction, and professional practice in motion design."},
    {"prefix": "MOME", "number": "500", "name": "Graduate Motion Media Design", "credits": 5, "is_graduate": True,
     "description": "Graduate-level motion media design exploring advanced concepts in motion graphics, media theory, art history, and design research.",
     "notes": "Imperato priority for graduate motion media."},
    {"prefix": "MOME", "number": "510", "name": "Graduate Live Cinema and Media Art", "credits": 5, "is_graduate": True,
     "description": "Graduate exploration of live cinema, live performance, VJing, audio visual art, digital scenography, and media art practice.",
     "notes": "Imperato priority."},
    {"prefix": "MOME", "number": "700", "name": "Motion Media M.F.A. Thesis", "credits": 5, "is_graduate": True,
     "description": "M.F.A. thesis project in motion media design demonstrating mastery of graduate studies in the discipline."},
]

# Manual AI department courses (stub — user will add more later)
MANUAL_AI_COURSES = [
    {"prefix": "AI", "number": "201", "name": "Applied AI for Creative Industries", "credits": 5,
     "is_graduate": False, "source": "manual",
     "description": "Students explore AI application, AI pipelines, and AI design for creative workflows including AI ideation, generative tools, and responsible AI use.",
     "required_room_type": "pc_lab",
     "enrollment_cap": 20},
]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run(offline: bool = False) -> list[dict]:
    """Scrape (or load fallback) → apply defaults → write JSON."""
    all_raw: list[dict] = []

    if not offline:
        for prefix in PREFIX_PAGES:
            print(f"Scraping {prefix} courses ...")
            scraped = scrape_prefix(prefix)
            if scraped:
                print(f"  [OK] Found {len(scraped)} {prefix} courses from live catalog")
                all_raw.extend(scraped)
            else:
                print(f"  [FALLBACK] No {prefix} courses from live scrape - using fallback data")
                all_raw.extend(
                    [c for c in FALLBACK_COURSES if c["prefix"] == prefix]
                )
    else:
        print("Offline mode - using fallback course data")
        all_raw.extend(FALLBACK_COURSES)

    # Add manual AI courses
    print(f"Adding {len(MANUAL_AI_COURSES)} manual AI course(s) ...")
    all_raw.extend(MANUAL_AI_COURSES)

    # Apply defaults (department, room type, tags, preferred profs, etc.)
    print("Applying catalog defaults ...")
    catalog = apply_defaults(all_raw)

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"\n[DONE] Wrote {len(catalog)} courses to {OUTPUT_PATH}")

    return catalog


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    offline = "--offline" in sys.argv
    catalog = run(offline=offline)

    # Quick summary
    from collections import Counter
    depts = Counter(c["department"] for c in catalog)
    grad = sum(1 for c in catalog if c["is_graduate"])
    print(f"\nSummary: {len(catalog)} courses - {dict(depts)}")
    print(f"  Graduate: {grad}, Undergraduate: {len(catalog) - grad}")
