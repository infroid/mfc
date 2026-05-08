"""Scraper for thiings.co/things/<slug>.

Pulls the underlying Vercel Blob PNG URL out of the Next.js page HTML
and downloads the bytes. Pure I/O — no DB, no filesystem.
"""

from __future__ import annotations

import re
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen


PAGE_URL = "https://www.thiings.co/things/{slug}"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
TIMEOUT_S = 10
MAX_BYTES = 5 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

_BLOB_HOST = r"lftz25oez4aqbxpq\.public\.blob\.vercel-storage\.com"
_BLOB_RE = re.compile(rf"https://{_BLOB_HOST}/image-[A-Za-z0-9]+\.png")
_PROXY_RE = re.compile(r'_next/image\?url=([^&"\']+)')


class ThiingsError(RuntimeError):
    def __init__(self, slug: str, reason: str):
        super().__init__(f"{slug}: {reason}")
        self.slug = slug
        self.reason = reason


class ThiingsNotFound(ThiingsError):
    pass


def _get(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.read(MAX_BYTES + 1)
    except HTTPError:
        raise
    except (URLError, TimeoutError) as exc:
        raise ThiingsError(url, f"network: {exc}") from exc


def _extract_blob_url(html: bytes) -> str | None:
    text = html.decode("utf-8", errors="ignore")
    m = _BLOB_RE.search(text)
    if m:
        return m.group(0)
    m = _PROXY_RE.search(text)
    if m:
        decoded = unquote(m.group(1))
        if _BLOB_RE.fullmatch(decoded):
            return decoded
    return None


def fetch_image(slug: str) -> bytes:
    """Return PNG bytes for the given thiings slug.

    Raises ThiingsNotFound if the slug is missing on thiings.co.
    Raises ThiingsError on network / structural failures.
    """
    page_url = PAGE_URL.format(slug=slug)
    try:
        html = _get(page_url)
    except HTTPError as exc:
        if exc.code == 404:
            raise ThiingsNotFound(slug, "page-404") from exc
        raise ThiingsError(slug, f"page-http-{exc.code}") from exc

    blob_url = _extract_blob_url(html)
    if blob_url is None:
        raise ThiingsNotFound(slug, "no-image-in-html")

    try:
        data = _get(blob_url)
    except HTTPError as exc:
        raise ThiingsError(slug, f"blob-http-{exc.code}") from exc

    if len(data) > MAX_BYTES:
        raise ThiingsError(slug, "oversize")
    if not data.startswith(PNG_MAGIC):
        raise ThiingsError(slug, "not-png")
    return data
