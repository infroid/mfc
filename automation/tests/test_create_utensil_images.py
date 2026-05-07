"""Tests for create_utensil image-candidate helpers."""

from __future__ import annotations

import httpx
import pytest
import respx

from mfc.commands import create_utensil as cu
from mfc.ops import amazon


def test_download_candidate_writes_file_under_5mb(tmp_path):
    url = "https://example.com/img.jpg"
    payload = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1024  # 1 KB
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, content=payload))
        out = tmp_path / "candidate.jpg"
        cu._download_candidate(url, out)
    assert out.read_bytes() == payload


def test_download_candidate_raises_oversize():
    url = "https://example.com/big.jpg"
    payload = b"x" * (5 * 1024 * 1024 + 1)  # 5 MB + 1
    with respx.mock:
        respx.get(url).mock(return_value=httpx.Response(200, content=payload))
        with pytest.raises(amazon.AmazonError) as exc:
            cu._download_candidate(url, None)
        assert "oversize" in str(exc.value)


def test_write_preview_html_lists_candidates(tmp_path):
    paths = [tmp_path / "img-1.jpg", tmp_path / "img-2.jpg"]
    for p in paths:
        p.write_bytes(b"x")
    html_path = tmp_path / "preview.html"
    cu._write_preview_html(html_path, paths)
    body = html_path.read_text()
    assert "img-1.jpg" in body
    assert "img-2.jpg" in body
    assert "1" in body and "2" in body


def test_choose_candidate_with_image_index(monkeypatch, tmp_path):
    paths = [tmp_path / "img-1.jpg", tmp_path / "img-2.jpg", tmp_path / "img-3.jpg"]
    for p in paths:
        p.write_bytes(b"x")
    chosen = cu._choose_candidate(paths, image_index=2)
    assert chosen == paths[1]  # 1-indexed


def test_choose_candidate_with_image_index_zero_returns_none(tmp_path):
    paths = [tmp_path / "img-1.jpg"]
    paths[0].write_bytes(b"x")
    assert cu._choose_candidate(paths, image_index=0) is None


def test_choose_candidate_image_index_out_of_range_raises(tmp_path):
    paths = [tmp_path / "img-1.jpg"]
    paths[0].write_bytes(b"x")
    with pytest.raises(ValueError):
        cu._choose_candidate(paths, image_index=99)
