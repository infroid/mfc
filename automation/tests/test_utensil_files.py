"""utensil bundle path + iter helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mfc.core import files


def test_utensil_bundles_root(tmp_path):
    assert files.utensil_bundles_root(tmp_path) == tmp_path / "web" / "assets" / "utensils"


def test_utensil_bundle_path(tmp_path):
    assert files.utensil_bundle_path(tmp_path, "kadhai") == \
        tmp_path / "web" / "assets" / "utensils" / "kadhai" / "utensil.json"


def test_iter_utensil_bundles_yields_only_dirs_with_json(tmp_path):
    root = files.utensil_bundles_root(tmp_path)
    (root / "kadhai").mkdir(parents=True)
    (root / "kadhai" / "utensil.json").write_text("{}")
    (root / "no-json-here").mkdir()
    (root / "loose-file.txt").write_text("ignore")
    found = sorted(p.parent.name for p in files.iter_utensil_bundles(tmp_path))
    assert found == ["kadhai"]


def test_load_utensil_json_round_trips(tmp_path):
    root = files.utensil_bundles_root(tmp_path)
    (root / "k").mkdir(parents=True)
    (root / "k" / "utensil.json").write_text(json.dumps({"id": "k", "name": "K"}))
    data = files.load_utensil_json(root / "k" / "utensil.json")
    assert data == {"id": "k", "name": "K"}
