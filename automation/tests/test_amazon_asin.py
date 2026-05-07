"""Table-driven tests for Amazon ASIN/marketplace extraction."""

from __future__ import annotations

import pytest

from mfc.ops import amazon


@pytest.mark.parametrize(
    "url,expected_asin,expected_market",
    [
        ("https://www.amazon.com/dp/B07JFTSKXW",                          "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/dp/B07JFTSKXW?tag=foo-20",               "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/Cast-Iron-Kadhai/dp/B07JFTSKXW/ref=foo", "B07JFTSKXW", "amazon.com"),
        ("https://www.amazon.com/gp/product/B07JFTSKXW",                  "B07JFTSKXW", "amazon.com"),
        ("https://amazon.in/dp/B0CHWRXH8B",                               "B0CHWRXH8B", "amazon.in"),
        ("https://www.amazon.co.uk/dp/B0CHWRXH8B",                        "B0CHWRXH8B", "amazon.co.uk"),
        ("B07JFTSKXW",                                                    "B07JFTSKXW", "amazon.com"),
    ],
)
def test_parse_url_extracts_asin_and_marketplace(url, expected_asin, expected_market):
    asin, marketplace = amazon.parse_url(url)
    assert asin == expected_asin
    assert marketplace == expected_market


@pytest.mark.parametrize(
    "url",
    [
        "",
        "https://www.amazon.com/",
        "https://www.amazon.com/some/path/with/no/asin",
        "not-a-url",
        "B07JFTSKX",   # 9 chars
        "B07JFTSKXW1", # 11 chars
    ],
)
def test_parse_url_raises_amazon_not_found_on_garbage(url):
    with pytest.raises(amazon.AmazonNotFound):
        amazon.parse_url(url)
