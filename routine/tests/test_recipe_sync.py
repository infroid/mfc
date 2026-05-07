from __future__ import annotations

import pytest
from dagster import build_op_context

from routine.jobs.recipe_sync import SyncConfig, run_sync


class _FakePopen:
    def __init__(self, returncode=0, lines=("ok",), cmd=None):
        self.returncode_ = returncode
        self.lines = list(lines)
        self.stdout = iter(self.lines)
        self.cmd = cmd

    def wait(self):
        return self.returncode_


def _capture_popen(monkeypatch, returncode=0, lines=("ok",)):
    captured: dict = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return _FakePopen(returncode=returncode, lines=lines, cmd=cmd)

    monkeypatch.setattr("subprocess.Popen", fake_popen)
    return captured


def test_run_sync_builds_expected_command(monkeypatch):
    captured = _capture_popen(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="push"))
    cmd = captured["cmd"]
    assert cmd[:2] == ["uv", "--project"]
    assert cmd[2].endswith("automation")
    assert cmd[3:6] == ["run", "mfc", "sync-recipes"]
    assert cmd[-3:] == ["sync-recipes", "--direction", "push"]


def test_run_sync_appends_recipe_filter(monkeypatch):
    captured = _capture_popen(monkeypatch)
    ctx = build_op_context()
    run_sync(ctx, SyncConfig(direction="pull", only=["a", "b"]))
    cmd = captured["cmd"]
    assert cmd[-4:] == ["--recipe", "a", "--recipe", "b"]


def test_run_sync_raises_on_nonzero_exit(monkeypatch):
    _capture_popen(monkeypatch, returncode=2, lines=("boom",))
    ctx = build_op_context()
    with pytest.raises(RuntimeError, match="exit 2"):
        run_sync(ctx, SyncConfig(direction="push"))
