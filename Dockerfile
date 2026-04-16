# syntax=docker/dockerfile:1.6
#
# GAME Scheduler — production container
# One process (uvicorn) serves both /api/* (FastAPI) and the prebuilt React
# bundle at /. Used by fly.io. Never used for local dev (see
# launch_workspace.sh for that).

# ─── Stage 1: build the React bundle ──────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app

# git is required by vite.config.ts `gitShortSha()` — the VersionBadge
# bakes the short SHA into the bundle at build time so every deployed
# build flags its own commit. Node Alpine doesn't include git by default.
RUN apk add --no-cache git

# Install JS deps first (cached when frontend/package*.json hasn't changed).
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund

# Copy the rest of the frontend source + the canonical data/ dir (Vite reads
# JSON from `../../data/*` at build time via resolveJsonModule).
# Also bring in .git/ so `git rev-parse` inside vite.config.ts works.
COPY frontend/ ./frontend/
COPY data/course_catalog.json data/professors.json data/rooms.json data/quarterly_offerings.default.json ./data/
COPY data/portraits/ ./data/portraits/
COPY .git/ ./.git/

# Production build. We deliberately do NOT set GITHUB_PAGES so Vite uses
# base='/', which is what we need when FastAPI serves the bundle at the root.
RUN cd frontend && npm run build


# ─── Stage 2: Python runtime ──────────────────────────────────────
FROM python:3.12-slim AS runtime
WORKDIR /app

# ortools ships native binaries that need libstdc++; python:slim has it,
# but pip can take a few minutes to install ortools+openpyxl+fastapi. Use
# --no-cache-dir so the layer stays small.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY api/ ./api/
COPY solver/ ./solver/
COPY export/ ./export/
COPY config.py ./

# Canonical reference data. quarterly_offerings.json (not .default) is gitignored
# per-user state; we deliberately don't ship it — the API reads the default
# through the override path or the React workspace supplies it in each request.
COPY data/course_catalog.json data/professors.json data/rooms.json data/quarterly_offerings.default.json ./data/

# Built React assets from stage 1. server.py picks these up via the
# FRONTEND_DIST env var below and mounts them at /.
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV FRONTEND_DIST=/app/frontend/dist
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

# Fly.io sets PORT; default to 8080 for docker run locally.
CMD ["sh", "-c", "uvicorn api.server:app --host 0.0.0.0 --port ${PORT:-8080}"]
