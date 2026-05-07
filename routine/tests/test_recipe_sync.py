from __future__ import annotations

import subprocess
from typing import Any

import pytest
from dagster import build_op_context

from routine.jobs.recipe_sync import SyncConfig, run_sync


def _capture(monkeypatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")

    monkeypatch.setattr("subprocess.run", fake_run)
    return captured


def test_run_sync_builds_expected_command(monkeypatch):
    captured = _capture(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="push"))
    cmd = captured["cmd"]
    assert cmd[:2] == ["uv", "--project"]
    assert cmd[2].endswith("automation")
    assert cmd[3:6] == ["run", "mfc", "sync-recipes"]
    assert cmd[-3:] == ["sync-recipes", "--direction", "push"]


def test_run_sync_appends_recipe_filter(monkeypatch):
    captured = _capture(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="pull", only=["a", "b"]))
    cmd = captured["cmd"]
    assert cmd[-4:] == ["--recipe", "a", "--recipe", "b"]


def test_run_sync_raises_on_nonzero_exit(monkeypatch):
    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="boom")

    monkeypatch.setattr("subprocess.run", fake_run)
    ctx = build_op_context()
    with pytest.raises(RuntimeError, match="boom"):
        run_sync(ctx, SyncConfig(direction="push"))
