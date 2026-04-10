# UX/UI Strategy: SCAD GAME Scheduler

## Current State Assessment
The application is a functional Streamlit web app focused on a complex constraint-solving problem. 
- **Strengths:** Robust backend (OR-Tools), template system, Excel export, and real-world data integration.
- **Opportunities:** Streamline the workflow, improve visual hierarchy, and enhance the "lock-and-tweak" manual override experience.

## UX Principles
1. **Clarity over Complexity:** Scheduling is inherently complex; the UI should simplify the decision-making process.
2. **Immediate Feedback:** Use the "Faculty Availability Dots" and live validation to prevent errors before they reach the solver.
3. **Intentional Navigation:** Guide the user through a logical flow: Data Prep -> Configuration -> Solve -> Review -> Export.

## Proposed Experience Enhancements
- **Visual Schedule Comparison:** Instead of switching between sheets or tabs, provide a side-by-side or "diff" view of the three solver modes.
- **Interactive Calendar:** Transition from a static display to a more interactive "drag-and-drop" or "click-to-swap" interface for manual tweaks.
- **Onboarding/Guides:** Simple tooltips or a "getting started" wizard for new users (chairs/faculty).
- **Aesthetic Polish:** Custom CSS to align with SCAD's brand identity (typography, color palette, spacing).

## Documentation & Revision Control
- **Revision Number:** 1.0.0
- **Context Snapshot:** Stored in `.gemini/context_snapshot.json`
- **Reproduction Steps:** See `MILESTONES.md` for CLI/Core, `README.md` for UI.
