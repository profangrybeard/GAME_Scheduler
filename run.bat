@echo off
REM ─── SCAD Course Scheduler — Windows Launcher ─────────────────
REM Usage: double-click run.bat
REM First run creates a venv and installs dependencies automatically.

cd /d "%~dp0"

REM ── Check Python ──────────────────────────────────────────────
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Python 3 is required but not found.
    echo Install it from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

REM ── Create venv if missing ────────────────────────────────────
if not exist ".venv" (
    echo First run — creating virtual environment...
    python -m venv .venv
)

REM ── Activate venv ─────────────────────────────────────────────
call .venv\Scripts\activate.bat

REM ── Install/update dependencies ───────────────────────────────
if not exist ".venv\.deps_installed" (
    echo Installing dependencies...
    pip install -q -r requirements.txt
    echo. > .venv\.deps_installed
)

REM ── Launch ────────────────────────────────────────────────────
echo.
echo Starting Course Scheduler...
echo The app will open in your browser at http://localhost:8501
echo.
python -m streamlit run app.py --server.headless true
pause
