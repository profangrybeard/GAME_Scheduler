"""Tests for /api/backups/reveal — the About popover's "Show backups folder"
link. Three behaviors matter:

  1. On a hosted Fly container, return 501 with an explanatory message
     (detected via FLY_APP_NAME env var — Fly always sets it).
  2. Locally, when no .backups/ exists yet, return 404 with guidance to
     export first (don't launch the file browser into nothingness).
  3. Locally, when .backups/ exists, dispatch to the platform-appropriate
     opener (os.startfile on Windows, `open` on macOS, `xdg-open` otherwise)
     and return 200.

We never actually spawn a file-browser window in the test run — the OS
dispatch functions are monkeypatched so CI doesn't pop a GUI.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    from api.server import app
    return TestClient(app)


def test_reveal_501_when_running_on_fly(client, monkeypatch):
    """FLY_APP_NAME is the canonical Fly-container marker."""
    monkeypatch.setenv("FLY_APP_NAME", "game-scheduler-staging")
    res = client.get("/api/backups/reveal")
    assert res.status_code == 501
    assert "hosted" in res.json()["detail"].lower()


def test_reveal_404_when_no_backups_dir(client, monkeypatch, tmp_path):
    """If the user hasn't exported yet, the folder doesn't exist — 404 with
    a hint about what to do first."""
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    # Repoint BASE to a scratch dir with no .backups/ subfolder.
    import api.server as srv
    monkeypatch.setattr(srv, "BASE", tmp_path)
    res = client.get("/api/backups/reveal")
    assert res.status_code == 404
    assert "export" in res.json()["detail"].lower()


def test_reveal_200_dispatches_to_platform_opener(client, monkeypatch, tmp_path):
    """Happy path: backups dir exists, the OS dispatch gets called exactly
    once with the dir path. We don't care which branch fires — we only care
    that *some* opener was invoked with the right path."""
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    backups = tmp_path / ".backups"
    backups.mkdir()

    import api.server as srv
    monkeypatch.setattr(srv, "BASE", tmp_path)

    calls: list[str] = []

    def fake_startfile(p):
        calls.append(("startfile", p))

    def fake_subprocess_run(cmd, check=False):
        calls.append(("subprocess", tuple(cmd)))
        class _R:
            returncode = 0
        return _R()

    # Patch both potential dispatch routes so the test is platform-agnostic.
    if os.name == "nt":
        monkeypatch.setattr(srv.os, "startfile", fake_startfile, raising=False)
    monkeypatch.setattr(srv.subprocess, "run", fake_subprocess_run)

    res = client.get("/api/backups/reveal")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert Path(body["path"]) == backups

    # Exactly one dispatch fired, and it carried our backups path.
    assert len(calls) == 1
    kind, arg = calls[0]
    if kind == "startfile":
        assert Path(arg) == backups
    else:
        # subprocess branch: cmd is (opener, path)
        assert Path(arg[1]) == backups
        assert arg[0] in ("open", "xdg-open")


def test_reveal_500_when_opener_raises(client, monkeypatch, tmp_path):
    """An OS-level failure (bad xdg-open install, missing GUI, etc.) should
    bubble up as a 500 with a useful message, not a 500 with a stack trace."""
    monkeypatch.delenv("FLY_APP_NAME", raising=False)
    backups = tmp_path / ".backups"
    backups.mkdir()

    import api.server as srv
    monkeypatch.setattr(srv, "BASE", tmp_path)

    def boom(*a, **k):
        raise RuntimeError("no display")

    if os.name == "nt":
        monkeypatch.setattr(srv.os, "startfile", boom, raising=False)
    monkeypatch.setattr(srv.subprocess, "run", boom)

    res = client.get("/api/backups/reveal")
    assert res.status_code == 500
    assert "no display" in res.json()["detail"].lower()
