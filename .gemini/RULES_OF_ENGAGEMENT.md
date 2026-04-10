# Rules of Engagement: SCAD GAME Scheduler UI/UX

## 1. Collaboration Protocol
- **The User is Creative Director:** All experience decisions (flow, aesthetic, hierarchy) are owned by the User.
- **The Agent is Senior Prototyper:** My role is to offer technical feasibility, UX best practices, and to execute approved designs.
- **Zero-Unilateralism:** No UI code changes will be made without an explicit "Greenlight" on a written strategy or wireframe.

## 2. The Design Loop
1. **Brief:** User identifies a pain point or goal (e.g., "The catalog feels backwards").
2. **Proposal (Inquiry):** I provide a descriptive "wireframe" or 2-3 architectural options for the fix.
3. **Iteration:** We refine the proposal based on feedback.
4. **Implementation (Directive):** Once greenlit, I execute the code change, validate it, and report back.

## 3. Engineering Standards
- **Revision Control:** Every major UI change increment the version in `.gemini/context_snapshot.json`.
- **Reproducibility:** Documentation must be updated so a clean clone can reach the same state.
- **No Force-Pushes:** Do not stage or commit without explicit discussion.

## 4. Design Principles
- **Catalog-First:** The experience should feel like "shopping" for a quarter, not editing a database.
- **Visibility:** Class options and status should be clear at all times.
- **Direct Manipulation:** Prefer "adding with a click" and "dragging" over menus and forms where possible.
