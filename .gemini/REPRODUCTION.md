# Reproduction Guide: UI/UX Stability (Rev 1.4.5)

This document tracks the critical configuration steps required to maintain the "Draft Room" experience and prevent regressions.

## 1. Theme Configuration
Streamlit's default red accent is suppressed via `.streamlit/config.toml`. 
- **File:** `.streamlit/config.toml`
- **Key Setting:** `primaryColor = "#818CF8"`
- **Requirement:** This file must exist in the root to ensure Toggles and Multiselect chips use the Indigo palette.

## 2. CSS Injection (The .format() Pattern)
To avoid `NameError` and `SyntaxError` during f-string interpolation of CSS:
- **Pattern:** Use a separate `CSS_TEMPLATE` string with double-braces `{{ }}` for literal CSS and single-braces `{}` for design tokens.
- **Execution:** Inject using `st.markdown(CSS_TEMPLATE.format(...), unsafe_allow_html=True)`.
- **Reason:** This prevents Python from attempting to evaluate CSS properties (like `background-color`) as Python variables.

## 3. Top-Down Initialization
All session state (`st.session_state`) and global utility functions (like `add_log`) MUST be defined at the top of `app.py` before any layout components are called. This ensures they are available during Streamlit's top-down execution flow.

## 4. Column Interaction
The "Place on Calendar" interaction relies on `st.session_state["placing_offering_idx"]`. 
- **Workflow:** Set index on click -> Rerun -> Render placement targets in Grid -> Update offering on target click -> Clear index -> Rerun.
