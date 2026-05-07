"""Amazon product page scraper. Pure data — no DB or filesystem side effects.

Designed so a future PA-API path slots in transparently behind ProductInfo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


_ASIN_RX = re.compile(r"^[A-Z0-9]{10}$")
_URL_ASIN_RX = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?]|$)")
_HOST_RX = re.compile(r"^https?://(?:www\.)?(amazon\.[a-z.]+)/", re.IGNORECASE)


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
    raise NotImplementedError("fetch_product is implemented in Task 4")


def fetch_product_via_paapi(asin: str, marketplace: str) -> ProductInfo:
    """Stub for the future Product Advertising API path."""
    raise NotImplementedError("PA-API path not yet wired up")
