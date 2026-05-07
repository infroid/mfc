"""Amazon product page scraper. Pure data — no DB or filesystem side effects.

Designed so a future PA-API path slots in transparently behind ProductInfo.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

import httpx
from bs4 import BeautifulSoup


_ASIN_RX = re.compile(r"^[A-Z0-9]{10}$")
_URL_ASIN_RX = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?]|$)")
_HOST_RX = re.compile(r"^https?://(?:www\.)?(amazon\.[a-z.]+)/", re.IGNORECASE)

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
_HTTP_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
_HTTP_TIMEOUT_S = 15.0
_COLOR_IMAGES_RX = re.compile(
    r"'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[.*?\])\s*\}", re.DOTALL
)


class AmazonNotFound(Exception):
    """Bad URL, page 404, or missing ASIN."""


class AmazonError(Exception):
    """Transient failure: network, parse failure, bot wall, oversize."""


@dataclass
class ProductInfo:
    asin: str
    marketplace: str        # "amazon.com" | "amazon.in" | ...
    title: str
    price: Optional[str]
    image_urls: list[str]
    breadcrumbs: list[str]
    canonical_url: str


def parse_url(url: str) -> tuple[str, str]:
    """Extract (asin, marketplace) from an Amazon product URL or bare ASIN.

    Marketplace is the host stripped of www. ("www.amazon.com" -> "amazon.com").
    Bare ASIN defaults to marketplace="amazon.com".
    """
    if not url:
        raise AmazonNotFound("empty url")

    s = url.strip()

    if _ASIN_RX.match(s):
        return s, "amazon.com"

    host_match = _HOST_RX.match(s)
    if not host_match:
        raise AmazonNotFound(f"not an amazon url: {url!r}")
    marketplace = host_match.group(1).lower()

    asin_match = _URL_ASIN_RX.search(s)
    if not asin_match:
        raise AmazonNotFound(f"no ASIN in url: {url!r}")
    return asin_match.group(1), marketplace


def fetch_product(url: str) -> ProductInfo:
    asin, marketplace = parse_url(url)
    canonical = f"https://www.{marketplace}/dp/{asin}"
    fetch_url = url if url.startswith("http") else canonical

    try:
        resp = httpx.get(
            fetch_url,
            headers=_HTTP_HEADERS,
            timeout=_HTTP_TIMEOUT_S,
            follow_redirects=True,
        )
    except httpx.HTTPError as e:
        raise AmazonError(f"network: {e}") from e

    if resp.status_code == 404:
        raise AmazonNotFound(f"page 404: {fetch_url}")
    if resp.status_code >= 400:
        raise AmazonError(f"http {resp.status_code}: {fetch_url}")

    return _parse_product_html(
        html=resp.text,
        asin=asin,
        marketplace=marketplace,
        canonical_url=canonical,
    )


def _parse_product_html(*, html: str, asin: str, marketplace: str, canonical_url: str) -> ProductInfo:
    if _is_bot_wall(html):
        raise AmazonError(f"bot-wall: amazon served captcha for {asin}")

    soup = BeautifulSoup(html, "html.parser")

    title_el = soup.select_one("#productTitle")
    if not title_el:
        raise AmazonError(f"parse-failure: no #productTitle for {asin}")
    title = title_el.get_text(strip=True)

    price_el = soup.select_one(".a-price .a-offscreen")
    if price_el is None:
        price_el = soup.select_one("#corePrice_feature_div .a-offscreen")
    price = price_el.get_text(strip=True) if price_el else None

    breadcrumbs = [
        a.get_text(strip=True)
        for a in soup.select("#wayfinding-breadcrumbs_feature_div a")
        if a.get_text(strip=True)
    ]

    image_urls = _extract_image_urls(html, soup)

    return ProductInfo(
        asin=asin,
        marketplace=marketplace,
        title=title,
        price=price,
        image_urls=image_urls,
        breadcrumbs=breadcrumbs,
        canonical_url=canonical_url,
    )


def _is_bot_wall(html: str) -> bool:
    head = html[:4096].lower()
    return "<title>robot check</title>" in head or "validatecaptcha" in head


def _extract_image_urls(html: str, soup: "BeautifulSoup") -> list[str]:
    """Two-tier extraction: colorImages JSON block, then og:image fallback."""
    match = _COLOR_IMAGES_RX.search(html)
    if match:
        try:
            entries = _loose_json_array(match.group(1))
            urls: list[str] = []
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                u = entry.get("hiRes") or entry.get("large")
                if isinstance(u, str) and u and u not in urls:
                    urls.append(u)
            if urls:
                return urls
        except Exception:
            pass  # fall through to og:image

    og = soup.select_one('meta[property="og:image"]')
    if og and og.get("content"):
        return [og["content"]]
    return []


def _loose_json_array(blob: str) -> list:
    """Amazon serializes colorImages with single quotes; massage into JSON.

    Replaces only quote-style; does not handle every JS construct. If the
    structure changes we fall back to og:image. That is the design.
    """
    cleaned = blob.replace("'", '"')
    return json.loads(cleaned)


def fetch_product_via_paapi(asin: str, marketplace: str) -> ProductInfo:
    """Stub for the future Product Advertising API path."""
    raise NotImplementedError("PA-API path not yet wired up")
