@echo off
REM ─── GAME Scheduler — React Workspace Launcher (Windows) ──────
REM Starts the FastAPI solver backend AND the Vite dev server together.
REM The existing run.bat (Streamlit UI) still works unchanged.
REM
REM Usage: double-click run_workspace.bat
REM        Opens the React workspace at http://localhost:5174

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

REM ── Check Node ────────────────────────────────────────────────
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Error: Node.js / npm is required for the React workspace.
    echo Install it from https://nodejs.org/
    pause
    exit /b 1
)

REM ── Create venv if missing ────────────────────────────────────
if not exist ".venv" (
    echo First run - creating virtual environment...
    python -m venv .venv
)

REM ── Activate venv ─────────────────────────────────────────────
call .venv\Scripts\activate.bat

REM ── Install/update Python dependencies ────────────────────────
if not exist ".venv\.deps_installed" (
    echo Installing Python dependencies...
    pip install -q -r requirements.txt
    echo. > .venv\.deps_installed
)

REM ── Install Node deps if missing ──────────────────────────────
if not exist "frontend\node_modules" (
    echo Installing Node dependencies...
    pushd frontend
    call npm ci
    popd
)

REM ── Launch both processes ─────────────────────────────────────
echo.
echo Starting GAME Scheduler workspace...
echo   Solver backend: http://127.0.0.1:8765
echo   React workspace: http://localhost:5174
echo.
echo Close this window to stop both processes.
echo.

REM Start uvicorn in a new minimized window so its logs don't clutter Vite's.
start "GAME Scheduler API" /min cmd /c "call .venv\Scripts\activate.bat && python -m uvicorn api.server:app --host 127.0.0.1 --port 8765 --log-level warning"

REM Run Vite in the foreground.
cd frontend
call npm run dev

REM When Vite exits (Ctrl+C), clean up the backend window too.
taskkill /FI "WINDOWTITLE eq GAME Scheduler API" /F >nul 2>&1
