"""Tests for mfc.ops.thiings — scraper for thiings.co/things/<slug>."""

from __future__ import annotations

import io
from unittest.mock import patch
from urllib.error import HTTPError

import pytest


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
TINY_PNG = PNG_MAGIC + b"rest-of-png-bytes"

SPINACH_HTML = b"""<!doctype html><html><body>
<img src="/_next/image?url=https%3A%2F%2Flftz25oez4aqbxpq.public.blob.vercel-storage.com%2Fimage-YOHxnWgKxTUQknXCGBBSQmI9XcJ1WN.png&amp;w=1000&amp;q=75"/>
</body></html>"""


class _FakeResp(io.BytesIO):
    def __init__(self, body: bytes, status: int = 200):
        super().__init__(body)
        self.status = status
    def __enter__(self):
        return self
    def __exit__(self, *_exc):
        self.close()


def _urlopen_factory(responses):
    queue = list(responses)
    def fake(req, timeout=None):
        item = queue.pop(0)
        if isinstance(item, HTTPError):
            raise item
        status, body = item
        return _FakeResp(body, status=status)
    return fake


def test_returns_png_bytes_when_html_exposes_blob_url():
    from mfc.ops import thiings

    responses = [(200, SPINACH_HTML), (200, TINY_PNG)]
    with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory(responses)):
        data = thiings.fetch_image("spinach")

    assert data[:8] == PNG_MAGIC
    assert data == TINY_PNG


def test_page_404_raises_not_found_with_reason():
    from mfc.ops import thiings

    not_found = HTTPError(
        url="https://www.thiings.co/things/nope",
        code=404, msg="Not Found", hdrs=None, fp=None,
    )
    with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([not_found])):
        with pytest.raises(thiings.ThiingsNotFound) as ex:
            thiings.fetch_image("nope")
    assert ex.value.slug == "nope"
    assert ex.value.reason == "page-404"


def test_html_without_blob_url_raises_not_found():
    from mfc.ops import thiings

    empty_html = b"<html><body><p>nothing here</p></body></html>"
    with patch("mfc.ops.thiings.urlopen", new=_urlopen_factory([(200, empty_html)])):
        with pytest.raises(thiings.ThiingsNotFound) as ex:
            thiings.fetch_image("aamchur")
    assert ex.value.reason == "no-image-in-html"
