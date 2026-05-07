"""Square-pad utility for utensil photos.

Takes any rectangular image and returns a square version, padded — never
cropped — using a fill colour sampled from the image's own edge pixels so
the padding visually blends into the original background.

Pure function. Pillow only. Output is always JPEG (quality 92).
"""

from __future__ import annotations

from pathlib import Path
from statistics import median
from typing import Iterable

from PIL import Image


JPEG_QUALITY = 92
EDGE_STRIP_PX = 1  # how many pixels deep along each edge to sample


def square_pad(src: Path, dst: Path) -> None:
    """Square-pad `src` and write JPEG to `dst`.

    Algorithm:
      1. Load and convert to RGB (flatten RGBA against edge-median).
      2. If already square, save as JPEG and return.
      3. Sample pixels along the four edge strips (top, bottom, left, right
         columns/rows EDGE_STRIP_PX deep).
      4. Compute per-channel median across all sampled pixels.
      5. Create new square canvas of size max(w, h) filled with that colour.
      6. Paste original centered. Save as JPEG.
    """
    src = Path(src)
    dst = Path(dst)

    with Image.open(src) as img:
        img.load()
        rgb = _flatten_to_rgb(img)
        w, h = rgb.size

        if w == h:
            rgb.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)
            return

        fill = _edge_median_color(rgb)
        side = max(w, h)
        canvas = Image.new("RGB", (side, side), fill)
        offset = ((side - w) // 2, (side - h) // 2)
        canvas.paste(rgb, offset)
        canvas.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)


def _flatten_to_rgb(img: Image.Image) -> Image.Image:
    """Convert any input mode to plain RGB. RGBA gets flattened against a
    placeholder white background sized 1×1 — we sample edges from the
    flattened image afterwards, so the colour we land on is consistent.
    """
    if img.mode == "RGB":
        return img.copy()
    if img.mode == "RGBA":
        # Composite RGBA over white, then we'll let edge-sampling pick whatever
        # colour bleeds through (white if the edges were transparent).
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def _edge_median_color(img: Image.Image) -> tuple[int, int, int]:
    """Median RGB across pixels in EDGE_STRIP_PX-deep border strips."""
    w, h = img.size
    px = img.load()

    rs: list[int] = []
    gs: list[int] = []
    bs: list[int] = []

    def collect(coords: Iterable[tuple[int, int]]) -> None:
        for x, y in coords:
            r, g, b = px[x, y]
            rs.append(r)
            gs.append(g)
            bs.append(b)

    # top + bottom strips
    for d in range(min(EDGE_STRIP_PX, h)):
        collect((x, d) for x in range(w))
        collect((x, h - 1 - d) for x in range(w))
    # left + right strips (skip corners already collected to avoid double weight)
    for d in range(min(EDGE_STRIP_PX, w)):
        collect((d, y) for y in range(EDGE_STRIP_PX, h - EDGE_STRIP_PX))
        collect((w - 1 - d, y) for y in range(EDGE_STRIP_PX, h - EDGE_STRIP_PX))

    if not rs:
        return (255, 255, 255)
    return (int(median(rs)), int(median(gs)), int(median(bs)))
