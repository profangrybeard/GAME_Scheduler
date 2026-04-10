# Implementation Checkpoints: Draft Room Refactor (Revision 1.2.0)

This document tracks the phased rollout of the new UX. Each stage must be **Verified** before the next begins.

## Stage 1: The 3-Column Scaffolding
- **Goal:** Replace the 4-tab system with a unified 3-column "Quarter Planner."
- **Status:** COMPLETE
- **Verification:** 3-column layout implemented. Scout (Catalog), Board (Draft), and Roster (Faculty) columns visible and functional.

## Stage 2: The "Star & Assign" Flow
- **Goal:** Wire the buttons for "Drafting" (Adding to current quarter) and "Assigning" (Attaching a prof to a course).
- **Review Point:** If you "Star" a course in Col 1, does it appear in the "Bench" in Col 2? If you assign a Prof, does the card update?
- **Validation:** Check `st.session_state` for data integrity.

## Stage 3: The "Interactive Calendar"
- **Goal:** Integrate the Weekly Grid into the center column. Implement "Pin to Time" logic.
- **Review Point:** Do pinned courses stay put? Is the "Locked" status visually clear (🔒 icon)?

## Stage 4: The Engine Handshake
- **Goal:** Connect the "Generate Remainder" button to the CP-SAT solver.
- **Review Point:** Does the solver respect manual "Locks"? Does it fill the remaining TBD slots optimally?
- **Validation:** Run `python -m ingest.validate` to ensure the generated schedule is legal.

## Stage 5: The "Scout Report" & SCAD Polish
- **Goal:** Custom CSS (brand colors, typography) and "Vegas Odds" tooltips (engine suggestions).
- **Review Point:** Final aesthetic pass. Does it feel like a professional SCAD tool?
