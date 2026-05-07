"""`mfc create-utensil` — scrape an Amazon product page, write a utensil
bundle (JSON + image) to disk, optionally push the row to Supabase.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Optional

import httpx

from ..ops import amazon


AFFILIATE_TAG = "mfc-20"


_SLUG_NORMALIZE_RX = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    """ASCII slug: lowercase, strip diacritics, collapse non-alnum runs to '-'."""
    if not text or not text.strip():
        raise ValueError("cannot slugify empty string")
    normalized = unicodedata.normalize("NFKD", text)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = _SLUG_NORMALIZE_RX.sub("-", ascii_only.lower()).strip("-")
    if not slug:
        raise ValueError(f"slug collapsed to empty for input: {text!r}")
    return slug


_CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Cutlery",         ["knife", "knives", "cutlery"]),
    ("Bakeware",        ["bakeware", "baking"]),
    ("Small appliance", ["small appliance", "blender", "mixer", "appliance"]),
    ("Measuring",       ["measuring", "scale", "thermometer"]),
    ("Cookware",        ["cookware", "pot", "pan", "skillet", "wok", "dutch oven"]),
]


def guess_category(breadcrumbs: list[str]) -> str:
    haystack = " ".join(breadcrumbs).lower()
    for category, keywords in _CATEGORY_RULES:
        if any(kw in haystack for kw in keywords):
            return category
    return "Utensil"


def canonical_amazon_url(asin: str, marketplace: str) -> str:
    return f"https://www.{marketplace}/dp/{asin}?tag={AFFILIATE_TAG}"


_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_DOWNLOAD_TIMEOUT_S = 30.0


def _download_candidate(url: str, out_path: Optional[Path]) -> None:
    """Stream a candidate image to disk; raise AmazonError if > 5 MB."""
    try:
        with httpx.stream("GET", url, timeout=_DOWNLOAD_TIMEOUT_S, follow_redirects=True) as resp:
            resp.raise_for_status()
            total = 0
            chunks: list[bytes] = []
            for chunk in resp.iter_bytes():
                total += len(chunk)
                if total > _MAX_IMAGE_BYTES:
                    raise amazon.AmazonError(f"oversize: {url} (>5 MB)")
                chunks.append(chunk)
        if out_path is not None:
            out_path.write_bytes(b"".join(chunks))
    except amazon.AmazonError:
        raise
    except httpx.HTTPError as e:
        raise amazon.AmazonError(f"download {url}: {e}") from e


def _write_preview_html(html_path: Path, candidate_paths: list[Path]) -> None:
    """Write a small grid HTML so the user can eyeball candidates."""
    items = "\n".join(
        f'  <figure style="display:inline-block;margin:8px;width:240px;text-align:center">'
        f'<img src="{p.name}" style="max-width:240px;max-height:240px;display:block;margin:0 auto"/>'
        f'<figcaption style="font:12px monospace">{i+1}. {p.name}</figcaption>'
        f'</figure>'
        for i, p in enumerate(candidate_paths)
    )
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Pick a utensil image</title></head>"
        "<body style='font-family:system-ui;background:#f7f5ee'>"
        "<h2 style='margin:16px'>Pick the image to keep — type its number in the terminal.</h2>"
        f"{items}"
        "</body></html>"
    )
    html_path.write_text(html, encoding="utf-8")


def _choose_candidate(
    candidate_paths: list[Path],
    *,
    image_index: Optional[int] = None,
    open_preview: bool = False,
    preview_html: Optional[Path] = None,
) -> Optional[Path]:
    """Pick one candidate. Returns None if user/flag chooses 'skip'.

    image_index = 0  -> skip
    image_index in [1..N] -> select that 1-indexed candidate
    image_index None -> interactive: open preview, prompt for number
    """
    n = len(candidate_paths)
    if image_index is not None:
        if image_index == 0:
            return None
        if not 1 <= image_index <= n:
            raise ValueError(f"--image-index {image_index} out of range 1..{n}")
        return candidate_paths[image_index - 1]

    if open_preview and preview_html is not None and sys.platform == "darwin":
        subprocess.run(["open", str(preview_html)], check=False)
    elif preview_html is not None:
        print(f"  preview: file://{preview_html.resolve()}")

    while True:
        raw = input(f"Pick image [1-{n}, 0 to skip]: ").strip()
        try:
            idx = int(raw)
        except ValueError:
            print("  not a number — try again")
            continue
        if idx == 0:
            return None
        if 1 <= idx <= n:
            return candidate_paths[idx - 1]
        print(f"  out of range — must be 0..{n}")


def register(subparsers: argparse._SubParsersAction) -> None:
    raise NotImplementedError("CLI surface lands in Task 12")


def run(args: argparse.Namespace, config) -> int:
    raise NotImplementedError("orchestrator lands in Task 11")
