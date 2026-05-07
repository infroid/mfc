"""Pure-function tests for create_utensil helpers."""

from __future__ import annotations

import pytest

from mfc.commands import create_utensil as cu


@pytest.mark.parametrize(
    "title,expected",
    [
        ("Cast-iron Kadhai 10\" Pre-Seasoned", "cast-iron-kadhai-10-pre-seasoned"),
        ("  Trimmed   Spaces  ",                 "trimmed-spaces"),
        ("Émojis 🍳 stripped",                    "emojis-stripped"),
    ],
)
def test_slugify_title(title, expected):
    assert cu.slugify(title) == expected


def test_slugify_empty_raises():
    with pytest.raises(ValueError):
        cu.slugify("   ")


@pytest.mark.parametrize(
    "breadcrumbs,expected",
    [
        (["Home & Kitchen", "Cookware", "Skillets"],          "Cookware"),
        (["Home & Kitchen", "Bakeware", "Sheet Pans"],        "Bakeware"),
        (["Tools & Home Improvement", "Kitchen Knives"],      "Cutlery"),
        (["Home & Kitchen", "Small Appliances", "Blenders"],  "Small appliance"),
        (["Home & Kitchen", "Measuring Tools"],               "Measuring"),
        ([],                                                  "Utensil"),
        (["Garden", "Hose"],                                  "Utensil"),
    ],
)
def test_guess_category(breadcrumbs, expected):
    assert cu.guess_category(breadcrumbs) == expected


def test_canonical_amazon_url_appends_mfc_tag():
    assert cu.canonical_amazon_url("B07JFTSKXW", "amazon.com") == \
        "https://www.amazon.com/dp/B07JFTSKXW?tag=mfc-20"
    assert cu.canonical_amazon_url("B07JFTSKXW", "amazon.in") == \
        "https://www.amazon.in/dp/B07JFTSKXW?tag=mfc-20"
