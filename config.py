"""Global constants for the Course Scheduling Tool.

All constants, enums, weight vectors, and mappings live here.
Import from this module everywhere — never hardcode inline.
"""

# === Schedule structure ===
STANDARD_MAX = 4
OVERLOAD_MAX = 5
CHAIR_MAX = 2
TIME_SLOTS = ["8:00AM", "11:00AM", "2:00PM", "5:00PM"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
DAY_GROUPS = {1: ["Monday", "Wednesday"], 2: ["Tuesday", "Thursday"], 3: ["Friday"]}
DAY_GROUP_LABELS = {1: "MW", 2: "TTh", 3: "F"}
CLASS_DURATION_HRS = 2.5
VALID_QUARTERS = ["fall", "winter", "spring", "summer"]
VALID_DEPARTMENTS = ["game", "motion_media", "ai"]

# === Penalty values ===
# Level 3 ("fallback") is out-of-department but otherwise eligible — used when
# the roster has no dept-matched prof for a course. Keeps must_have sections
# feasible instead of crashing with "no eligible professors".
AFFINITY_PENALTIES = {0: 0, 1: 1, 2: 3, 3: 10, "other": 10}
TIME_PREF_PENALTIES = {"preferred": 0, "acceptable": 2, "not_preferred": 5}
OVERLOAD_PENALTY = 8
# Drop penalties get multiplied by the mode's coverage weight — high coverage
# makes the solver fight harder to place should/could sections, low coverage
# lets electives drop when the rest of the schedule is tight.
SHOULD_HAVE_DROP_PENALTY = 20
COULD_HAVE_DROP_PENALTY = 5
# Fairness invariant — the solver should never leave one prof under-contract
# while overloading another. Applied per missing class from a prof's floor
# (chair=CHAIR_MAX, others=STANDARD_MAX). NOT mode-weighted: this is a rule,
# not a preference. Value chosen to dominate the combined coverage + time
# budget so the solver always prefers to level-load, even if it means placing
# classes with non-preferred professors.
UNDER_CONTRACT_PENALTY = 500
# Affinity (prof-course specialization match) is always in the objective at
# a fixed low weight — it's a nice-to-have that the solver tries its best on,
# not a chair-tunable trade-off. Users tune coverage, time-pref, and overload;
# affinity quietly breaks ties between otherwise-equivalent assignments.
AFFINITY_WEIGHT = 1
# Per-missing-preferred-equipment-tag penalty. Small so it acts as a
# tiebreaker between otherwise-equivalent rooms, not a coarse eligibility
# gate (that's what required_equipment is for). Applied once per assignment
# per tag the course prefers that the room lacks.
PREFERRED_EQUIPMENT_PENALTY = 2

# === Optimization mode weight vectors ===
# Three axes:
#   coverage   — how grimly we refuse to drop should/could sections
#   time_pref  — how hard we honor prof time_preference
#   overload   — how hard we resist pushing a prof above STANDARD_MAX
#
# Affinity floats in the objective at a fixed low weight (AFFINITY_WEIGHT)
# — always tried, never tuned. The contract-min floor is a separate strong-
# soft invariant (UNDER_CONTRACT_PENALTY), also not tuned.
MODE_WEIGHTS = {
    "cover_first":       {"coverage": 10, "time_pref": 1,  "overload": 1},
    "time_pref_first":   {"coverage": 3,  "time_pref": 10, "overload": 2},
    "balanced":          {"coverage": 5,  "time_pref": 5,  "overload": 3},
}

# === Time preference full mapping ===
TIME_PREF_MAP = {
    ("morning",           "8:00AM"):  "preferred",
    ("morning",           "11:00AM"): "preferred",
    ("morning",           "2:00PM"):  "acceptable",
    ("morning",           "5:00PM"):  "not_preferred",
    ("afternoon",         "8:00AM"):  "not_preferred",
    ("afternoon",         "11:00AM"): "acceptable",
    ("afternoon",         "2:00PM"):  "preferred",
    ("afternoon",         "5:00PM"):  "preferred",
    ("afternoon_evening", "8:00AM"):  "not_preferred",
    ("afternoon_evening", "11:00AM"): "acceptable",
    ("afternoon_evening", "2:00PM"):  "preferred",
    ("afternoon_evening", "5:00PM"):  "preferred",
}

# === Catalog inference ===
PREFIX_TO_DEPT = {
    "GAME": "game",
    "ITGM": "game",
    "MOME": "motion_media",
    "AI":   "ai",
}

# === Valid specialization tags (controlled vocabulary) ===
VALID_SPECIALIZATIONS = [
    # Art & 3D
    "3d_modeling", "texturing", "uv_mapping", "materials", "lighting",
    "rendering", "real_time_rendering", "pbr_workflows", "photogrammetry",
    "arch_viz", "character_art", "character_animation", "character_rigging",
    "environment_art", "concept_art", "concept_design", "art_direction",
    "graphic_design", "illustration",
    # Animation & Motion
    "animation", "computer_animation", "motion_graphics", "motion_design",
    "2d_motion_graphics", "3d_motion_graphics", "visual_effects", "vfx",
    "compositing", "stop_motion", "storyboarding",
    # Tools
    "maya", "zbrush", "unreal_engine", "unreal_engine_4", "unreal_engine_5",
    "cryengine", "blueprint", "cinema_4d",
    "after_effects", "adobe_creative_suite", "shader_creation",
    # Design
    "game_design", "game_mechanics", "game_systems", "game_design_documentation",
    "level_design", "quest_design", "narrative", "world_building",
    "environmental_narrative", "combat_design", "encounter_design",
    "interactive_storytelling", "prototyping", "tabletop_game_design",
    "environmental_design", "interaction_design", "ui_design", "ui_ux_design",
    "interface_design", "information_design", "interactive_design",
    "interactive_multimedia", "digital_typography", "typography",
    "screen_design", "branding", "multimedia",
    "pvp_design", "open_world", "procedural_world_building",
    # Engineering
    "programming", "cpp", "csharp", "scripting", "gameplay_engineering",
    "game_tech", "database_design", "electronics_prototyping",
    "technical_art", "tool_development", "pipeline_development",
    "map_optimization", "performance_optimization",
    # Production
    "production", "scrum", "agile", "game_development", "gameplay",
    "production_oversight", "creative_direction", "creative_writing",
    # Motion Media Specific
    "broadcast_design", "live_cinema", "video_installation",
    "projection_mapping", "live_performance", "vjing", "audio_visual",
    "media_art", "digital_scenography", "art_history", "media_theory",
    "computer_art", "film", "sound_design",
    # AI
    "ai_application", "ai_pipeline", "ai_design", "ai_ideation",
    # Other
    "mmorpg", "multiplayer", "virtual_reality", "modeling",
    "graduate_studies",
]
