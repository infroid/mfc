"""HTTP-level tests for amazon.fetch_product, using respx fixtures."""

from __future__ import annotations

import httpx
import pytest
import respx

from mfc.ops import amazon


URL = "https://www.amazon.com/dp/B07JFTSKXW"


def _fixture(fixture_path, name):
    return fixture_path(f"amazon/{name}").read_text(encoding="utf-8")


@respx.mock
def test_fetch_product_happy(fixture_path):
    respx.get(URL).mock(
        return_value=httpx.Response(200, html=_fixture(fixture_path, "happy.html"))
    )
    info = amazon.fetch_product(URL)
    assert info.asin == "B07JFTSKXW"
    assert info.marketplace == "amazon.com"
    assert info.title == 'Cast-iron Kadhai 10" Pre-Seasoned'
    assert info.price == "$49.95"
    # hiRes regex catches three; data-a-dynamic-image adds none new (same hosts).
    assert info.image_urls == [
        "https://m.media-amazon.com/images/I/hero-1.jpg",
        "https://m.media-amazon.com/images/I/hero-2.jpg",
        "https://m.media-amazon.com/images/I/hero-3.jpg",
    ]
    assert info.breadcrumbs == ["Home & Kitchen", "Cookware", "Woks & Stir-Fry Pans"]
    assert info.canonical_url == "https://www.amazon.com/dp/B07JFTSKXW"
    assert info.bullets == [
        "Deep, broad, hot — the workhorse pan for kadhai cooking.",
        "10-inch diameter; 2.4 kg pre-seasoned cast iron.",
        "Hand-wash, dry on heat, oil lightly.",
    ]
    assert info.details["Material"] == "Cast iron"
    assert info.details["Item Weight"] == "2.4 Kilograms"
    assert info.details["Care Instructions"] == "Hand wash; dry on heat; oil lightly."


@respx.mock
def test_fetch_product_bot_wall_raises_amazon_error(fixture_path):
    respx.get(URL).mock(
        return_value=httpx.Response(200, html=_fixture(fixture_path, "bot_wall.html"))
    )
    with pytest.raises(amazon.AmazonError) as exc:
        amazon.fetch_product(URL)
    assert "bot-wall" in str(exc.value)


@respx.mock
def test_fetch_product_404_raises_amazon_not_found():
    respx.get(URL).mock(return_value=httpx.Response(404))
    with pytest.raises(amazon.AmazonNotFound):
        amazon.fetch_product(URL)


@respx.mock
def test_fetch_product_falls_back_to_og_image_when_no_other_sources():
    minimal_html = """
        <html><head>
          <meta property="og:image" content="https://example.com/fallback.jpg">
        </head><body>
          <span id="productTitle">Minimal</span>
        </body></html>
    """
    respx.get(URL).mock(return_value=httpx.Response(200, html=minimal_html))
    info = amazon.fetch_product(URL)
    assert info.title == "Minimal"
    assert info.image_urls == ["https://example.com/fallback.jpg"]
    assert info.breadcrumbs == []
    assert info.price is None
    assert info.bullets == []
    assert info.details == {}


@respx.mock
def test_fetch_product_data_a_dynamic_image_when_no_hires_block():
    """Single-image products lacking the colorImages JSON block."""
    html = """
        <html><body>
          <span id="productTitle">Single Image Product</span>
          <img id="landingImage" data-a-dynamic-image='{"https://example.com/small.jpg":[200,200],"https://example.com/big.jpg":[1500,1500]}'>
        </body></html>
    """
    respx.get(URL).mock(return_value=httpx.Response(200, html=html))
    info = amazon.fetch_product(URL)
    assert info.image_urls == ["https://example.com/big.jpg"]
