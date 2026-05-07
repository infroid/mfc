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


import json
from datetime import datetime, timezone

from ..core import files, log
from ..core.config import Config
from ..ops import utensils as utensils_ops, utensil_images as utensil_images_ops


_DETAIL_KEYS = {
    "material": ["Material", "Material Type", "Outer Material", "Material Composition"],
    "size":     ["Size", "Item Dimensions LxWxH", "Product Dimensions",
                 "Package Dimensions", "Capacity"],
    "weight":   ["Item Weight", "Weight", "Package Weight"],
}
_CARE_KEYS = ["Care Instructions", "Cleaning Instructions"]


def _first_present(details: dict, keys: list[str]) -> Optional[str]:
    for k in keys:
        v = details.get(k)
        if v:
            return v
    return None


def _specs_from_details(details: dict[str, str]) -> dict[str, str]:
    specs: dict[str, str] = {}
    for spec_key, candidate_labels in _DETAIL_KEYS.items():
        v = _first_present(details, candidate_labels)
        if v:
            specs[spec_key] = v
    return specs


def _compose_bundle(
    *,
    info: amazon.ProductInfo,
    utensil_id: str,
    photo_path: Optional[str],
    now: datetime,
) -> dict:
    iso = now.isoformat()
    specs = _specs_from_details(info.details)
    tagline = info.bullets[0] if info.bullets else None
    care_tip = _first_present(info.details, _CARE_KEYS)
    show_specs = bool(specs)
    return {
        "id": utensil_id,
        "name": info.title,
        "tagline": tagline,
        "category": guess_category(info.breadcrumbs),
        "photo": photo_path,
        "care_tip": care_tip,
        "specs": specs,
        "show": {"buyLink": True, "careTip": True, "specs": show_specs},
        "ai_filled_at": iso,
        "amazon": {
            "asin": info.asin,
            "marketplace": info.marketplace,
            "fetched_at": iso,
        },
        "buy_links": [{
            "sort_order": 0,
            "store": "Amazon",
            "url": canonical_amazon_url(info.asin, info.marketplace),
            "price": info.price,
            "affiliate_tag": AFFILIATE_TAG,
        }],
    }


def register(subparsers: argparse._SubParsersAction) -> None:
    p = subparsers.add_parser(
        "create-utensil",
        help="Create a utensil bundle (and DB row) from an Amazon product URL",
    )
    p.add_argument("url", help="Amazon product URL or bare 10-char ASIN")
    p.add_argument("--id", default=None, help="Override the auto-slug; must be unique")
    p.add_argument("--no-db", action="store_true", help="Write bundle locally; skip DB push")
    p.add_argument("--no-image", action="store_true", help="Skip image candidate download")
    p.add_argument("--image-index", type=int, default=None,
                   help="Pre-pick the Nth image (1-indexed); 0 = skip image entirely")
    p.add_argument("--force", action="store_true",
                   help="Overwrite an existing bundle dir / DB row")
    p.set_defaults(handler=run)


def run(args: argparse.Namespace, config: Config) -> int:
    sb = None  # construct lazily only if push needed

    # 1. Parse + scrape
    log.step(f"create-utensil · {args.url}")
    info = amazon.fetch_product(args.url)
    log.ok(f"scraped: {info.title} (asin={info.asin}, market={info.marketplace})")

    # 2. Resolve id
    utensil_id = args.id or slugify(info.title)
    log.info(f"utensil id: {utensil_id}")

    # 3. Collision check
    bundle_dir = files.utensil_bundles_root(config.repo_root) / utensil_id
    bundle_path = files.utensil_bundle_path(config.repo_root, utensil_id)
    if bundle_path.exists() and not args.force:
        log.error(
            f'Utensil id "{utensil_id}" already exists at {bundle_path}.\n'
            f'  Either re-run with --id <different-slug>, or pass --force to overwrite.'
        )
        return 1
    if not args.no_db:
        sb = sb_client.service_client(config)  # noqa: F841 — used below
        existing = sb.table("utensils").select("id").eq("id", utensil_id).execute().data or []
        if existing and not args.force:
            log.error(
                f'Utensil id "{utensil_id}" already exists in DB.\n'
                f'  Either re-run with --id <different-slug>, or pass --force to overwrite.'
            )
            return 1

    bundle_dir.mkdir(parents=True, exist_ok=True)

    # 4. Image flow
    photo_rel: Optional[str] = None
    if not args.no_image and info.image_urls:
        candidates_dir = bundle_dir / "_candidates"
        candidates_dir.mkdir(exist_ok=True)
        candidate_paths: list[Path] = []
        for i, url in enumerate(info.image_urls, start=1):
            target = candidates_dir / f"img-{i}.jpg"
            try:
                _download_candidate(url, target)
                candidate_paths.append(target)
            except amazon.AmazonError as e:
                log.warn(f"skip candidate {i}: {e}")
        if not candidate_paths:
            log.warn("no usable image candidates downloaded")
        else:
            preview = candidates_dir / "preview.html"
            _write_preview_html(preview, candidate_paths)
            chosen = _choose_candidate(
                candidate_paths,
                image_index=args.image_index,
                open_preview=True,
                preview_html=preview,
            )
            if chosen is not None:
                final = bundle_dir / f"{utensil_id}.jpg"
                shutil.copyfile(chosen, final)
                # Upload to Storage so admin/recipe pages can render via a
                # full URL regardless of the requesting page path.
                if not args.no_db:
                    photo_rel = utensil_images_ops.upload_one_for_utensil(
                        config, utensil_id=utensil_id, local_path=final
                    )
                    log.ok(f"uploaded image: {photo_rel}")
                else:
                    # --no-db means we also skip the network upload. Bundle
                    # gets the legacy assets/ path; sync-utensil-images push
                    # later will rewrite it.
                    photo_rel = f"assets/utensils/{utensil_id}/{utensil_id}.jpg"
            shutil.rmtree(candidates_dir, ignore_errors=True)
    elif args.no_image:
        log.info("skipping image download (--no-image)")

    # 5. Compose + write bundle
    now = datetime.now(timezone.utc)
    bundle = _compose_bundle(info=info, utensil_id=utensil_id, photo_path=photo_rel, now=now)
    bundle_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
    log.ok(f"wrote {bundle_path.relative_to(config.repo_root)}")

    # 6. Optional DB push
    if not args.no_db:
        utensils_ops.push_bundles(config, only=[utensil_id])
        log.ok(f"pushed to DB: {utensil_id}")

    log.info(f"Edit at admin/utensil.html?id={utensil_id} to refine.")
    return 0


# Late import so the helper module above doesn't trigger circular imports.
from ..clients import sb as sb_client  # noqa: E402
