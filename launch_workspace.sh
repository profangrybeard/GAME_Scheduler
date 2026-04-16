#!/usr/bin/env bash
# ─── GAME Scheduler — React Workspace Launcher (Mac/Linux) ───────
# Starts the FastAPI solver backend AND the Vite dev server together.
# The existing launch.sh (Streamlit UI) still works unchanged.
#
# Usage: ./launch_workspace.sh
#        Opens the React workspace at http://localhost:5174
set -e

cd "$(dirname "$0")"

VENV_DIR=".venv"

# ── Check Python ────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "Error: Python 3 is required but not found."
    echo "Install it from https://www.python.org/downloads/"
    exit 1
fi

# ── Check Node ──────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    echo "Error: Node.js / npm is required for the React workspace."
    echo "Install it from https://nodejs.org/"
    exit 1
fi

# ── Create venv if missing ──────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "First run — creating virtual environment..."
    $PY -m venv "$VENV_DIR"
fi

# ── Activate venv ───────────────────────────────────────────────
source "$VENV_DIR/bin/activate"

# ── Install/update Python dependencies ──────────────────────────
if [ ! -f "$VENV_DIR/.deps_installed" ] || [ requirements.txt -nt "$VENV_DIR/.deps_installed" ]; then
    echo "Installing Python dependencies..."
    pip install -q -r requirements.txt
    touch "$VENV_DIR/.deps_installed"
fi

# ── Install Node deps if missing ────────────────────────────────
if [ ! -d "frontend/node_modules" ]; then
    echo "Installing Node dependencies..."
    (cd frontend && npm ci)
fi

# ── Launch both processes ───────────────────────────────────────
echo ""
echo "Starting GAME Scheduler workspace..."
echo "  Solver backend: http://127.0.0.1:8765"
echo "  React workspace: http://localhost:5174"
echo ""
echo "Press Ctrl+C to stop both processes."
echo ""

# Start uvicorn in the background; trap to kill it when Vite exits or user Ctrl+Cs.
python -m uvicorn api.server:app --host 127.0.0.1 --port 8765 --log-level warning &
UVICORN_PID=$!

cleanup() {
    echo ""
    echo "Stopping backend..."
    kill "$UVICORN_PID" 2>/dev/null || true
    wait "$UVICORN_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Run Vite in the foreground so Ctrl+C shuts everything down cleanly.
(cd frontend && npm run dev)
