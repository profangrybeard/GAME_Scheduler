#!/usr/bin/env bash
# ─── SCAD Course Scheduler — Mac Launcher ────────────────────────
# Usage: ./launch.sh
# First run creates a venv and installs dependencies automatically.
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

# Verify it's Python 3
PY_VER=$($PY --version 2>&1)
if [[ ! "$PY_VER" == *"Python 3"* ]]; then
    echo "Error: Python 3 required, found $PY_VER"
    exit 1
fi

# ── Create venv if missing ──────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "First run — creating virtual environment..."
    $PY -m venv "$VENV_DIR"
fi

# ── Activate venv ───────────────────────────────────────────────
source "$VENV_DIR/bin/activate"

# ── Install/update dependencies ─────────────────────────────────
if [ ! -f "$VENV_DIR/.deps_installed" ] || [ requirements.txt -nt "$VENV_DIR/.deps_installed" ]; then
    echo "Installing dependencies..."
    pip install -q -r requirements.txt
    touch "$VENV_DIR/.deps_installed"
fi

# ── Launch ──────────────────────────────────────────────────────
echo ""
echo "Starting Course Scheduler..."
echo "The app will open in your browser at http://localhost:8501"
echo ""
python -m streamlit run app.py --server.headless true
