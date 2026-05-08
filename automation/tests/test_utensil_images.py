"""Pure-function tests for ops/utensil_images.py — URL normalization +
local enumeration. Storage round-trip is exercised via the live smoke test."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from mfc.ops import utensil_images as ui
from mfc.ops._storage_sync import decide


@dataclass
class _FakeConfig:
    supabase_url: str
    repo_root: Path


def test_storage_url_builds_canonical_public_url(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co", repo_root=tmp_path)
    url = ui.storage_url(cfg, utensil_id="kadhai", filename="kadhai.jpg")
    assert url == "https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai/kadhai.jpg"


def test_storage_url_strips_trailing_slash(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co/", repo_root=tmp_path)
    url = ui.storage_url(cfg, utensil_id="x", filename="x.jpg")
    assert url == "https://abc.supabase.co/storage/v1/object/public/utensil-images/x/x.jpg"


def test_normalize_pass_through_full_urls(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co", repo_root=tmp_path)
    full = "https://other.example.com/path.jpg"
    assert ui.normalize_image_value(cfg, utensil_id="kadhai", value=full) == full


def test_normalize_legacy_path_to_storage_url(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co", repo_root=tmp_path)
    legacy = "assets/utensils/kadhai/kadhai.jpg"
    assert ui.normalize_image_value(cfg, utensil_id="kadhai", value=legacy) == \
        "https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai/kadhai.jpg"


def test_normalize_legacy_with_leading_slash(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co", repo_root=tmp_path)
    legacy = "/assets/utensils/kadhai/kadhai.jpg"
    assert ui.normalize_image_value(cfg, utensil_id="kadhai", value=legacy) == \
        "https://abc.supabase.co/storage/v1/object/public/utensil-images/kadhai/kadhai.jpg"


def test_normalize_passes_none_and_empty(tmp_path):
    cfg = _FakeConfig(supabase_url="https://abc.supabase.co", repo_root=tmp_path)
    assert ui.normalize_image_value(cfg, utensil_id="x", value=None) is None
    assert ui.normalize_image_value(cfg, utensil_id="x", value="") == ""


def test_decide_local_only_pushes_only_on_push():
    assert decide(local={"mtime": 1.0}, remote=None, direction="push") == "upload"
    assert decide(local={"mtime": 1.0}, remote=None, direction="both") == "upload"
    assert decide(local={"mtime": 1.0}, remote=None, direction="pull") == "skip"


def test_decide_remote_only_downloads_only_on_pull():
    assert decide(local=None, remote={"updated_at_ts": 1.0}, direction="pull") == "download"
    assert decide(local=None, remote={"updated_at_ts": 1.0}, direction="push") == "skip"
    assert decide(local=None, remote={"updated_at_ts": 1.0}, direction="both") == "download"


def test_decide_clock_skew_tolerance():
    # Within 1 s of each other -> skip.
    assert decide(local={"mtime": 100.0}, remote={"updated_at_ts": 100.5}, direction="both") == "skip"


def test_decide_local_newer_pushes_on_both():
    assert decide(local={"mtime": 200.0}, remote={"updated_at_ts": 100.0}, direction="both") == "upload"


def test_decide_remote_newer_pulls_on_both():
    assert decide(local={"mtime": 100.0}, remote={"updated_at_ts": 200.0}, direction="both") == "download"
