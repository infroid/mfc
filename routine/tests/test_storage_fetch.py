from __future__ import annotations

from pathlib import Path

import pytest
from dagster import build_op_context

from routine.jobs.storage_fetch import DownloadConfig, download
from routine.resources.supabase import SupabaseResource


class _FakeBucket:
    def __init__(self, blob: bytes) -> None:
        self.blob = blob
        self.last_path: str | None = None

    def download(self, path: str) -> bytes:
        self.last_path = path
        return self.blob


class _FakeStorage:
    def __init__(self, bucket: _FakeBucket) -> None:
        self._bucket = bucket
        self.last_bucket: str | None = None

    def from_(self, bucket: str) -> _FakeBucket:
        self.last_bucket = bucket
        return self._bucket


class _FakeClient:
    def __init__(self, blob: bytes) -> None:
        self.bucket = _FakeBucket(blob)
        self.storage = _FakeStorage(self.bucket)


class _FakeSupabase(SupabaseResource):
    def client(self):  # type: ignore[override]
        return _FakeClient(b"hello")


def _resource() -> _FakeSupabase:
    return _FakeSupabase(
        url="x", publishable_key="x", secret_key="x", db_url="x",
    )


def test_download_writes_blob_to_artifact_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context(resources={"supabase": _resource()})
    out = download(ctx, DownloadConfig(bucket="recipe-images", object_path="x/y.bin"))
    assert Path(out).read_bytes() == b"hello"
    assert Path(out).name == "y.bin"


def test_download_refuses_to_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr("routine.lib.paths.repo_root", lambda: tmp_path)
    ctx = build_op_context(resources={"supabase": _resource()})
    download(ctx, DownloadConfig(bucket="b", object_path="x/y.bin"))
    with pytest.raises(FileExistsError):
        download(ctx, DownloadConfig(bucket="b", object_path="x/y.bin"))
